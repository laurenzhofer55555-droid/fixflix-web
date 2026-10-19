"""Plays an attacker who skips the website and talks to the API directly.

usage: api_attack.py <postgrest-url>   (started by run.sh)

The cf-connecting-ip header stands in for Cloudflare, which sets it in front of
Supabase; here it lets one machine act as many different connections.
"""
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1].rstrip("/")
results = []


def call(method, path, body=None, ip="203.0.113.10"):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"Content-Type": "application/json", "cf-connecting-ip": ip},
    )
    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw)
        except ValueError:
            return error.code, raw.decode(errors="replace")


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "   -> " + str(detail)))


def solve(ip):
    status, c = call("POST", "/rpc/get_challenge", {}, ip)
    assert status == 200, (status, c)
    started = time.time()
    for n in range(c["maxnumber"] + 1):
        if hashlib.sha256((c["salt"] + str(n)).encode()).hexdigest() == c["challenge"]:
            return {"salt": c["salt"], "challenge": c["challenge"], "signature": c["signature"], "number": str(n)}, time.time() - started
    raise RuntimeError("unsolvable")


def lead(email, proof, **overrides):
    body = {
        "p_role": "seeker", "p_email": email, "p_postal_code": "10115", "p_locale": "de",
        "p_categories": ["repair"], "p_description": None, "p_experience_level": None,
        "p_wants_app": True, "p_source": "direct", "p_pow": proof,
    }
    body.update(overrides)
    return body


print("== Reading and writing tables with the public key")
for name, method, path, body in [
    ("read all leads", "GET", "/leads?select=*", None),
    ("read emails only", "GET", "/leads?select=email", None),
    ("read events", "GET", "/events?select=*", None),
    ("read demand_overview", "GET", "/demand_overview?select=*", None),
    ("insert lead directly", "POST", "/leads", {"role": "seeker", "email": "x@y.de", "postal_code": "10115", "categories": ["repair"], "wants_app": True}),
    ("insert event directly", "POST", "/events", {"name": "pageview", "path": "/"}),
    ("update all leads", "PATCH", "/leads?id=not.is.null", {"wants_app": False}),
    ("delete all leads", "DELETE", "/leads?id=not.is.null", None),
]:
    status, payload = call(method, path, body)
    check(f"{name} refused (HTTP {status})", status in (401, 403, 404), payload)

print("== Calling internals")
for fn in ("purge", "bump", "cfg", "setting", "verify_pow", "client_ip_hash", "email_hash",
           "mail_api_key", "mail_enabled", "send_confirmation"):
    status, payload = call("POST", f"/rpc/{fn}", {})
    check(f"rpc/{fn} not reachable (HTTP {status})", status == 404, payload)

status, spec = call("GET", "/")
paths = sorted(spec.get("paths", {}).keys()) if isinstance(spec, dict) else []
check("API description lists only the four functions: " + ", ".join(p for p in paths if p != "/"),
      [p for p in paths if p != "/"] == ["/rpc/confirm_lead", "/rpc/get_challenge", "/rpc/log_event", "/rpc/submit_lead"], paths)

print("== Signing up without doing the work")
status, payload = call("POST", "/rpc/submit_lead", lead("a1@posteo.de", None), ip="203.0.113.20")
check(f"no proof -> HTTP {status} {payload.get('message')}", status == 400 and payload.get("message") == "bad_challenge", payload)
fake = {"salt": "0" * 24 + ".9999999999", "challenge": "0" * 64, "signature": "0" * 64, "number": "1"}
status, payload = call("POST", "/rpc/submit_lead", lead("a2@posteo.de", fake), ip="203.0.113.20")
check(f"made-up proof -> HTTP {status} {payload.get('message')}", status == 400 and payload.get("message") == "bad_challenge", payload)

print("== A genuine signup, then replaying its proof")
proof, seconds = solve("203.0.113.30")
print(f"      (native Python needed {seconds * 1000:.0f} ms for one puzzle)")
status, payload = call("POST", "/rpc/submit_lead", lead("echt@posteo.de", proof), ip="203.0.113.30")
check(f"valid signup accepted (HTTP {status})", status == 200 and payload == {"ok": True, "confirm": False}, payload)
status, payload = call("POST", "/rpc/submit_lead", lead("zweiter@posteo.de", proof), ip="203.0.113.30")
check(f"replayed proof -> HTTP {status} {payload.get('message')}", status == 400 and payload.get("message") == "bad_challenge", payload)

print("== Hostile input")
for name, overrides, expected in [
    ("SQL injection as email", {"p_email": "a@b.de'; drop table leads; --"}, "invalid_email"),
    ("script tag as email", {"p_email": "<script>alert(1)</script>@x.de"}, "invalid_email"),
    ("disposable address", {"p_email": "bot@mailinator.com"}, "email_not_allowed"),
    ("2 MB description", {"p_description": "A" * 2_000_000}, "invalid_description"),
    ("invented category", {"p_categories": ["schreiner"]}, "invalid_categories"),
    ("wrong type for categories", {"p_categories": "repair"}, None),
    ("nested object as postal code", {"p_postal_code": {"$ne": None}}, None),
]:
    status, payload = call("POST", "/rpc/submit_lead", lead("h@posteo.de", fake, **overrides), ip="203.0.113.40")
    message = payload.get("message") if isinstance(payload, dict) else payload
    check(f"{name} -> HTTP {status} {str(message)[:60]}", status == 400 and (expected is None or message == expected), payload)

print("== Guessing confirmation links")
for name, token in [("malformed", "abc"), ("SQL injection", "x' or '1'='1"), ("guessed", "a" * 64),
                    ("1 MB", "a" * 1_000_000), ("null", None)]:
    status, payload = call("POST", "/rpc/confirm_lead", {"p_token": token}, ip="203.0.113.80")
    check(f"{name} link -> HTTP {status} {str(payload)[:40]}", status == 200 and payload == {"status": "invalid"}, payload)
codes = [call("POST", "/rpc/confirm_lead", {"p_token": "b" * 64}, ip="203.0.113.81")[0] for _ in range(35)]
check(f"35 link guesses from one connection -> {codes.count(200)}x200, {codes.count(429)}x429", codes == [200] * 30 + [429] * 5, codes)

print("== Flooding")
codes = []
for i in range(8):
    p, _ = solve("203.0.113.50")
    status, _ = call("POST", "/rpc/submit_lead", lead(f"flood{i}@posteo.de", p), ip="203.0.113.50")
    codes.append(status)
check(f"8 signups from one connection -> {codes}", codes == [200] * 5 + [429] * 3, codes)

codes = [call("POST", "/rpc/get_challenge", {}, ip="203.0.113.60")[0] for _ in range(35)]
check(f"35 puzzle requests from one connection -> {codes.count(200)}x200, {codes.count(429)}x429", codes == [200] * 30 + [429] * 5, codes)

codes = {call("POST", "/rpc/log_event", {"p_name": "pageview", "p_path": "/", "p_locale": "de", "p_source": "flood"}, ip="203.0.113.70")[0] for _ in range(300)}
check(f"300 fake page views answered quietly with {sorted(codes)}", codes <= {200, 204}, codes)

print()
print(f"== {sum(results)} passed, {len(results) - sum(results)} failed ==")
sys.exit(0 if all(results) else 1)

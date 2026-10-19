#!/usr/bin/env bash
# Applies ../schema.sql to a throwaway Postgres and attacks it twice: in SQL as
# the anon role (abuse.sql) and over HTTP through a real PostgREST, the API
# server Supabase runs (api_attack.py). Run it after changing schema.sql.
#
# Needs Docker and python3. Leaves nothing behind.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
net=fixflix-schema-test
pg=fixflix-schema-test-pg
api=fixflix-schema-test-api
port=3999

cleanup() {
  docker rm -f "$pg" "$api" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker network create "$net" >/dev/null
docker run -d --name "$pg" --network "$net" -e POSTGRES_PASSWORD=test postgres:16-alpine >/dev/null

# The image restarts Postgres once after initialising, so wait for two good answers.
for _ in 1 2; do
  until docker exec "$pg" psql -U postgres -c 'select 1' >/dev/null 2>&1; do sleep 1; done
  sleep 2
done

sql() { docker exec -i "$pg" psql -U postgres -q "$@"; }

# What a fresh Supabase project looks like to schema.sql: API roles that get
# every privilege on new objects by default — the script has to take them away.
sql -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role authenticator login password 'test' noinherit;
grant anon to authenticator;
create database sqlsuite;
create database strictsuite;
create database apisuite;
SQL

# strictsuite mimics projects created since mid-2026: nothing is exposed by default.
for db in sqlsuite strictsuite apisuite; do
  if [ "$db" != strictsuite ]; then
    sql -d "$db" -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
grant usage on schema public to anon, authenticated;
SQL
  else
    sql -d "$db" -q -c 'revoke all on schema public from public;' >/dev/null
  fi
  # Stand-ins for Supabase's pg_net and Vault: mails are recorded, not sent.
  sql -d "$db" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
create schema net;
create table net.sent (id bigserial primary key, url text, body jsonb, headers jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
                              headers jsonb default '{}', timeout_milliseconds integer default 5000)
returns bigint language sql as $$ insert into net.sent (url, body, headers) values ($1, $2, $4) returning id $$;
create schema vault;
create table vault.decrypted_secrets (name text, decrypted_secret text);
SQL
  sql -d "$db" -v ON_ERROR_STOP=1 < "$here/../schema.sql" 2>&1 | grep -v '^NOTICE' || true
  # Second run must be harmless: people re-run scripts in the SQL editor.
  sql -d "$db" -v ON_ERROR_STOP=1 < "$here/../schema.sql" 2>&1 | grep -v '^NOTICE' || true
done

sql_pass=0
sql_fail=0
for db in sqlsuite strictsuite; do
  echo "### SQL suite as the anon role ($db)"
  out="$(sql -d "$db" -v ON_ERROR_STOP=0 < "$here/abuse.sql" 2>&1 | grep -vE '^$|^(NOTICE|DETAIL|drop cascades)' || true)"
  echo "$out" | grep -vE '^(PASS|==)' || true
  pass="$(echo "$out" | grep -c '^PASS' || true)"
  fail="$(echo "$out" | grep -vcE '^(PASS|==)' || true)"
  echo "    $pass passed, $fail failed"
  sql_pass=$((sql_pass + pass))
  sql_fail=$((sql_fail + fail))
done

echo "### API suite (HTTP through PostgREST)"
docker run -d --name "$api" --network "$net" -p "127.0.0.1:$port:3000" \
  -e PGRST_DB_URI="postgres://authenticator:test@$pg:5432/apisuite" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon postgrest/postgrest >/dev/null
until curl -s -o /dev/null "http://127.0.0.1:$port/"; do sleep 1; done

api_status=0
python3 "$here/api_attack.py" "http://127.0.0.1:$port" || api_status=$?

[ "$sql_fail" -eq 0 ] && [ "$sql_pass" -gt 0 ] && [ "$api_status" -eq 0 ]

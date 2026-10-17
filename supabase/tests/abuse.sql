-- Attack/abuse test suite for supabase/schema.sql. Run after the schema, as postgres.
\set QUIET on
\pset tuples_only on
\pset format unaligned

create schema t;
grant usage on schema t to anon;

-- Runs a statement as the current role and reports OK or "SQLSTATE:message".
create function t.run(q text) returns text language plpgsql as $$
begin
  execute q;
  return 'OK';
exception when others then
  return sqlstate || ':' || sqlerrm;
end $$;

create function t.check(name text, actual text, expected text) returns text language sql as $$
  select case when actual like expected then 'PASS  ' else 'FAIL  ' end || name
         || case when actual like expected then '' else '   got: ' || actual || '   expected: ' || expected end
$$;

-- A visitor's browser: fetch a challenge and brute-force it.
create function t.proof() returns jsonb language plpgsql security definer as $$
declare
  c jsonb := public.get_challenge();
  n bigint := 0;
begin
  loop
    exit when encode(extensions.digest((c->>'salt') || n::text, 'sha256'), 'hex') = c->>'challenge';
    n := n + 1;
    if n > (c->>'maxnumber')::bigint then raise exception 'unsolvable'; end if;
  end loop;
  return jsonb_build_object('salt', c->>'salt', 'challenge', c->>'challenge', 'signature', c->>'signature', 'number', n::text);
end $$;

create function t.ip(addr text) returns void language sql as $$
  select set_config('request.headers', json_build_object('cf-connecting-ip', addr)::text, false)
$$;

-- Shorthand: a valid seeker signup with one field overridden.
create function t.lead(email text, extra text default '') returns text language sql as $$
  select format(
    'select public.submit_lead(p_role => ''seeker'', p_email => %L, p_postal_code => ''10115'', p_locale => ''de'', '
    'p_categories => array[''repair''], p_description => null, p_experience_level => null, p_wants_app => true, '
    'p_source => ''direct'', p_pow => t.proof() %s)', email, extra)
$$;

-- Fast puzzles and roomy limits so only the limit under test bites.
update private.config set value = 2000    where key = 'pow_max_number';
update private.config set value = 100000  where key = 'challenge_per_ip_hour';

set role anon;
select t.ip('10.0.0.1');

\echo == 1. Visitors cannot touch tables, views or private internals
select t.check('read leads',            t.run('select * from public.leads'),                 '42501:%');
select t.check('read events',           t.run('select * from public.events'),                '42501:%');
select t.check('read overview view',    t.run('select * from public.demand_overview'),       '42501:%');
select t.check('direct insert lead',    t.run($$insert into public.leads (role,email,postal_code,categories,wants_app) values ('seeker','x@y.de','10115','{repair}',true)$$), '42501:%');
select t.check('direct insert event',   t.run($$insert into public.events (name,path) values ('pageview','/')$$), '42501:%');
select t.check('update leads',          t.run('update public.leads set wants_app = false'),  '42501:%');
select t.check('delete events',         t.run('delete from public.events'),                  '42501:%');
select t.check('read secrets',          t.run('select * from private.secrets'),              '42501:%');
select t.check('read config',           t.run('select * from private.config'),               '42501:%');
select t.check('raise own limits',      t.run($$update private.config set value = 999999$$), '42501:%');
select t.check('call private.bump',     t.run($$select private.bump('x','hour',1)$$),        '42501:%');
select t.check('call private.purge',    t.run('select private.purge()'),                     '42501:%');

\echo == 2. Happy path
select t.check('valid signup',          t.run(t.lead('  Anna.Beispiel@Posteo.DE ')),         'OK');
select t.check('duplicate is accepted silently', t.run(t.lead('anna.beispiel@posteo.de')),   'OK');

\echo == 3. Proof of work cannot be skipped, forged or reused
select t.check('missing proof',         t.run(replace(t.lead('b1@posteo.de'), 't.proof()', 'null')),                'PT400:bad_challenge');
select t.check('garbage proof',         t.run(replace(t.lead('b2@posteo.de'), 't.proof()', $$'{"salt":"x","challenge":"y","signature":"z","number":"1"}'::jsonb$$)), 'PT400:bad_challenge');
select t.check('wrong number',          t.run(replace(t.lead('b3@posteo.de'), 't.proof()', $$t.proof() || '{"number":"999999999"}'::jsonb$$)), 'PT400:bad_challenge');
select t.check('forged signature',      t.run(replace(t.lead('b4@posteo.de'), 't.proof()', $$t.proof() || jsonb_build_object('signature', repeat('a', 64))$$)), 'PT400:bad_challenge');
reset role;
create table t.saved as select t.proof() as p;
grant select on t.saved to anon;
set role anon;
select t.ip('10.0.0.2');
select t.check('proof used once',       t.run(replace(t.lead('c1@posteo.de'), 't.proof()', '(select p from t.saved)')), 'OK');
select t.check('same proof replayed',   t.run(replace(t.lead('c2@posteo.de'), 't.proof()', '(select p from t.saved)')), 'PT400:bad_challenge');
reset role;
update private.config set value = -5 where key = 'challenge_ttl_seconds';
set role anon;
select t.check('expired proof',         t.run(t.lead('c3@posteo.de')),                       'PT410:challenge_expired');
reset role;
update private.config set value = 900 where key = 'challenge_ttl_seconds';
set role anon;

\echo == 4. Hostile and malformed input
select t.ip('10.0.0.3');
reset role; update private.config set value = 1000 where key = 'lead_per_ip_hour'; set role anon;
select t.check('no @',                  t.run(t.lead('nope')),                               'PT400:invalid_email');
select t.check('formula in email',      t.run(t.lead('=cmd|calc@evil.de')),                  'PT400:invalid_email');
select t.check('double dot',            t.run(t.lead('a..b@posteo.de')),                     'PT400:invalid_email');
select t.check('html in email',         t.run(t.lead('<script>@x.de')),                      'PT400:invalid_email');
select t.check('sql in email',          t.run(t.lead($$a@b.de'; drop table public.leads; --$$)), 'PT400:invalid_email');
select t.check('300 char email',        t.run(t.lead(repeat('a', 300) || '@posteo.de')),     'PT400:invalid_email');
select t.check('disposable domain',     t.run(t.lead('spam@mailinator.com')),                'PT400:email_not_allowed');
select t.check('reserved example.com',  t.run(t.lead('x@example.com')),                      'PT400:email_not_allowed');
select t.check('bad role',              t.run(replace(t.lead('d1@posteo.de'), $$p_role => 'seeker'$$, $$p_role => 'admin'$$)), 'PT400:invalid_role');
select t.check('bad postal code',       t.run(replace(t.lead('d2@posteo.de'), '''10115''', '''1011a''')), 'PT400:invalid_postal_code');
select t.check('trade name category',   t.run(replace(t.lead('d3@posteo.de'), 'array[''repair'']', 'array[''schreiner'']')), 'PT400:invalid_categories');
select t.check('empty categories',      t.run(replace(t.lead('d4@posteo.de'), 'array[''repair'']', 'array[]::text[]')), 'PT400:invalid_categories');
select t.check('50 categories',         t.run(replace(t.lead('d5@posteo.de'), 'array[''repair'']', '(select array_agg(''repair''::text) from generate_series(1,50))')), 'PT400:invalid_categories');
select t.check('helper without level',  t.run(replace(t.lead('d6@posteo.de'), $$p_role => 'seeker'$$, $$p_role => 'helper'$$)), 'PT400:invalid_experience_level');
select t.check('null wants_app',        t.run(replace(t.lead('d7@posteo.de'), 'p_wants_app => true', 'p_wants_app => null')), 'PT400:invalid_wants_app');
select t.check('5000 char description', t.run(replace(t.lead('d8@posteo.de'), 'p_description => null', 'p_description => repeat(''x'', 5000)')), 'PT400:invalid_description');
select t.check('sql injection text is stored as plain text', t.run(replace(t.lead('e1@posteo.de'), 'p_description => null', $$p_description => 'x''); drop table public.leads; --'$$)), 'OK');
select t.check('formula + control chars', t.run(replace(t.lead('e2@posteo.de'), 'p_description => null', $$p_description => E'=HYPERLINK("http://evil")\n\t  two   spaces' || chr(8238)$$)), 'OK');
select t.check('hostile source',        t.run(replace(t.lead('e3@posteo.de'), $$p_source => 'direct'$$, $$p_source => '<img src=x onerror=alert(1)>"; DROP'$$)), 'OK');
select t.check('helper signup',         t.run(replace(replace(t.lead('e4@posteo.de'), $$p_role => 'seeker'$$, $$p_role => 'helper'$$), 'p_experience_level => null', $$p_experience_level => 'pro'$$)), 'OK');
reset role;
select t.check('leads table survived',  (select count(*)::text from public.leads), '6');
select t.check('email normalised',      (select email from public.leads where email like 'anna%'), 'anna.beispiel@posteo.de');
select t.check('injection kept as text', (select description from public.leads where email = 'e1@posteo.de'), $$x'); drop table public.leads; --$$);
select t.check('formula defused, text cleaned', (select description from public.leads where email = 'e2@posteo.de'), $$'=HYPERLINK("http://evil") two spaces$$);
select t.check('source sanitised',      (select source from public.leads where email = 'e3@posteo.de'), 'imgsrcxonerroralert1drop');
select t.check('helper description dropped, level kept', (select coalesce(description, '-') || '/' || experience_level from public.leads where email = 'e4@posteo.de'), '-/pro');

\echo == 5. Rate limits
update private.config set value = 5 where key = 'lead_per_ip_hour';
set role anon;
select t.ip('10.0.0.50');
select t.check('signup 1 of 5',         t.run(t.lead('r1@posteo.de')), 'OK');
select t.check('signup 2 of 5',         t.run(t.lead('r2@posteo.de')), 'OK');
select t.check('signup 3 of 5',         t.run(t.lead('r3@posteo.de')), 'OK');
select t.check('signup 4 of 5',         t.run(t.lead('r4@posteo.de')), 'OK');
select t.check('signup 5 of 5',         t.run(t.lead('r5@posteo.de')), 'OK');
select t.check('6th from same connection blocked', t.run(t.lead('r6@posteo.de')), 'PT429:rate_limited');
select t.check('blocked even with garbage (no work done)', t.run(replace(t.lead('r7@posteo.de'), 't.proof()', 'null')), 'PT429:rate_limited');
select t.ip('10.0.0.51');
select t.check('other connection unaffected', t.run(t.lead('r8@posteo.de')), 'OK');
select t.check('spoofed x-forwarded-for ignored when cf header present',
  t.run($$select set_config('request.headers', '{"cf-connecting-ip":"10.0.0.50","x-forwarded-for":"9.9.9.9"}', false)$$) || '/' || t.run(t.lead('r9@posteo.de')),
  'OK/PT429:rate_limited');
reset role;
update private.config set value = 3 where key = 'challenge_per_ip_hour';
set role anon;
select t.ip('10.0.0.60');
select t.check('challenge 1-3',         t.run('select public.get_challenge()') || t.run('select public.get_challenge()') || t.run('select public.get_challenge()'), 'OKOKOK');
select t.check('4th challenge blocked', t.run('select public.get_challenge()'), 'PT429:rate_limited');
reset role;
update private.config set value = 100000 where key = 'challenge_per_ip_hour';
update private.config set value = (select n + 1 from private.counters where bucket = 'lead_global_hour') where key = 'lead_global_hour';
set role anon;
select t.ip('10.0.0.70');
select t.check('last slot under global ceiling', t.run(t.lead('g1@posteo.de')), 'OK');
select t.ip('10.0.0.71');
select t.check('global ceiling reached', t.run(t.lead('g2@posteo.de')), 'PT503:busy');
reset role;
update private.config set value = 300 where key = 'lead_global_hour';

\echo == 6. Event counters
set role anon;
select t.ip('10.0.0.80');
select t.check('valid events', t.run($$select public.log_event('pageview', '/', 'de', 'instagram')$$) || t.run($$select public.log_event('waitlist_joined_seeker', '/finden', 'en', 'Insta<gram>', true)$$), 'OKOK');
select t.check('unknown name ignored',  t.run($$select public.log_event('<script>alert(1)</script>', '/', 'de', 'x')$$), 'OK');
select t.check('unknown path ignored',  t.run($$select public.log_event('pageview', '/admin/../../etc/passwd', 'de', 'x')$$), 'OK');
select t.check('megabyte payload ignored', t.run($$select public.log_event(repeat('A', 1000000), '/', 'de', 'x')$$), 'OK');
reset role;
select t.check('only the 2 valid events stored', (select count(*)::text from public.events), '2');
select t.check('event source sanitised', (select source from public.events where name = 'waitlist_joined_seeker'), 'instagram');
update private.config set value = 5 where key = 'event_per_ip_minute';
set role anon;
select t.ip('10.0.0.81');
select public.log_event('pageview', '/', 'de', 'flood') from generate_series(1, 200);
reset role;
select t.check('flood of 200 capped at 5 per connection', (select count(*)::text from public.events where source = 'flood'), '5');
update private.config set value = 100000 where key = 'event_per_ip_minute';
update private.config set value = (select n + 2 from private.counters where bucket = 'event_global_day') where key = 'event_global_day';
set role anon;
select t.ip('10.0.0.82');
select public.log_event('pageview', '/', 'de', 'cap') from generate_series(1, 50);
reset role;
select t.check('global daily ceiling holds (2 of 50 stored)', (select count(*)::text from public.events where source = 'cap'), '2');

\echo == 7. Housekeeping and your own view of the data
select t.check('purge runs',            t.run('select private.purge()'), 'OK');
select t.check('no raw IP stored anywhere', (select count(*)::text from private.counters where bucket ~ '\d+\.\d+\.\d+\.\d+'), '0');
select t.check('overview readable by owner', (select signups_total::text from public.demand_overview), '13');
select t.check('by_hour readable by owner',  (select sum(signups)::text from public.demand_by_hour), '13');
select t.check('conversion readable by owner', (select landing_visits::text from public.demand_conversion), '8');

drop schema t cascade;

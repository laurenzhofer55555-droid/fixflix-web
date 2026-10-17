-- FixFlix demand test — run once in the Supabase SQL editor on a fresh project.
--
-- Security model. The anon key ships inside the website bundle, so anybody can
-- call the API without ever opening the site. Therefore:
--   * visitors have NO table privileges at all — they may only call three
--     functions (get_challenge, submit_lead, log_event);
--   * those functions validate and sanitise every field, apply per-IP and
--     global rate limits, and require a proof-of-work solved by the
--     "I am not a robot" checkbox before a lead is stored;
--   * limits and secrets live in schema `private`, which no API role can reach.
-- Only you (SQL editor / dashboard = postgres role) can read the data.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Private helpers: config, secrets, counters
-- ---------------------------------------------------------------------------

-- Tune any limit with:  update private.config set value = 10 where key = 'lead_per_ip_hour';
create table if not exists private.config (
  key   text primary key,
  value bigint not null
);

insert into private.config (key, value) values
  ('lead_per_ip_hour',      5),      -- sign-ups per connection and hour (families/offices share one)
  ('lead_global_hour',      300),    -- hard ceiling for all sign-ups per hour
  ('lead_global_day',       2000),   -- … and per day
  ('challenge_per_ip_hour', 30),     -- "I am not a robot" attempts per connection and hour
  ('event_per_ip_minute',   40),     -- page-view/funnel counters per connection and minute
  ('event_global_day',      20000),  -- ceiling that keeps the free 500 MB database from filling up
  ('pow_max_number',        100000), -- proof-of-work effort: ~0.5-2 s in a phone browser
  ('challenge_ttl_seconds', 900)     -- how long a solved checkbox stays valid
on conflict (key) do nothing;

create table if not exists private.secrets (
  name  text primary key,
  value text not null
);

insert into private.secrets (name, value) values
  ('pow_hmac', encode(extensions.gen_random_bytes(32), 'hex')),
  ('ip_salt',  encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

-- Fixed-window counters; bucket examples: 'lead:<ip-hash>', 'lead_global_hour', 'event_global_day'.
create table if not exists private.counters (
  bucket       text        not null,
  window_start timestamptz not null,
  n            integer     not null default 0,
  primary key (bucket, window_start)
);

-- Solved challenges can be used exactly once.
create table if not exists private.used_challenges (
  salt    text primary key,
  used_at timestamptz not null default now()
);

create table if not exists private.blocked_domains (
  domain text primary key
);

insert into private.blocked_domains (domain) values
  ('example.com'), ('example.org'), ('example.net'),
  ('mailinator.com'), ('guerrillamail.com'), ('guerrillamail.net'), ('guerrillamail.org'),
  ('sharklasers.com'), ('10minutemail.com'), ('10minutemail.net'), ('tempmail.com'),
  ('temp-mail.org'), ('temp-mail.io'), ('yopmail.com'), ('yopmail.fr'), ('trashmail.com'),
  ('trashmail.de'), ('trash-mail.com'), ('throwawaymail.com'), ('getnada.com'),
  ('dispostable.com'), ('maildrop.cc'), ('mailnesia.com'), ('fakeinbox.com'),
  ('spamgourmet.com'), ('mintemail.com'), ('emailondeck.com'), ('mohmal.com'),
  ('tempinbox.com'), ('discard.email'), ('wegwerfmail.de'), ('wegwerfemail.de'),
  ('einrot.com'), ('byom.de'), ('spambox.us'), ('mytemp.email'), ('tempr.email'),
  ('burnermail.io'), ('inboxkitten.com'), ('mailcatch.com'), ('moakt.com'), ('tmail.ws')
on conflict (domain) do nothing;

-- ---------------------------------------------------------------------------
-- Data tables (readable only by you)
-- ---------------------------------------------------------------------------

create or replace function private.valid_email(p_email text) returns boolean
language sql immutable set search_path = ''
as $$
  select p_email ~ '^[a-z0-9][a-z0-9._%+\-]{0,63}@[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$'
     and p_email !~ '\.\.'
     and char_length(p_email) <= 254
$$;

create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  role             text not null check (role in ('seeker', 'helper')),
  email            text not null check (private.valid_email(email)),
  postal_code      text not null check (postal_code ~ '^\d{5}$'),
  locale           text not null default 'de' check (locale in ('de', 'en')),
  categories       text[] not null check (
                     cardinality(categories) between 1 and 7
                     and categories <@ array['assemble', 'repair', 'mount', 'paint', 'garden', 'transport', 'household']
                   ),
  description      text check (char_length(description) <= 501),
  experience_level text check (experience_level in ('hobby', 'advanced', 'pro')),
  wants_app        boolean not null,
  source           text check (source ~ '^[a-z0-9._:\-]{1,40}$'),
  check (role = 'seeker' or experience_level is not null)
);

-- One signup per email and role; duplicates are accepted silently by submit_lead.
create unique index if not exists leads_email_role_key on public.leads (lower(email), role);
create index if not exists leads_created_idx on public.leads (created_at);

create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null,
  path       text not null,
  locale     text,
  source     text,
  wants_app  boolean
);

create index if not exists events_name_created_idx on public.events (name, created_at);
create index if not exists events_created_idx on public.events (created_at);

alter table public.leads  enable row level security;
alter table public.events enable row level security;

-- ---------------------------------------------------------------------------
-- Private functions
-- ---------------------------------------------------------------------------

create or replace function private.cfg(p_key text) returns bigint
language sql stable security definer set search_path = ''
as $$ select value from private.config where key = p_key $$;

-- Pseudonymous, daily-rotating fingerprint of the caller's connection. Supabase
-- sits behind Cloudflare, which sets cf-connecting-ip itself, so clients cannot forge it.
create or replace function private.client_ip_hash() returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ip text := coalesce(
    nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''),
    nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), ''),
    'unknown'
  );
begin
  return encode(
    extensions.hmac(v_ip || ':' || current_date::text, (select value from private.secrets where name = 'ip_salt'), 'sha256'),
    'hex'
  );
end
$$;

-- Counts one hit in the current window; false once the limit is exceeded.
create or replace function private.bump(p_bucket text, p_unit text, p_limit bigint) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into private.counters as c (bucket, window_start, n)
  values (p_bucket, date_trunc(p_unit, now()), 1)
  on conflict (bucket, window_start) do update set n = c.n + 1
  returning c.n into v_n;

  return v_n <= p_limit;
end
$$;

create or replace function private.clean_source(p_source text) returns text
language sql immutable set search_path = ''
as $$
  select coalesce(
    nullif(left(regexp_replace(lower(coalesce(p_source, '')), '[^a-z0-9._:\-]', '', 'g'), 40), ''),
    'direct'
  )
$$;

-- Free text: no control or direction-override characters, collapsed whitespace,
-- and a leading apostrophe when a spreadsheet would read it as a formula.
create or replace function private.clean_text(p_text text, p_max integer) returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text;
begin
  if p_text is null then
    return null;
  end if;

  v := regexp_replace(p_text, '[​-‏‪-‮⁠-⁤﻿]', '', 'g');
  v := btrim(regexp_replace(regexp_replace(v, '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'));

  if v = '' then
    return null;
  end if;
  if char_length(v) > p_max then
    raise exception 'invalid_description' using errcode = 'PT400';
  end if;
  if left(v, 1) in ('=', '+', '-', '@') then
    v := '''' || v;
  end if;
  return v;
end
$$;

create or replace function private.verify_pow(p_pow jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_salt      text := p_pow ->> 'salt';
  v_challenge text := p_pow ->> 'challenge';
  v_signature text := p_pow ->> 'signature';
  v_number    text := p_pow ->> 'number';
  v_secret    text := (select value from private.secrets where name = 'pow_hmac');
  v_expires   bigint;
begin
  if v_salt is null or v_challenge is null or v_signature is null or v_number is null
     or v_salt !~ '^[0-9a-f]{24}\.\d{1,12}$'
     or v_challenge !~ '^[0-9a-f]{64}$'
     or v_signature !~ '^[0-9a-f]{64}$'
     or v_number !~ '^\d{1,9}$' then
    raise exception 'bad_challenge' using errcode = 'PT400';
  end if;

  -- The server issued this challenge (signature) and the client really did the work (hash).
  if encode(extensions.hmac(v_challenge || '.' || v_salt, v_secret, 'sha256'), 'hex') <> v_signature
     or encode(extensions.digest(v_salt || v_number, 'sha256'), 'hex') <> v_challenge then
    raise exception 'bad_challenge' using errcode = 'PT400';
  end if;

  v_expires := split_part(v_salt, '.', 2)::bigint;
  if v_expires < extract(epoch from now()) then
    raise exception 'challenge_expired' using errcode = 'PT410';
  end if;

  insert into private.used_challenges (salt) values (v_salt) on conflict do nothing;
  if not found then
    raise exception 'bad_challenge' using errcode = 'PT400';
  end if;
end
$$;

create or replace function private.purge() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from private.counters where window_start < now() - interval '2 days';
  delete from private.used_challenges where used_at < now() - interval '1 day';
  delete from public.events
   where id in (select id from public.events where created_at < now() - interval '180 days' limit 1000);
end
$$;

-- ---------------------------------------------------------------------------
-- Public API (the only things the anon key may call)
-- ---------------------------------------------------------------------------

-- Hands out a puzzle: find n < maxnumber with sha256(salt || n) = challenge.
create or replace function public.get_challenge() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_max       bigint := private.cfg('pow_max_number');
  v_secret    text   := (select value from private.secrets where name = 'pow_hmac');
  v_number    bigint;
  v_salt      text;
  v_challenge text;
begin
  if not private.bump('challenge:' || private.client_ip_hash(), 'hour', private.cfg('challenge_per_ip_hour')) then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;

  v_number    := ('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % v_max;
  v_salt      := encode(extensions.gen_random_bytes(12), 'hex') || '.'
                 || (extract(epoch from now())::bigint + private.cfg('challenge_ttl_seconds'))::text;
  v_challenge := encode(extensions.digest(v_salt || v_number::text, 'sha256'), 'hex');

  return jsonb_build_object(
    'salt', v_salt,
    'challenge', v_challenge,
    'signature', encode(extensions.hmac(v_challenge || '.' || v_salt, v_secret, 'sha256'), 'hex'),
    'maxnumber', v_max
  );
end
$$;

create or replace function public.submit_lead(
  p_role             text,
  p_email            text,
  p_postal_code      text,
  p_locale           text,
  p_categories       text[],
  p_description      text,
  p_experience_level text,
  p_wants_app        boolean,
  p_source           text,
  p_pow              jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ip         text := private.client_ip_hash();
  v_email       text := lower(btrim(coalesce(p_email, '')));
  v_categories  text[];
  v_description text;
begin
  -- Limits first: a flood must not cost more than a counter update.
  if not private.bump('lead:' || v_ip, 'hour', private.cfg('lead_per_ip_hour')) then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  if not private.bump('lead_global_hour', 'hour', private.cfg('lead_global_hour'))
     or not private.bump('lead_global_day', 'day', private.cfg('lead_global_day')) then
    raise exception 'busy' using errcode = 'PT503';
  end if;

  if p_role is null or p_role not in ('seeker', 'helper') then
    raise exception 'invalid_role' using errcode = 'PT400';
  end if;
  if not private.valid_email(v_email) then
    raise exception 'invalid_email' using errcode = 'PT400';
  end if;
  if exists (select 1 from private.blocked_domains where domain = split_part(v_email, '@', 2)) then
    raise exception 'email_not_allowed' using errcode = 'PT400';
  end if;
  if p_postal_code is null or p_postal_code !~ '^\d{5}$' then
    raise exception 'invalid_postal_code' using errcode = 'PT400';
  end if;
  if p_categories is null or cardinality(p_categories) not between 1 and 7
     or not p_categories <@ array['assemble', 'repair', 'mount', 'paint', 'garden', 'transport', 'household'] then
    raise exception 'invalid_categories' using errcode = 'PT400';
  end if;
  if p_role = 'helper' and (p_experience_level is null or p_experience_level not in ('hobby', 'advanced', 'pro')) then
    raise exception 'invalid_experience_level' using errcode = 'PT400';
  end if;
  if p_wants_app is null then
    raise exception 'invalid_wants_app' using errcode = 'PT400';
  end if;
  if p_role = 'seeker' then
    v_description := private.clean_text(p_description, 500);
  end if;

  -- Checked last so a typo in the form does not use up the visitor's solved puzzle.
  perform private.verify_pow(p_pow);

  select array_agg(distinct c order by c) into v_categories from unnest(p_categories) as c;

  insert into public.leads (
    role, email, postal_code, locale, categories, description, experience_level, wants_app, source
  ) values (
    p_role,
    v_email,
    p_postal_code,
    case when p_locale = 'en' then 'en' else 'de' end,
    v_categories,
    v_description,
    case when p_role = 'helper' then p_experience_level end,
    p_wants_app,
    private.clean_source(p_source)
  )
  on conflict (lower(email), role) do nothing;

  if random() < 0.02 then
    perform private.purge();
  end if;

  -- Same answer for new and repeated addresses: nobody can probe who signed up.
  return jsonb_build_object('ok', true);
end
$$;

-- Anonymous funnel counters. Anything off-list or over a limit is dropped
-- silently — counters are low-trust, and rejecting loudly would only teach attackers.
create or replace function public.log_event(
  p_name      text,
  p_path      text,
  p_locale    text,
  p_source    text,
  p_wants_app boolean default null
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_name is null or p_name not in (
       'pageview', 'funnel_start_seeker', 'funnel_start_helper',
       'step_completed_seeker_1', 'step_completed_seeker_2',
       'step_completed_helper_1', 'step_completed_helper_2',
       'waitlist_joined_seeker', 'waitlist_joined_helper'
     )
     or p_path is null or p_path not in ('/', '/finden', '/helfen', '/erfolg', '/impressum', '/datenschutz') then
    return;
  end if;

  if not private.bump('event:' || private.client_ip_hash(), 'minute', private.cfg('event_per_ip_minute'))
     or not private.bump('event_global_day', 'day', private.cfg('event_global_day')) then
    return;
  end if;

  insert into public.events (name, path, locale, source, wants_app)
  values (
    p_name,
    p_path,
    case when p_locale = 'en' then 'en' else 'de' end,
    private.clean_source(p_source),
    p_wants_app
  );

  if random() < 0.02 then
    perform private.purge();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Privileges: visitors get the three functions and nothing else
-- ---------------------------------------------------------------------------

-- Explicit on purpose: projects created since mid-2026 no longer expose
-- new objects to the API roles by default.
grant usage on schema public to anon;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function public.get_challenge() to anon;
grant execute on function public.submit_lead(text, text, text, text, text[], text, text, boolean, text, jsonb) to anon;
grant execute on function public.log_event(text, text, text, text, boolean) to anon;

-- ---------------------------------------------------------------------------
-- Reading the numbers (SQL editor):  select * from demand_overview;
-- security_invoker + revoked grants keep the views invisible to the anon key.
-- ---------------------------------------------------------------------------

create or replace view public.demand_overview with (security_invoker = true) as
select
  count(*)                                                            as signups_total,
  count(*) filter (where role = 'seeker')                             as seekers,
  count(*) filter (where role = 'helper')                             as helpers,
  count(*) filter (where wants_app)                                   as would_use_app,
  round(100.0 * count(*) filter (where wants_app) / nullif(count(*), 0), 1) as would_use_app_pct,
  min(created_at)                                                     as first_signup,
  max(created_at)                                                     as last_signup
from public.leads;

-- visit_to_signup_pct is only meaningful while visitors arrive via "/"; links
-- pointing straight at /finden or /helfen skip the landing count, so judge
-- those by the *_completion_pct columns instead. Events are low-trust
-- counters; the leads behind demand_overview are the numbers to rely on.
create or replace view public.demand_conversion with (security_invoker = true) as
select
  count(*) filter (where name = 'pageview' and path = '/')            as landing_visits,
  count(*) filter (where name = 'funnel_start_seeker')                as seeker_started,
  count(*) filter (where name = 'waitlist_joined_seeker')             as seeker_joined,
  round(
    100.0 * count(*) filter (where name = 'waitlist_joined_seeker')
    / nullif(count(*) filter (where name = 'funnel_start_seeker'), 0),
    1
  )                                                                   as seeker_completion_pct,
  count(*) filter (where name = 'funnel_start_helper')                as helper_started,
  count(*) filter (where name = 'waitlist_joined_helper')             as helper_joined,
  round(
    100.0 * count(*) filter (where name = 'waitlist_joined_helper')
    / nullif(count(*) filter (where name = 'funnel_start_helper'), 0),
    1
  )                                                                   as helper_completion_pct,
  round(
    100.0 * count(*) filter (where name like 'waitlist_joined_%')
    / nullif(count(*) filter (where name = 'pageview' and path = '/'), 0),
    1
  )                                                                   as visit_to_signup_pct
from public.events;

create or replace view public.demand_by_source with (security_invoker = true) as
select coalesce(source, 'direct') as source, count(*) as signups
from public.leads
group by 1
order by signups desc;

create or replace view public.demand_by_category with (security_invoker = true) as
select category, role, count(*) as signups
from public.leads, unnest(categories) as category
group by category, role
order by signups desc;

create or replace view public.demand_by_region with (security_invoker = true) as
select left(postal_code, 2) as plz_region, role, count(*) as signups
from public.leads
group by 1, 2
order by signups desc;

-- Bursts stand out here: genuine interest grows over days, spam arrives in one hour.
create or replace view public.demand_by_hour with (security_invoker = true) as
select date_trunc('hour', created_at) as hour, count(*) as signups
from public.leads
where created_at > now() - interval '48 hours'
group by 1
order by 1 desc;

revoke all on
  public.demand_overview,
  public.demand_conversion,
  public.demand_by_source,
  public.demand_by_category,
  public.demand_by_region,
  public.demand_by_hour
from anon, authenticated;

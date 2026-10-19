-- FixFlix demand test — paste into the Supabase SQL editor and run. Safe to
-- run again after every update: it only adds what is missing and replaces
-- functions and views; your sign-ups, limits and secrets stay untouched.
--
-- Security model. The anon key ships inside the website bundle, so anybody can
-- call the API without ever opening the site. Therefore:
--   * visitors have NO table privileges at all — they may only call four
--     functions (get_challenge, submit_lead, confirm_lead, log_event);
--   * those functions validate and sanitise every field, apply per-IP and
--     global rate limits, and require a proof-of-work solved by the
--     "I am not a robot" checkbox before a lead is stored;
--   * once a mail service is configured (see private.settings), a sign-up only
--     counts after the address owner clicked the link in a confirmation mail;
--   * limits and secrets live in schema `private`, which no API role can reach.
-- Only you (SQL editor / dashboard = postgres role) can read the data.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- pg_net sends the confirmation mails, pg_cron runs the daily clean-up. Both
-- ship with Supabase; elsewhere (local tests) the script works without them.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
end
$$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Private helpers: config, settings, secrets, counters
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
  ('event_per_ip_day',      400),    -- … and per day, so one connection cannot fill the daily ceiling
  ('event_global_day',      20000),  -- ceiling that keeps the free 500 MB database from filling up
  ('pow_max_number',        100000), -- proof-of-work effort: ~0.5-2 s in a phone browser
  ('challenge_ttl_seconds', 900),    -- how long a solved checkbox stays valid
  ('confirm_per_ip_hour',   30),     -- confirmation-link clicks per connection and hour
  ('confirm_days',          7),      -- confirmation links expire, unconfirmed sign-ups are deleted
  ('mail_per_address_day',  3),      -- confirmation mails to one address per day (no inbox flooding)
  ('mail_global_day',       250),    -- stay below the mail service's free daily quota
  ('lead_retention_months', 24)      -- the privacy policy promises deletion after 24 months
on conflict (key) do nothing;

-- Text settings. Turn on confirmation mails once the mail service is set up:
--   select vault.create_secret('<API key>', 'mail_api_key');
--   update private.settings set value = 'brevo' where key = 'mail_provider';   -- or 'resend'
create table if not exists private.settings (
  key   text primary key,
  value text not null
);

insert into private.settings (key, value) values
  ('mail_provider',     ''),  -- '' = no mails, sign-ups count at once; 'brevo' or 'resend'
  ('site_url',          'https://fixflix.space'),
  ('mail_from_name',    'FixFlix'),
  ('mail_from_address', 'hallo@fixflix.space'),
  ('mail_reply_to',     'kontakt@fixflix.space'),
  ('mail_operator',     'Laurenz Hofer · Berg 112 · 83734 Hausham')
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
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  role               text not null check (role in ('seeker', 'helper')),
  email              text not null check (private.valid_email(email)),
  postal_code        text not null check (postal_code ~ '^\d{5}$'),
  locale             text not null default 'de' check (locale in ('de', 'en')),
  categories         text[] not null check (
                       cardinality(categories) between 1 and 7
                       and categories <@ array['assemble', 'repair', 'mount', 'paint', 'garden', 'transport', 'household']
                     ),
  description        text check (char_length(description) <= 501),
  experience_level   text check (experience_level in ('hobby', 'advanced', 'pro')),
  wants_app          boolean not null,
  source             text check (source ~ '^[a-z0-9._:\-]{1,40}$'),
  confirmed_at       timestamptz,
  confirm_token_hash text,
  confirm_sent_at    timestamptz,
  check (role = 'seeker' or experience_level is not null)
);

-- Upgrade for projects created before e-mail confirmation existed: their
-- sign-ups were never asked to confirm, so they keep counting.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'leads' and column_name = 'confirmed_at') then
    alter table public.leads add column confirmed_at timestamptz;
    update public.leads set confirmed_at = created_at;
  end if;
end
$$;
alter table public.leads add column if not exists confirm_token_hash text;
alter table public.leads add column if not exists confirm_sent_at timestamptz;

-- One signup per email and role; duplicates are accepted silently by submit_lead.
create unique index if not exists leads_email_role_key on public.leads (lower(email), role);
create index if not exists leads_created_idx on public.leads (created_at);
create unique index if not exists leads_confirm_token_key on public.leads (confirm_token_hash)
  where confirm_token_hash is not null;

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

create or replace function private.setting(p_key text) returns text
language sql stable security definer set search_path = ''
as $$ select coalesce((select value from private.settings where key = p_key), '') $$;

-- Pseudonymous, daily-rotating fingerprint of the caller's connection. Supabase
-- sits behind Cloudflare, which sets cf-connecting-ip itself, so clients cannot forge it.
-- IPv6 users get a whole /64 network from their provider, so that is what counts as
-- one connection — otherwise one household could pose as billions of visitors.
create or replace function private.client_ip_hash() returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_raw text := coalesce(
    nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''),
    nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), '')
  );
  v_ip text;
begin
  begin
    v_ip := case when family(v_raw::inet) = 6 then network(set_masklen(v_raw::inet, 64))::text
                 else host(v_raw::inet) end;
  exception when others then
    v_ip := null;
  end;

  return encode(
    extensions.hmac(coalesce(v_ip, 'unknown') || ':' || current_date::text,
                    (select value from private.secrets where name = 'ip_salt'), 'sha256'),
    'hex'
  );
end
$$;

-- Lets the mail limit recognise an address without storing it in the counters.
create or replace function private.email_hash(p_email text) returns text
language sql stable security definer set search_path = ''
as $$
  select encode(extensions.hmac(lower(p_email), (select value from private.secrets where name = 'ip_salt'), 'sha256'), 'hex')
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

-- The API key lives encrypted in Supabase Vault, never in this file or a table.
create or replace function private.mail_api_key() returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_key text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_key using 'mail_api_key';
  return nullif(btrim(v_key), '');
end
$$;

-- Confirmation is on only when every piece is in place; until then sign-ups count at once.
create or replace function private.mail_enabled() returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.setting('mail_provider') in ('brevo', 'resend')
     and to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is not null
     and private.mail_api_key() is not null
$$;

-- Queues the confirmation mail (pg_net sends it right after the sign-up commits).
-- The text is fixed: nothing a visitor typed ends up in the mail, so the form
-- cannot be used to send spam or phishing to strangers.
create or replace function private.send_confirmation(p_email text, p_locale text, p_token text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_provider text := private.setting('mail_provider');
  v_site     text := private.setting('site_url');
  v_link     text := private.setting('site_url') || '/bestaetigen#' || p_token;
  v_days     int  := private.cfg('confirm_days');
  v_from     text := private.setting('mail_from_address');
  v_name     text := private.setting('mail_from_name');
  v_reply    text := private.setting('mail_reply_to');
  v_footer   text := private.setting('mail_operator');
  v_subject  text;
  v_text     text;
  v_html     text;
begin
  if not private.bump('mail:' || private.email_hash(p_email), 'day', private.cfg('mail_per_address_day'))
     or not private.bump('mail_global_day', 'day', private.cfg('mail_global_day')) then
    return;
  end if;

  if p_locale = 'en' then
    v_subject := 'Please confirm your FixFlix sign-up';
    v_text := format(E'Hi,\n\nthanks for your interest in FixFlix! Please confirm your email address so we can add you to the waitlist:\n\n%s\n\nThe link is valid for %s days. If you did not sign up yourself, just ignore this email and your address will be deleted automatically.\n\nBest regards\nFixFlix\n\n%s · %s/impressum', v_link, v_days, v_footer, v_site);
    v_html := format('<p>Hi,</p><p>thanks for your interest in FixFlix! Please confirm your email address so we can add you to the waitlist:</p><p><a href="%s" style="display:inline-block;padding:12px 24px;border-radius:999px;background:#f97316;color:#fff;font-weight:bold;text-decoration:none">Confirm email address</a></p><p>The link is valid for %s days. If you did not sign up yourself, just ignore this email and your address will be deleted automatically.</p><p>Best regards<br>FixFlix</p><p style="color:#888;font-size:12px">%s · <a href="%s/impressum">Legal notice</a></p>', v_link, v_days, v_footer, v_site);
  else
    v_subject := 'Bitte bestätige deine Anmeldung bei FixFlix';
    v_text := format(E'Hallo,\n\ndanke für dein Interesse an FixFlix! Bitte bestätige deine E-Mail-Adresse, damit wir dich auf die Warteliste setzen können:\n\n%s\n\nDer Link ist %s Tage gültig. Falls du dich nicht selbst eingetragen hast, ignoriere diese Mail einfach. Deine Adresse wird dann automatisch gelöscht.\n\nViele Grüße\nFixFlix\n\n%s · %s/impressum', v_link, v_days, v_footer, v_site);
    v_html := format('<p>Hallo,</p><p>danke für dein Interesse an FixFlix! Bitte bestätige deine E-Mail-Adresse, damit wir dich auf die Warteliste setzen können:</p><p><a href="%s" style="display:inline-block;padding:12px 24px;border-radius:999px;background:#f97316;color:#fff;font-weight:bold;text-decoration:none">E-Mail-Adresse bestätigen</a></p><p>Der Link ist %s Tage gültig. Falls du dich nicht selbst eingetragen hast, ignoriere diese Mail einfach. Deine Adresse wird dann automatisch gelöscht.</p><p>Viele Grüße<br>FixFlix</p><p style="color:#888;font-size:12px">%s · <a href="%s/impressum">Impressum</a></p>', v_link, v_days, v_footer, v_site);
  end if;

  if v_provider = 'brevo' then
    perform net.http_post(
      url := 'https://api.brevo.com/v3/smtp/email',
      body := jsonb_build_object(
        'sender', jsonb_build_object('name', v_name, 'email', v_from),
        'to', jsonb_build_array(jsonb_build_object('email', p_email)),
        'replyTo', jsonb_build_object('email', v_reply),
        'subject', v_subject, 'textContent', v_text, 'htmlContent', v_html),
      params := '{}'::jsonb,
      headers := jsonb_build_object('api-key', private.mail_api_key(), 'Content-Type', 'application/json', 'Accept', 'application/json'),
      timeout_milliseconds := 10000);
  elsif v_provider = 'resend' then
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      body := jsonb_build_object(
        'from', v_name || ' <' || v_from || '>',
        'to', jsonb_build_array(p_email),
        'reply_to', v_reply,
        'subject', v_subject, 'text', v_text, 'html', v_html),
      params := '{}'::jsonb,
      headers := jsonb_build_object('Authorization', 'Bearer ' || private.mail_api_key(), 'Content-Type', 'application/json'),
      timeout_milliseconds := 10000);
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
  -- Never confirmed: the address may not even belong to whoever typed it in.
  delete from public.leads
   where confirmed_at is null
     and coalesce(confirm_sent_at, created_at) < now() - make_interval(days => private.cfg('confirm_days')::int);
  delete from public.leads
   where created_at < now() - make_interval(months => private.cfg('lead_retention_months')::int);
end
$$;

-- Daily clean-up, independent of traffic (the random calls below are only a fallback).
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('fixflix-purge', '17 3 * * *', 'select private.purge()');
  end if;
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
  v_ip          text := private.client_ip_hash();
  v_email       text := lower(btrim(coalesce(p_email, '')));
  v_locale      text := case when p_locale = 'en' then 'en' else 'de' end;
  v_confirm     boolean := private.mail_enabled();
  v_token       text;
  v_categories  text[];
  v_description text;
  v_rows        integer;
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

  if v_confirm then
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
  end if;

  insert into public.leads (
    role, email, postal_code, locale, categories, description, experience_level, wants_app, source,
    confirmed_at, confirm_token_hash, confirm_sent_at
  ) values (
    p_role,
    v_email,
    p_postal_code,
    v_locale,
    v_categories,
    v_description,
    case when p_role = 'helper' then p_experience_level end,
    p_wants_app,
    private.clean_source(p_source),
    case when v_confirm then null else now() end,
    case when v_confirm then encode(extensions.digest(v_token, 'sha256'), 'hex') end,
    case when v_confirm then now() end
  )
  -- Signing up again before confirming replaces the answers and sends a fresh
  -- link; a confirmed sign-up is never touched.
  on conflict (lower(email), role) do update set
    postal_code        = excluded.postal_code,
    locale             = excluded.locale,
    categories         = excluded.categories,
    description        = excluded.description,
    experience_level   = excluded.experience_level,
    wants_app          = excluded.wants_app,
    source             = excluded.source,
    confirm_token_hash = excluded.confirm_token_hash,
    confirm_sent_at    = excluded.confirm_sent_at
  where public.leads.confirmed_at is null and excluded.confirm_token_hash is not null;
  get diagnostics v_rows = row_count;

  if v_confirm and v_rows = 1 then
    perform private.send_confirmation(v_email, v_locale, v_token);
  end if;

  if random() < 0.02 then
    perform private.purge();
  end if;

  -- Same answer for new and repeated addresses: nobody can probe who signed up.
  return jsonb_build_object('ok', true, 'confirm', v_confirm);
end
$$;

-- The link in the confirmation mail carries a random 256-bit token; only its
-- hash is stored, so even a database leak reveals no working links. Bad links
-- get a normal answer instead of an error: an error would roll back the
-- rate-limit counter too, and guessing would never be throttled.
create or replace function public.confirm_lead(p_token text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_hash      text;
  v_confirmed boolean;
begin
  if not private.bump('confirm:' || private.client_ip_hash(), 'hour', private.cfg('confirm_per_ip_hour')) then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  update public.leads set confirmed_at = now()
   where confirm_token_hash = v_hash
     and confirmed_at is null
     and confirm_sent_at > now() - make_interval(days => private.cfg('confirm_days')::int);
  if found then
    return jsonb_build_object('status', 'confirmed');
  end if;

  select confirmed_at is not null into v_confirmed from public.leads where confirm_token_hash = v_hash;
  return jsonb_build_object('status', case
    when v_confirmed is null then 'invalid'
    when v_confirmed then 'already_confirmed'
    else 'expired'
  end);
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
declare
  v_ip text;
begin
  if p_name is null or p_name not in (
       'pageview', 'funnel_start_seeker', 'funnel_start_helper',
       'step_completed_seeker_1', 'step_completed_seeker_2',
       'step_completed_helper_1', 'step_completed_helper_2',
       'waitlist_joined_seeker', 'waitlist_joined_helper'
     )
     or p_path is null
     or p_path not in ('/', '/finden', '/helfen', '/erfolg', '/bestaetigen', '/impressum', '/datenschutz') then
    return;
  end if;

  v_ip := private.client_ip_hash();
  if not private.bump('event:' || v_ip, 'minute', private.cfg('event_per_ip_minute'))
     or not private.bump('event_day:' || v_ip, 'day', private.cfg('event_per_ip_day'))
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
-- Privileges: visitors get the four functions and nothing else
-- ---------------------------------------------------------------------------

-- Explicit on purpose: projects created since mid-2026 no longer expose
-- new objects to the API roles by default.
grant usage on schema public to anon;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function public.get_challenge() to anon;
grant execute on function public.submit_lead(text, text, text, text, text[], text, text, boolean, text, jsonb) to anon;
grant execute on function public.confirm_lead(text) to anon;
grant execute on function public.log_event(text, text, text, text, boolean) to anon;

-- ---------------------------------------------------------------------------
-- Reading the numbers (SQL editor):  select * from demand_overview;
-- Only confirmed sign-ups count. security_invoker + revoked grants keep the
-- views invisible to the anon key.
-- ---------------------------------------------------------------------------

drop view if exists
  public.demand_overview, public.demand_conversion, public.demand_by_source, public.demand_by_category,
  public.demand_by_region, public.demand_by_hour, public.limit_hits;

create view public.demand_overview with (security_invoker = true) as
select
  count(*) filter (where confirmed_at is not null)                    as signups_total,
  count(*) filter (where confirmed_at is not null and role = 'seeker') as seekers,
  count(*) filter (where confirmed_at is not null and role = 'helper') as helpers,
  count(*) filter (where confirmed_at is not null and wants_app)      as would_use_app,
  round(
    100.0 * count(*) filter (where confirmed_at is not null and wants_app)
    / nullif(count(*) filter (where confirmed_at is not null), 0),
    1
  )                                                                   as would_use_app_pct,
  count(*) filter (where confirmed_at is null)                        as awaiting_confirmation,
  min(created_at) filter (where confirmed_at is not null)             as first_signup,
  max(created_at) filter (where confirmed_at is not null)             as last_signup
from public.leads;

-- visit_to_signup_pct is only meaningful while visitors arrive via "/"; links
-- pointing straight at /finden or /helfen skip the landing count, so judge
-- those by the *_completion_pct columns instead. Events are low-trust
-- counters; the leads behind demand_overview are the numbers to rely on.
create view public.demand_conversion with (security_invoker = true) as
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

create view public.demand_by_source with (security_invoker = true) as
select coalesce(source, 'direct') as source, count(*) as signups
from public.leads
where confirmed_at is not null
group by 1
order by signups desc;

create view public.demand_by_category with (security_invoker = true) as
select category, role, count(*) as signups
from public.leads, unnest(categories) as category
where confirmed_at is not null
group by category, role
order by signups desc;

create view public.demand_by_region with (security_invoker = true) as
select left(postal_code, 2) as plz_region, role, count(*) as signups
from public.leads
where confirmed_at is not null
group by 1, 2
order by signups desc;

-- Bursts stand out here: genuine interest grows over days, spam arrives in one
-- hour — and mostly never confirms.
create view public.demand_by_hour with (security_invoker = true) as
select
  date_trunc('hour', created_at)               as hour,
  count(*)                                     as attempts,
  count(*) filter (where confirmed_at is not null) as confirmed
from public.leads
where created_at > now() - interval '48 hours'
group by 1
order by 1 desc;

-- Which limits fired in the last two days and how many requests they turned
-- away. Empty is good; a busy row means someone is hammering the site.
create view public.limit_hits with (security_invoker = true) as
select
  m.label                                   as limit_name,
  c.window_start,
  count(*)                                  as connections,
  sum(c.n - cfg.value)                      as rejected
from private.counters c
join (values
  ('lead',             'lead_per_ip_hour',      'sign-ups per connection'),
  ('lead_global_hour', 'lead_global_hour',      'sign-ups in total per hour'),
  ('lead_global_day',  'lead_global_day',       'sign-ups in total per day'),
  ('challenge',        'challenge_per_ip_hour', 'robot checks per connection'),
  ('confirm',          'confirm_per_ip_hour',   'confirmation clicks per connection'),
  ('mail',             'mail_per_address_day',  'mails per address'),
  ('mail_global_day',  'mail_global_day',       'mails in total per day'),
  ('event',            'event_per_ip_minute',   'page counters per connection and minute'),
  ('event_day',        'event_per_ip_day',      'page counters per connection and day'),
  ('event_global_day', 'event_global_day',      'page counters in total per day')
) as m(prefix, config_key, label) on m.prefix = split_part(c.bucket, ':', 1)
join private.config cfg on cfg.key = m.config_key
where c.n > cfg.value
group by 1, 2
order by 2 desc, 4 desc;

revoke all on
  public.demand_overview,
  public.demand_conversion,
  public.demand_by_source,
  public.demand_by_category,
  public.demand_by_region,
  public.demand_by_hour,
  public.limit_hits
from anon, authenticated;

-- Minimal stand-ins for the Supabase platform schemas, so migrations can be tested in
-- PGlite (Postgres in WASM) without Docker. Test-only: never apply to a real project.

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists realtime;

do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

grant usage on schema public, extensions, auth, storage, realtime to anon, authenticated, service_role;

create table auth.users (id uuid primary key, email text, is_anonymous boolean default false);

-- Supabase reads the caller from the JWT; tests set it with set_config('request.jwt.claim.sub', ...).
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

create table realtime.messages (id bigserial primary key, topic text, extension text, event text, payload jsonb, private boolean);
alter table realtime.messages enable row level security;
grant select on realtime.messages to authenticated;

create function realtime.topic() returns text language sql stable as $$
  select current_setting('realtime.topic', true)
$$;

-- Records what would have been broadcast, so tests can check payloads carry no content.
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
language sql as $$
  insert into realtime.messages(topic, extension, event, payload, private) values (topic, 'broadcast', event, payload, private)
$$;

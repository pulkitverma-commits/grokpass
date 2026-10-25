-- OnePass schema: one-time, end-to-end encrypted secrets.
-- The server only ever stores AES-GCM ciphertext. Keys live in the link's #fragment.

create extension if not exists pgcrypto with schema extensions;

-- Secrets waiting to be opened ------------------------------------------------
create table if not exists public.secrets (
  id          text primary key,
  header      text not null,              -- base64url(iv || AES-GCM(header JSON))
  body        text,                       -- base64url(iv || AES-GCM(text)) for text secrets
  file_path   text,                       -- storage path of the encrypted file for file secrets
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
alter table public.secrets enable row level security;
revoke all on public.secrets from anon, authenticated;

-- Files that have been claimed (opened) or expired and may now be downloaded/deleted.
create table if not exists public.secret_claims (
  file_path   text primary key,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
alter table public.secret_claims enable row level security;
revoke all on public.secret_claims from anon, authenticated;

-- Peek (does NOT burn): encrypted header + kind, so the viewer can see what's waiting.
create or replace function public.peek_secret(p_id text)
returns table (header text, kind text, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.header,
         case when s.file_path is null then 'text' else 'file' end,
         s.expires_at
  from secrets s
  where s.id = p_id and s.expires_at > now();
$$;

-- Open (burns): atomically deletes the row and returns the ciphertext.
-- For files, the storage object becomes downloadable/deletable for 10 minutes.
create or replace function public.open_secret(p_id text)
returns table (header text, body text, file_path text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r secrets%rowtype;
begin
  delete from secrets s where s.id = p_id and s.expires_at > now() returning s.* into r;
  if not found then return; end if;
  if r.file_path is not null then
    insert into secret_claims (file_path, expires_at)
    values (r.file_path, now() + interval '10 minutes')
    on conflict (file_path) do update set expires_at = excluded.expires_at;
  end if;
  return query select r.header, r.body, r.file_path;
end $$;

-- Cleanup: remove expired secrets; return file paths that should now be deleted from storage.
create or replace function public.reap_expired_secrets()
returns setof text
language plpgsql security definer set search_path = public as $$
declare p text;
begin
  for p in delete from secrets where expires_at <= now() and file_path is not null returning file_path loop
    insert into secret_claims (file_path, expires_at) values (p, now() + interval '10 minutes')
    on conflict (file_path) do update set expires_at = excluded.expires_at;
    return next p;
  end loop;
  delete from secrets where expires_at <= now();
  -- Opened files the viewer didn't clean up: retry deletion for up to 2 days.
  delete from secret_claims where created_at < now() - interval '2 days';
  for p in update secret_claims set expires_at = now() + interval '10 minutes'
           where expires_at <= now() returning file_path loop
    return next p;
  end loop;
  return;
end $$;

-- Used by storage policies (runs as owner so anon needs no access to secret_claims).
create or replace function public.is_claimed_file(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from secret_claims c where c.file_path = p_name and c.expires_at > now());
$$;

revoke all on function public.peek_secret(text) from public;
revoke all on function public.open_secret(text) from public;
revoke all on function public.reap_expired_secrets() from public;
grant execute on function public.peek_secret(text) to anon, authenticated;
grant execute on function public.open_secret(text) to anon, authenticated;
grant execute on function public.reap_expired_secrets() to anon, authenticated;
revoke all on function public.is_claimed_file(text) from public;
grant execute on function public.is_claimed_file(text) to anon, authenticated;

-- Storage: private bucket for encrypted files (10 MB plaintext + GCM overhead).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('secrets', 'secrets', false, 10486784, array['application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Anyone may upload new encrypted files (they are useless without the key in the link).
drop policy if exists "onepass upload" on storage.objects;
create policy "onepass upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'secrets' and name ~ '^f/[A-Za-z0-9_-]{24,64}\.bin$');

-- A file can only be read or deleted after its secret has been opened (or expired).
drop policy if exists "onepass read claimed" on storage.objects;
create policy "onepass read claimed" on storage.objects for select to anon, authenticated
  using (bucket_id = 'secrets' and public.is_claimed_file(name));

drop policy if exists "onepass delete claimed" on storage.objects;
create policy "onepass delete claimed" on storage.objects for delete to anon, authenticated
  using (bucket_id = 'secrets' and public.is_claimed_file(name));

-- Free quota, referrals and OnePass+ ----------------------------------------------
-- Every browser gets 10 free secrets. Referring a friend raises that to 50. OnePass+ = unlimited.
create table if not exists public.secret_quota (
  client_id   text primary key,
  used        int  not null default 0,
  bonus       int  not null default 0,
  plan        text not null default 'free' check (plan in ('free', 'plus')),
  ref_code    text not null unique,
  referred_by text,
  created_at  timestamptz not null default now()
);
alter table public.secret_quota enable row level security;
revoke all on public.secret_quota from anon, authenticated;

create or replace function public.ensure_quota(p_client_id text, p_ref text)
returns public.secret_quota
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  q secret_quota%rowtype;
  v_code text;
  b bytea;
  i int;
begin
  if p_client_id is null or p_client_id !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'invalid client'; end if;
  select * into q from secret_quota where client_id = p_client_id;
  if found then return q; end if;

  loop
    b := gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1);
    end loop;
    begin
      insert into secret_quota (client_id, ref_code) values (p_client_id, v_code) returning * into q;
      exit;
    exception when unique_violation then
      select * into q from secret_quota where client_id = p_client_id;
      if found then return q; end if;
    end;
  end loop;

  -- A new browser that arrived through a referral link unlocks 50 shares for the referrer.
  if p_ref is not null and p_ref ~ '^[A-Za-z0-9]{8}$' and p_ref <> q.ref_code then
    update secret_quota set bonus = greatest(bonus, 40) where ref_code = p_ref;
    if found then
      update secret_quota set referred_by = p_ref where client_id = p_client_id returning * into q;
    end if;
  end if;
  return q;
end $$;

create or replace function public.get_quota(p_client_id text, p_ref text default null)
returns table (used int, quota int, plan text, ref_code text, referred int)
language plpgsql security definer set search_path = public as $$
declare q secret_quota%rowtype;
begin
  q := ensure_quota(p_client_id, p_ref);
  return query select q.used,
    case when q.plan = 'plus' then null else 10 + q.bonus end,
    q.plan, q.ref_code,
    (select count(*)::int from secret_quota r where r.referred_by = q.ref_code);
end $$;

drop function if exists public.create_secret(text, text, text, int);
create or replace function public.create_secret(
  p_header text, p_body text, p_file_path text, p_ttl_seconds int, p_client_id text, p_ref text default null
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  v_id text;
  b bytea;
  i int;
  q secret_quota%rowtype;
begin
  if p_header is null or length(p_header) > 4000 then raise exception 'invalid header'; end if;
  if (p_body is null) = (p_file_path is null) then raise exception 'provide either a body or a file'; end if;
  if p_body is not null and length(p_body) > 120000 then raise exception 'text too large'; end if;
  if p_file_path is not null and p_file_path !~ '^f/[A-Za-z0-9_-]{24,64}\.bin$' then raise exception 'invalid file path'; end if;
  if p_ttl_seconds not in (3600, 86400, 604800) then raise exception 'invalid expiry'; end if;

  q := ensure_quota(p_client_id, p_ref);
  select * into q from secret_quota where client_id = p_client_id for update;
  if q.plan <> 'plus' and q.used >= 10 + q.bonus then
    raise exception 'quota_exceeded';
  end if;

  loop
    b := gen_random_bytes(10);
    v_id := '';
    for i in 0..9 loop
      v_id := v_id || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1);
    end loop;
    begin
      insert into secrets (id, header, body, file_path, expires_at)
      values (v_id, p_header, p_body, p_file_path, now() + make_interval(secs => p_ttl_seconds));
      exit;
    exception when unique_violation then
    end;
  end loop;
  update secret_quota set used = used + 1 where client_id = p_client_id;
  return v_id;
end $$;

revoke all on function public.ensure_quota(text, text) from public, anon, authenticated;
revoke all on function public.get_quota(text, text) from public;
revoke all on function public.create_secret(text, text, text, int, text, text) from public;
grant execute on function public.get_quota(text, text) to anon, authenticated;
grant execute on function public.create_secret(text, text, text, int, text, text) to anon, authenticated;

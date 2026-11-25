-- FoxStack's verified staff sign-in may create OnePeek links, without becoming
-- a general OnePeek account session. Only ciphertext enters the share tables.
-- The random app-install secret is never issued, so the normal install API
-- cannot be reached with a federated creation credential.
create table public.foxstack_sso_identities (
  subject uuid primary key,
  install_id text not null unique references public.app_installs(id) on delete cascade,
  email text not null check (email ~ '^[^@[:space:]]+@foxnetglobal[.]com$' and length(email) <= 254),
  display_name text not null check (length(display_name) <= 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.foxstack_sso_sessions (
  id text primary key check (id ~ '^[A-Za-z0-9]{22}$'),
  subject uuid not null references public.foxstack_sso_identities(subject) on delete cascade,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  nonce text not null unique check (nonce ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);
create index foxstack_sso_sessions_subject on public.foxstack_sso_sessions(subject);
create index foxstack_sso_sessions_expiry on public.foxstack_sso_sessions(expires_at);
alter table public.foxstack_sso_identities enable row level security;
alter table public.foxstack_sso_sessions enable row level security;
revoke all on public.foxstack_sso_identities, public.foxstack_sso_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.foxstack_sso_identities, public.foxstack_sso_sessions to service_role;
-- The existing random-id helper was previously used only inside definers.
grant execute on function public.onepeek_new_id(int) to service_role;

-- SECURITY INVOKER: only the service role has table/function privileges. No
-- public definer shortcut and no user-editable metadata controls identity.
create function public.foxstack_exchange_session(
  p_subject uuid, p_email text, p_name text, p_secret_hash text,
  p_nonce text, p_assertion_expires_at timestamptz
) returns table (id text, expires_at timestamptz)
language plpgsql security invoker set search_path = public, extensions as $$
declare
  v_install text;
  v_session text;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  if p_subject is null or p_email is null or p_email !~ '^[^@[:space:]]+@foxnetglobal[.]com$'
      or length(p_email) > 254 or p_name is null or length(p_name) > 160
      or p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$'
      or p_nonce is null or p_nonce !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'invalid_assertion';
  end if;
  if p_assertion_expires_at is null or p_assertion_expires_at <= now()
      or p_assertion_expires_at > now() + interval '65 seconds' then
    raise exception 'assertion_expired';
  end if;
  -- Serialize first-time identity creation and exchange for one employee. A
  -- stable install means re-sign-in cannot reset quotas or idempotency keys.
  perform pg_advisory_xact_lock(hashtextextended(p_subject::text, 0));
  -- now() is fixed at transaction start; a lock wait must not extend a ticket.
  if p_assertion_expires_at <= clock_timestamp() then raise exception 'assertion_expired'; end if;
  if exists (select 1 from foxstack_sso_sessions s where s.nonce = p_nonce) then
    raise exception 'assertion_replayed';
  end if;
  select f.install_id into v_install from foxstack_sso_identities f where f.subject = p_subject;
  if v_install is null then
    v_install := app_register_install(encode(gen_random_bytes(32), 'hex'), 'other', 'FoxStack SSO');
    insert into foxstack_sso_identities(subject, install_id, email, display_name)
      values(p_subject, v_install, p_email, p_name);
  else
    if exists (select 1 from app_installs a where a.id = v_install and a.revoked_at is not null) then
      raise exception 'identity_revoked';
    end if;
    update foxstack_sso_identities set email = p_email, display_name = p_name, updated_at = now()
      where subject = p_subject;
  end if;
  -- Nonces outlive assertion validity by a day; replay expiry is checked above.
  delete from foxstack_sso_sessions where foxstack_sso_sessions.expires_at < now() - interval '1 day';
  v_session := onepeek_new_id(22);
  begin
    insert into foxstack_sso_sessions(id, subject, secret_hash, nonce, expires_at)
      values(v_session, p_subject, p_secret_hash, p_nonce, v_expires);
  exception when unique_violation then
    raise exception 'assertion_replayed';
  end;
  return query select v_session, v_expires;
end $$;

create function public.foxstack_auth_session(p_session text, p_secret_hash text)
returns table (install_id text)
language sql stable security invoker set search_path = public as $$
  select f.install_id
  from foxstack_sso_sessions s
  join foxstack_sso_identities f on f.subject = s.subject
  join app_installs a on a.id = f.install_id
  where s.id = p_session and s.secret_hash = p_secret_hash
    and s.expires_at > now() and a.revoked_at is null
$$;

revoke all on function public.foxstack_exchange_session(uuid,text,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.foxstack_auth_session(text,text) from public, anon, authenticated;
grant execute on function public.foxstack_exchange_session(uuid,text,text,text,text,timestamptz) to service_role;
grant execute on function public.foxstack_auth_session(text,text) to service_role;

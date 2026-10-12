-- Cloud sync for "דיווח שיעורים": the same data on the phone and the computer, signed in with an email.
--
-- One row per account holds the whole app state as JSON, with a version number so two devices never
-- silently overwrite each other (a stale write gets the newer data back and merges first).
-- The table itself is closed to the outside world (RLS on, no policies); the only way in is through the
-- functions below, which check the password (bcrypt) or a session token (stored only as a hash),
-- lock an account for 15 minutes after repeated wrong passwords, and cap the size of what is stored.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.sync_accounts (
  email text primary key check (email = lower(email) and position('@' in email) > 1),
  pass_hash text not null,
  data jsonb,
  version bigint not null default 0,
  failed int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_sessions (
  token_hash text primary key,
  email text not null references public.sync_accounts (email) on delete cascade,
  created_at timestamptz not null default now(),
  last_used timestamptz not null default now()
);
create index if not exists sync_sessions_email_idx on public.sync_sessions (email);

alter table public.sync_accounts enable row level security;
alter table public.sync_sessions enable row level security;
revoke all on public.sync_accounts, public.sync_sessions from anon, authenticated;

-- Sign in (or create the account when p_create is true). Returns a session token for later calls.
create or replace function public.sync_login(p_email text, p_password text, p_create boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  acc public.sync_accounts;
  v_token text;
begin
  if v_email is null or position('@' in v_email) < 2 or length(v_email) > 200 then
    return jsonb_build_object('error', 'bad_email');
  end if;
  if p_password is null or length(p_password) < 6 or length(p_password) > 200 then
    return jsonb_build_object('error', 'short_password');
  end if;

  select * into acc from public.sync_accounts where email = v_email for update;

  if not found then
    if not p_create then
      return jsonb_build_object('error', 'not_found');
    end if;
    insert into public.sync_accounts (email, pass_hash)
      values (v_email, extensions.crypt(p_password, extensions.gen_salt('bf', 8)))
      returning * into acc;
  else
    if acc.locked_until is not null and acc.locked_until > now() then
      return jsonb_build_object('error', 'locked', 'until', acc.locked_until);
    end if;
    if acc.pass_hash <> extensions.crypt(p_password, acc.pass_hash) then
      update public.sync_accounts
        set failed = failed + 1,
            locked_until = case when failed + 1 >= 8 then now() + interval '15 minutes' else null end
        where email = v_email;
      return jsonb_build_object('error', 'wrong_password');
    end if;
    update public.sync_accounts set failed = 0, locked_until = null where email = v_email;
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.sync_sessions (token_hash, email)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_email);

  return jsonb_build_object('token', v_token, 'email', v_email, 'version', acc.version, 'data', acc.data,
                            'created', acc.version = 0 and acc.data is null);
end;
$$;

-- The account behind a token, or null.
create or replace function public.sync_session_email(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if p_token is null or length(p_token) <> 64 then
    return null;
  end if;
  update public.sync_sessions
    set last_used = now()
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    returning email into v_email;
  return v_email;
end;
$$;

-- Latest data, unless the device already has this version.
create or replace function public.sync_pull(p_token text, p_known_version bigint default -1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.sync_session_email(p_token);
  acc public.sync_accounts;
begin
  if v_email is null then
    return jsonb_build_object('error', 'signed_out');
  end if;
  select * into acc from public.sync_accounts where email = v_email;
  if acc.version = p_known_version then
    return jsonb_build_object('version', acc.version, 'same', true);
  end if;
  return jsonb_build_object('version', acc.version, 'data', acc.data);
end;
$$;

-- Save, only on top of the version the device last saw. Otherwise hand back the newer data to merge.
create or replace function public.sync_push(p_token text, p_base_version bigint, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.sync_session_email(p_token);
  acc public.sync_accounts;
begin
  if v_email is null then
    return jsonb_build_object('error', 'signed_out');
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 5000000 then
    return jsonb_build_object('error', 'bad_data');
  end if;
  select * into acc from public.sync_accounts where email = v_email for update;
  if acc.version <> p_base_version then
    return jsonb_build_object('conflict', true, 'version', acc.version, 'data', acc.data);
  end if;
  update public.sync_accounts
    set data = p_data, version = version + 1, updated_at = now()
    where email = v_email
    returning version into acc.version;
  return jsonb_build_object('version', acc.version);
end;
$$;

create or replace function public.sync_logout(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.sync_sessions where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

revoke all on function public.sync_login(text, text, boolean), public.sync_session_email(text),
  public.sync_pull(text, bigint), public.sync_push(text, bigint, jsonb), public.sync_logout(text) from public;
grant execute on function public.sync_login(text, text, boolean), public.sync_pull(text, bigint),
  public.sync_push(text, bigint, jsonb), public.sync_logout(text) to anon, authenticated;

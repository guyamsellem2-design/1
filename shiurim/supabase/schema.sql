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

-- Pictures attached to notebook notes, stored per account. Same rules as the data: no direct access,
-- only through functions that check the session token; size limits per picture and per account.
create table if not exists public.sync_files (
  email text not null references public.sync_accounts (email) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{6,64}$'),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  data text not null,
  size int not null,
  created_at timestamptz not null default now(),
  primary key (email, id)
);
alter table public.sync_files enable row level security;
revoke all on public.sync_files from anon, authenticated;

create or replace function public.sync_file_put(p_token text, p_id text, p_mime text, p_data text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := public.sync_session_email(p_token);
  v_used bigint;
begin
  if v_email is null then return jsonb_build_object('error', 'signed_out'); end if;
  if p_data is null or length(p_data) > 3000000 then return jsonb_build_object('error', 'too_big'); end if;
  select coalesce(sum(size), 0) into v_used from public.sync_files where email = v_email;
  if v_used + length(p_data) > 400000000 then return jsonb_build_object('error', 'quota'); end if;
  insert into public.sync_files (email, id, mime, data, size) values (v_email, p_id, p_mime, p_data, length(p_data))
    on conflict (email, id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.sync_file_get(p_token text, p_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := public.sync_session_email(p_token);
  f public.sync_files;
begin
  if v_email is null then return jsonb_build_object('error', 'signed_out'); end if;
  select * into f from public.sync_files where email = v_email and id = p_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  return jsonb_build_object('mime', f.mime, 'data', f.data);
end;
$$;

create or replace function public.sync_file_delete(p_token text, p_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_email text := public.sync_session_email(p_token);
begin
  if v_email is not null then delete from public.sync_files where email = v_email and id = p_id; end if;
end;
$$;

revoke all on function public.sync_file_put(text, text, text, text), public.sync_file_get(text, text), public.sync_file_delete(text, text) from public;
grant execute on function public.sync_file_put(text, text, text, text), public.sync_file_get(text, text), public.sync_file_delete(text, text) to anon, authenticated;

-- (Not applied to the cloud yet: waiting for the owner's approval. Until then files stay on the device.)
-- Files attached to notebook notes (PDF, audio, anything). Sent in parts of up to ~1.5MB each, so a
-- large file never goes in one request, and stored as raw bytes. Together with the pictures, an account
-- holds up to 300MB, well inside the free database (500MB), so the data itself always has room.
create table if not exists public.sync_file_parts (
  email text not null references public.sync_accounts (email) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{6,64}$'),
  part int not null check (part >= 0 and part < 64),
  parts int not null check (parts between 1 and 64),
  mime text not null check (length(mime) <= 120),
  data bytea not null,
  created_at timestamptz not null default now(),
  primary key (email, id, part)
);
alter table public.sync_file_parts enable row level security;
revoke all on public.sync_file_parts from anon, authenticated;

create or replace function public.sync_storage_used(p_email text)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(size) * 3 / 4 from public.sync_files where email = p_email), 0)
       + coalesce((select sum(octet_length(data)) from public.sync_file_parts where email = p_email), 0);
$$;
revoke all on function public.sync_storage_used(text) from public, anon, authenticated;

create or replace function public.sync_part_put(p_token text, p_id text, p_part int, p_parts int, p_mime text, p_data text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := public.sync_session_email(p_token);
  v_bytes bytea;
begin
  if v_email is null then return jsonb_build_object('error', 'signed_out'); end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{6,64}$' or p_part is null or p_parts is null
     or p_part < 0 or p_part >= p_parts or p_parts > 64 or p_mime is null or length(p_mime) > 120 then
    return jsonb_build_object('error', 'bad_data');
  end if;
  if p_data is null or length(p_data) > 2200000 then return jsonb_build_object('error', 'too_big'); end if;
  v_bytes := decode(p_data, 'base64');
  if public.sync_storage_used(v_email) + octet_length(v_bytes) > 300000000 then
    return jsonb_build_object('error', 'quota');
  end if;
  insert into public.sync_file_parts (email, id, part, parts, mime, data)
    values (v_email, p_id, p_part, p_parts, p_mime, v_bytes)
    on conflict (email, id, part) do update set parts = excluded.parts, mime = excluded.mime, data = excluded.data;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.sync_part_get(p_token text, p_id text, p_part int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := public.sync_session_email(p_token);
  f public.sync_file_parts;
begin
  if v_email is null then return jsonb_build_object('error', 'signed_out'); end if;
  select * into f from public.sync_file_parts where email = v_email and id = p_id and part = p_part;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  return jsonb_build_object('mime', f.mime, 'parts', f.parts, 'data', translate(encode(f.data, 'base64'), E'\n', ''));
end;
$$;

create or replace function public.sync_part_delete(p_token text, p_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_email text := public.sync_session_email(p_token);
begin
  if v_email is not null then delete from public.sync_file_parts where email = v_email and id = p_id; end if;
end;
$$;

-- Pictures count toward the same 300MB.
create or replace function public.sync_file_put(p_token text, p_id text, p_mime text, p_data text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := public.sync_session_email(p_token);
begin
  if v_email is null then return jsonb_build_object('error', 'signed_out'); end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{6,64}$' or p_mime not in ('image/jpeg', 'image/png', 'image/webp') then
    return jsonb_build_object('error', 'bad_data');
  end if;
  if p_data is null or length(p_data) > 3000000 then return jsonb_build_object('error', 'too_big'); end if;
  if public.sync_storage_used(v_email) + length(p_data) * 3 / 4 > 300000000 then return jsonb_build_object('error', 'quota'); end if;
  insert into public.sync_files (email, id, mime, data, size) values (v_email, p_id, p_mime, p_data, length(p_data))
    on conflict (email, id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.sync_part_put(text, text, int, int, text, text), public.sync_part_get(text, text, int), public.sync_part_delete(text, text) from public;
grant execute on function public.sync_part_put(text, text, int, int, text, text), public.sync_part_get(text, text, int), public.sync_part_delete(text, text) to anon, authenticated;

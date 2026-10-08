-- Cloud sync for "דיווח שיעורים" (not applied yet: the Supabase project is paused).
-- One row per teacher holding the whole app state. Simple, and each teacher sees only their own row.

create table if not exists public.app_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

create policy "own row: read" on public.app_state
  for select using ((select auth.uid()) = user_id);
create policy "own row: insert" on public.app_state
  for insert with check ((select auth.uid()) = user_id);
create policy "own row: update" on public.app_state
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Photos of notebook pages: a private bucket, one folder per teacher.
insert into storage.buckets (id, name, public) values ('notebook-photos', 'notebook-photos', false)
  on conflict (id) do nothing;

create policy "own photos" on storage.objects for all
  using (bucket_id = 'notebook-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'notebook-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table if not exists public.hamu_state (
  name text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.hamu_state enable row level security;
-- The game backend uses the Supabase service-role key only on the private backend.
-- Do not put that key in Vercel/frontend variables.
create policy "deny public access" on public.hamu_state
  for all using (false) with check (false);

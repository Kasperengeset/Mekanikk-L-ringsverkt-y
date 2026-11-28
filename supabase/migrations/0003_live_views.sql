-- Direktekobling mellom Claude og moment.no/app: siste resultat fra MCP-verktøyene per bruker.
-- Kjøres én gang i Supabase (SQL Editor). Se docs/mcp.md.
--
-- Én rad per bruker, overskrevet for hver nye oppgave. Rader eldre enn ett døgn slettes hver gang noen
-- skriver. Bare serveren (secret key) skriver; brukeren leser sin egen rad og følger den i sanntid.

create table if not exists public.live_views (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.live_views enable row level security;
revoke all on table public.live_views from anon, authenticated;
grant select on table public.live_views to authenticated;
drop policy if exists "les egen visning" on public.live_views;
create policy "les egen visning" on public.live_views for select to authenticated using ((select auth.uid()) = user_id);

-- Sanntid: appen får beskjed når raden endres (Realtime respekterer RLS for innloggede).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_views') then
    alter publication supabase_realtime add table public.live_views;
  end if;
end;
$$;

create or replace function public.put_live_view(p_user uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.live_views as v (user_id, payload, created_at) values (p_user, p_payload, now())
  on conflict (user_id) do update set payload = excluded.payload, created_at = excluded.created_at;
  delete from public.live_views v where v.created_at < now() - interval '1 day';
end;
$$;

revoke all on function public.put_live_view(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.put_live_view(uuid, jsonb) to service_role;

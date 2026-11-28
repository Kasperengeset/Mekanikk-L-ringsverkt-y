-- Ukekvote per bruker: hvor mange tolkninger og spørsmål til veilederen en bruker har brukt denne uken.
-- Kjøres én gang i Supabase (SQL Editor, eller `supabase db push`). Se docs/auth.md.
--
-- Bare serveren (secret key) kan telle opp, gjennom consume_quota. En innlogget bruker kan lese sin egen
-- bruk (RLS), så appen kan vise hvor mye som er igjen.

create table if not exists public.usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  week date not null,
  kind text not null check (kind in ('interpret', 'agent', 'agent_call')),
  used integer not null default 0,
  primary key (user_id, week, kind)
);

alter table public.usage enable row level security;

drop policy if exists "les egen bruk" on public.usage;
create policy "les egen bruk" on public.usage for select to authenticated using ((select auth.uid()) = user_id);

-- Trekker én enhet hvis brukeren er under taket. Atomisk: to samtidige kall kan ikke begge slippe forbi taket.
create or replace function public.consume_quota(p_user uuid, p_kind text, p_limit integer)
returns table (allowed boolean, used integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  w date := date_trunc('week', now() at time zone 'Europe/Oslo')::date;
  n integer;
begin
  insert into public.usage as u (user_id, week, kind, used)
  values (p_user, w, p_kind, 1)
  on conflict (user_id, week, kind) do update set used = u.used + 1 where u.used < p_limit
  returning u.used into n;

  if n is null or n > p_limit then
    select u.used into n from public.usage u where u.user_id = p_user and u.week = w and u.kind = p_kind;
    return query select false, coalesce(n, 0);
  else
    return query select true, n;
  end if;
end;
$$;

revoke all on function public.consume_quota(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consume_quota(uuid, text, integer) to service_role;

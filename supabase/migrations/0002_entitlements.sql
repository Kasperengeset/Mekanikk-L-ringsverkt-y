-- Abonnement og ukekvote for MCP-verktøyene.
-- Kjøres én gang i Supabase (SQL Editor, eller `supabase db push`). Se docs/mcp.md.
--
-- Gratis: et antall oppgaver per uke (mandag–søndag, norsk tid). En oppgave telles én gang, uansett hvor
-- mange ganger Claude kaller verktøyene for den (task_key er en hash av oppgaven, ikke innholdet i klartekst).
-- Aktivt abonnement: ingen grense. Bare serveren (secret key) skriver; brukeren kan lese sine egne rader.

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null check (status in ('active', 'trialing', 'past_due', 'canceled')),
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
revoke all on table public.subscriptions from anon, authenticated;
grant select on table public.subscriptions to authenticated;
drop policy if exists "les eget abonnement" on public.subscriptions;
create policy "les eget abonnement" on public.subscriptions for select to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.task_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  week date not null,
  task_key text not null,
  first_used timestamptz not null default now(),
  calls integer not null default 1,
  primary key (user_id, week, task_key)
);

alter table public.task_usage enable row level security;
revoke all on table public.task_usage from anon, authenticated;
grant select on table public.task_usage to authenticated;
drop policy if exists "les egen oppgavebruk" on public.task_usage;
create policy "les egen oppgavebruk" on public.task_usage for select to authenticated using ((select auth.uid()) = user_id);

-- Registrerer et kall for oppgaven. Ny oppgave denne uken teller mot taket, med mindre brukeren abonnerer.
create or replace function public.consume_task(p_user uuid, p_task text, p_limit integer)
returns table (allowed boolean, subscribed boolean, used integer, task_limit integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  w date := date_trunc('week', now() at time zone 'Europe/Oslo')::date;
  n integer;
  sub boolean;
begin
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  ) into sub;

  -- Én forespørsel om gangen per bruker, så tellingen og innsettingen ikke kan slippe forbi taket samtidig.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));

  -- Oppgaven er allerede telt denne uken: bare registrer kallet.
  update public.task_usage t set calls = t.calls + 1
  where t.user_id = p_user and t.week = w and t.task_key = p_task;
  select count(*)::integer into n from public.task_usage t where t.user_id = p_user and t.week = w;
  if exists (select 1 from public.task_usage t where t.user_id = p_user and t.week = w and t.task_key = p_task) then
    return query select true, sub, n, p_limit;
    return;
  end if;

  if sub or n < p_limit then
    insert into public.task_usage (user_id, week, task_key) values (p_user, w, p_task);
    return query select true, sub, n + 1, p_limit;
  else
    return query select false, sub, n, p_limit;
  end if;
end;
$$;

revoke all on function public.consume_task(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consume_task(uuid, text, integer) to service_role;

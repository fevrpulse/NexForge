-- NexForge security hardening (additive)
-- Run in Supabase SQL editor after combat-stats.sql / duels.sql

-- 1) TOURNAMENTS: public browse without bank/PII
-- Prefer v141-supabase-hardening.sql for the current tournaments lockdown.
-- Public browse uses security_invoker + column grants (no bank PII via SELECT).
revoke all on table public.tournaments from anon, authenticated;

grant select (
  id, host_id, host_tag, name, game, format, max_slots, starts_at, rules,
  prize_type, cash_amount, inapp_reward, status, registrations, created_at,
  bank_account_last4
) on table public.tournaments to anon, authenticated;

grant insert (
  id, host_id, host_tag, name, game, format, max_slots, starts_at, rules,
  prize_type, cash_amount, inapp_reward, status, registrations, created_at,
  bank_holder, bank_name, bank_routing, bank_account, bank_account_last4,
  bank_type, bank_country, payout_email, payout_phone
) on table public.tournaments to authenticated;

grant update (
  host_tag, name, game, format, max_slots, starts_at, rules,
  prize_type, cash_amount, inapp_reward, status, registrations,
  bank_holder, bank_name, bank_routing, bank_account, bank_account_last4,
  bank_type, bank_country, payout_email, payout_phone
) on table public.tournaments to authenticated;

drop policy if exists "Anyone can view tournaments" on public.tournaments;
drop policy if exists "Anyone can browse tournaments" on public.tournaments;
drop policy if exists "Hosts can view own tournaments full" on public.tournaments;
create policy "Anyone can browse tournaments"
  on public.tournaments for select
  to anon, authenticated
  using (true);

drop view if exists public.tournaments_public;
create view public.tournaments_public
with (security_invoker = true)
as
select
  t.id,
  t.host_id,
  t.host_tag,
  t.name,
  t.game,
  t.format,
  t.max_slots,
  t.starts_at,
  t.rules,
  t.prize_type,
  t.cash_amount,
  t.inapp_reward,
  t.status,
  t.registrations,
  t.created_at,
  t.bank_account_last4
from public.tournaments t;

grant select on public.tournaments_public to anon, authenticated;

drop function if exists public.register_for_tournament(uuid);
drop function if exists public.unregister_from_tournament(uuid);

create or replace function public.register_for_tournament(tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tournaments;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into t from public.tournaments where id = tournament_id for update;
  if not found then
    raise exception 'Tournament not found';
  end if;
  if t.status <> 'open' then
    raise exception 'Tournament is not open';
  end if;
  if auth.uid() = any(t.registrations) then
    return jsonb_build_object(
      'id', t.id, 'host_id', t.host_id, 'host_tag', t.host_tag, 'name', t.name,
      'game', t.game, 'format', t.format, 'max_slots', t.max_slots, 'starts_at', t.starts_at,
      'rules', t.rules, 'prize_type', t.prize_type, 'cash_amount', t.cash_amount,
      'inapp_reward', t.inapp_reward, 'status', t.status, 'registrations', t.registrations,
      'created_at', t.created_at, 'bank_account_last4', t.bank_account_last4
    );
  end if;
  if coalesce(array_length(t.registrations, 1), 0) >= t.max_slots then
    raise exception 'Tournament is full';
  end if;

  update public.tournaments
    set registrations = array_append(registrations, auth.uid())
    where id = tournament_id
    returning * into t;

  return jsonb_build_object(
    'id', t.id, 'host_id', t.host_id, 'host_tag', t.host_tag, 'name', t.name,
    'game', t.game, 'format', t.format, 'max_slots', t.max_slots, 'starts_at', t.starts_at,
    'rules', t.rules, 'prize_type', t.prize_type, 'cash_amount', t.cash_amount,
    'inapp_reward', t.inapp_reward, 'status', t.status, 'registrations', t.registrations,
    'created_at', t.created_at, 'bank_account_last4', t.bank_account_last4
  );
end;
$$;

create or replace function public.unregister_from_tournament(tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tournaments;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.tournaments
    set registrations = array_remove(registrations, auth.uid())
    where id = tournament_id
    returning * into t;

  if not found then
    raise exception 'Tournament not found';
  end if;

  return jsonb_build_object(
    'id', t.id, 'host_id', t.host_id, 'host_tag', t.host_tag, 'name', t.name,
    'game', t.game, 'format', t.format, 'max_slots', t.max_slots, 'starts_at', t.starts_at,
    'rules', t.rules, 'prize_type', t.prize_type, 'cash_amount', t.cash_amount,
    'inapp_reward', t.inapp_reward, 'status', t.status, 'registrations', t.registrations,
    'created_at', t.created_at, 'bank_account_last4', t.bank_account_last4
  );
end;
$$;

grant execute on function public.register_for_tournament(uuid) to authenticated;
grant execute on function public.unregister_from_tournament(uuid) to authenticated;

-- 2) DUELS: hosts may only cancel open queues
drop policy if exists "Hosts can cancel own open duels" on public.duels;
create policy "Hosts can cancel own open duels"
  on public.duels for update
  to authenticated
  using (auth.uid() = host_id and status = 'open')
  with check (auth.uid() = host_id and status = 'cancelled');

-- 3) PROFILES: identity fields only
alter table public.profiles add column if not exists main_game_description text;
alter table public.profiles add column if not exists onboarding_done boolean not null default true;

revoke update on table public.profiles from authenticated, anon;
grant update (
  gamer_tag,
  platform,
  main_game,
  main_game_description,
  onboarding_done
) on table public.profiles to authenticated;

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.add_session_combat(
  p_kills integer,
  p_deaths integer,
  p_assists integer
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_kills is null or p_deaths is null or p_assists is null then
    raise exception 'Provide kills, deaths, and assists';
  end if;
  if p_kills < 0 or p_deaths < 0 or p_assists < 0 then
    raise exception 'Combat stats cannot be negative';
  end if;
  if p_kills > 5000 or p_deaths > 5000 or p_assists > 5000 then
    raise exception 'Combat stats out of range';
  end if;

  update public.profiles
    set total_kills = total_kills + p_kills,
        total_deaths = total_deaths + p_deaths,
        total_assists = total_assists + p_assists
    where id = auth.uid()
    returning * into p;

  if not found then
    raise exception 'Profile not found';
  end if;
  return p;
end;
$$;

grant execute on function public.add_session_combat(integer, integer, integer) to authenticated;

-- 4) MATCHES: no free client inserts
drop policy if exists "Users can insert own matches" on public.matches;

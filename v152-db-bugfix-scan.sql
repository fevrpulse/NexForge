-- v152: Fix live DB bugs found by advisor + log scan
-- 1) tournaments: restore SELECT on escrow public columns (security_invoker view was broken)
-- 2) tournaments: keep INSERT revoked; grant host UPDATE on non-sensitive cols only
-- 3) tournaments_public: SELECT-only for clients
-- 4) typing_signals: allow SELECT of own rows so upsert ON CONFLICT works
-- 5) revoke anon EXECUTE on leftover SECURITY DEFINER entrypoints
-- 6) pin search_path on remaining mutable helpers

-- ---------------------------------------------------------------------------
-- 1–3) Tournaments grants + public view
-- ---------------------------------------------------------------------------
revoke all on table public.tournaments from anon, authenticated;

grant select (
  id, host_id, host_tag, name, game, format, max_slots, starts_at, rules,
  prize_type, cash_amount, inapp_reward, status, registrations, created_at,
  bank_account_last4, prize_funded, payout_status, winner_id
) on table public.tournaments to anon, authenticated;

-- Hosts may edit ops fields via RLS; money/PII/stripe fields stay service_role / RPC only
grant update (
  host_tag, name, game, format, max_slots, starts_at, rules,
  status, registrations
) on table public.tournaments to authenticated;

-- Direct inserts must use create_tournament RPC
revoke insert on table public.tournaments from anon, authenticated;

drop view if exists public.tournaments_public;
create view public.tournaments_public
with (security_invoker = true)
as
select
  id,
  host_id,
  host_tag,
  name,
  game,
  format,
  max_slots,
  starts_at,
  rules,
  prize_type,
  cash_amount,
  inapp_reward,
  status,
  registrations,
  created_at,
  bank_account_last4,
  prize_funded,
  payout_status,
  winner_id
from public.tournaments;

revoke all on public.tournaments_public from anon, authenticated;
grant select on public.tournaments_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) typing_signals: upsert needs SELECT on conflict target rows
-- ---------------------------------------------------------------------------
drop policy if exists "Peers can view typing toward them" on public.typing_signals;
drop policy if exists "Users can view own or peer typing" on public.typing_signals;

create policy "Users can view own or peer typing"
  on public.typing_signals for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() = peer_id);

revoke all on table public.typing_signals from anon;
grant select, insert, update, delete on table public.typing_signals to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Anon must not execute companion / trigger helpers
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('register_companion_device', 'trg_pass_on_duel_match')
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
  end loop;
end $$;

-- Keep companion registration for signed-in users if the function exists
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'register_companion_device'
  ) then
    execute 'grant execute on function public.register_companion_device(text, text, text) to authenticated';
  end if;
exception when others then
  -- signature may differ; ignore grant miss
  null;
end $$;

-- ---------------------------------------------------------------------------
-- 6) search_path on remaining mutable helpers
-- ---------------------------------------------------------------------------
alter function public.nexforge_builtin_game_keys() set search_path = public;
alter function public.normalize_game_key(text) set search_path = public;
alter function public._clan_week_start(timestamp with time zone) set search_path = public;
alter function public._stat_provider_games(text) set search_path = public;

-- ---------------------------------------------------------------------------
-- tournament_brackets / checkins: drop dangerous anon table privileges
-- ---------------------------------------------------------------------------
revoke truncate, references, trigger on table public.tournament_brackets from anon, authenticated;
revoke truncate, references, trigger on table public.tournament_checkins from anon, authenticated;
revoke insert, update, delete on table public.tournament_brackets from anon;
revoke insert, update, delete on table public.tournament_checkins from anon;

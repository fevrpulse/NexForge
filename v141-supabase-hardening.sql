-- v141: Supabase security + bug hardening
-- - tournaments_public: security_invoker + column grants (no bank PII via API)
-- - revoke EXECUTE on public._* helpers from anon/authenticated
-- - cosmetic_payments: explicit deny for client roles

-- 1) Tournaments: lock down table privileges, allow public browse of non-PII cols
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

-- 2) Internal helpers must not be callable by clients
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like '\_%' escape '\'
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);
  end loop;
end $$;

-- 3) cosmetic_payments: RLS on with no policies already blocks clients;
--    add explicit deny so advisors / intent are clear. service_role bypasses RLS.
drop policy if exists "No client access to cosmetic_payments" on public.cosmetic_payments;
create policy "No client access to cosmetic_payments"
  on public.cosmetic_payments
  for all
  to anon, authenticated
  using (false)
  with check (false);

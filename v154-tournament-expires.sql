-- v154: Tournament expire date (max 5 days from creation)

alter table public.tournaments
  add column if not exists expires_at timestamptz;

-- Backfill existing rows: 5 days from creation
update public.tournaments
set expires_at = created_at + interval '5 days'
where expires_at is null;

alter table public.tournaments
  alter column expires_at set not null,
  alter column expires_at set default (now() + interval '5 days');

-- Mark overdue non-finished tournaments as expired
update public.tournaments
set status = 'expired'
where expires_at <= now()
  and status not in ('completed', 'expired');

create or replace function public.expire_stale_tournaments()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.tournaments
  set status = 'expired'
  where expires_at <= now()
    and status not in ('completed', 'expired');
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.expire_stale_tournaments() from public, anon, authenticated;
grant execute on function public.expire_stale_tournaments() to authenticated, service_role;

create or replace function public.create_tournament(
  p_name text,
  p_game text,
  p_format text,
  p_max_slots integer,
  p_starts_at timestamptz,
  p_rules text default null,
  p_prize_type text default 'inapp',
  p_cash_amount numeric default null,
  p_inapp_reward text default null,
  p_bank_holder text default null,
  p_bank_name text default null,
  p_bank_routing text default null,
  p_bank_account text default null,
  p_bank_type text default 'checking',
  p_bank_country text default null,
  p_payout_email text default null,
  p_payout_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  tag text;
  routing text;
  account text;
  needs_cash boolean;
  needs_inapp boolean;
  new_status text;
  tid uuid;
  trow public.tournaments;
  exp_at timestamptz;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  p_name := trim(coalesce(p_name, ''));
  p_game := trim(coalesce(p_game, ''));
  p_format := trim(coalesce(p_format, 'Single Elim'));
  p_prize_type := lower(trim(coalesce(p_prize_type, 'inapp')));
  p_rules := nullif(trim(coalesce(p_rules, '')), '');
  p_inapp_reward := nullif(trim(coalesce(p_inapp_reward, '')), '');

  if p_name = '' then raise exception 'Enter a tournament title'; end if;
  if p_game = '' then raise exception 'Pick a game'; end if;
  if p_max_slots is null or p_max_slots < 2 then raise exception 'Max players must be at least 2'; end if;
  if p_starts_at is null then raise exception 'Pick a start date and time'; end if;
  if p_prize_type not in ('cash', 'inapp', 'both') then raise exception 'Invalid prize type'; end if;

  -- Start must be in the future and within 5 days; listing expires at created+5d
  if p_starts_at < now() then
    raise exception 'Start time must be in the future';
  end if;
  if p_starts_at > now() + interval '5 days' then
    raise exception 'Start time must be within 5 days';
  end if;
  exp_at := now() + interval '5 days';

  needs_cash := p_prize_type in ('cash', 'both');
  needs_inapp := p_prize_type in ('inapp', 'both');

  if needs_inapp and p_inapp_reward is null then
    raise exception 'Describe the in-app reward';
  end if;

  if needs_cash then
    if p_cash_amount is null or p_cash_amount < 1 then
      raise exception 'Cash prize must be at least $1';
    end if;
    if trim(coalesce(p_bank_holder, '')) = ''
       or trim(coalesce(p_bank_name, '')) = ''
       or trim(coalesce(p_bank_country, '')) = ''
       or trim(coalesce(p_payout_email, '')) = ''
       or trim(coalesce(p_payout_phone, '')) = '' then
      raise exception 'Cash prizes require complete organizer bank and contact information';
    end if;
    routing := regexp_replace(coalesce(p_bank_routing, ''), '\D', '', 'g');
    account := regexp_replace(coalesce(p_bank_account, ''), '\D', '', 'g');
    if not public._aba_routing_valid(routing) then
      raise exception 'Routing number must be a valid 9-digit ABA number';
    end if;
    if length(account) < 4 or length(account) > 17 then
      raise exception 'Enter a valid bank account number';
    end if;
    if coalesce(p_payout_email, '') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Enter a valid payout contact email';
    end if;
    new_status := 'pending_funds';
  else
    routing := null;
    account := null;
    p_cash_amount := null;
    p_bank_holder := null;
    p_bank_name := null;
    p_bank_type := null;
    p_bank_country := null;
    p_payout_email := null;
    p_payout_phone := null;
    new_status := 'open';
  end if;

  select coalesce(nullif(gamer_tag, ''), split_part(coalesce(
    (select email from auth.users where id = uid), 'Host'
  ), '@', 1))
  into tag
  from public.profiles where id = uid;
  if tag is null then tag := 'Host'; end if;

  tid := gen_random_uuid();
  insert into public.tournaments (
    id, host_id, host_tag, name, game, format, max_slots, starts_at, rules,
    prize_type, cash_amount, inapp_reward, status, registrations, created_at,
    bank_holder, bank_name, bank_routing, bank_account, bank_account_last4,
    bank_type, bank_country, payout_email, payout_phone,
    prize_funded, payout_status, expires_at
  ) values (
    tid, uid, tag, p_name, p_game, p_format, p_max_slots, p_starts_at, p_rules,
    p_prize_type,
    case when needs_cash then p_cash_amount else null end,
    case when needs_inapp then p_inapp_reward else null end,
    new_status, '{}'::uuid[], now(),
    case when needs_cash then trim(p_bank_holder) else null end,
    case when needs_cash then trim(p_bank_name) else null end,
    routing, account,
    case when needs_cash then right(account, 4) else null end,
    case when needs_cash then coalesce(nullif(trim(p_bank_type), ''), 'checking') else null end,
    case when needs_cash then trim(p_bank_country) else null end,
    case when needs_cash then trim(p_payout_email) else null end,
    case when needs_cash then trim(p_payout_phone) else null end,
    false,
    case when needs_cash then 'awaiting_funds' else 'none' end,
    exp_at
  )
  returning * into trow;

  return jsonb_build_object(
    'id', trow.id,
    'host_id', trow.host_id,
    'host_tag', trow.host_tag,
    'name', trow.name,
    'game', trow.game,
    'format', trow.format,
    'max_slots', trow.max_slots,
    'starts_at', trow.starts_at,
    'expires_at', trow.expires_at,
    'rules', trow.rules,
    'prize_type', trow.prize_type,
    'cash_amount', trow.cash_amount,
    'inapp_reward', trow.inapp_reward,
    'status', trow.status,
    'registrations', trow.registrations,
    'created_at', trow.created_at,
    'bank_account_last4', trow.bank_account_last4,
    'prize_funded', trow.prize_funded,
    'payout_status', trow.payout_status,
    'needs_escrow', needs_cash
  );
end;
$$;

revoke all on function public.create_tournament(
  text, text, text, integer, timestamptz, text, text, numeric, text,
  text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.create_tournament(
  text, text, text, integer, timestamptz, text, text, numeric, text,
  text, text, text, text, text, text, text, text
) to authenticated;

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

  perform public.expire_stale_tournaments();

  select * into t from public.tournaments where id = tournament_id for update;
  if not found then
    raise exception 'Tournament not found';
  end if;
  if t.expires_at <= now() or t.status = 'expired' then
    update public.tournaments set status = 'expired' where id = tournament_id and status <> 'completed';
    raise exception 'This tournament has expired';
  end if;
  if t.status <> 'open' then
    raise exception 'Tournament is not open';
  end if;
  if t.prize_type in ('cash', 'both') and coalesce(t.prize_funded, false) is not true then
    raise exception 'Host has not funded the cash prize yet';
  end if;
  if auth.uid() = any(t.registrations) then
    return jsonb_build_object(
      'id', t.id, 'host_id', t.host_id, 'host_tag', t.host_tag, 'name', t.name,
      'game', t.game, 'format', t.format, 'max_slots', t.max_slots, 'starts_at', t.starts_at,
      'expires_at', t.expires_at,
      'rules', t.rules, 'prize_type', t.prize_type, 'cash_amount', t.cash_amount,
      'inapp_reward', t.inapp_reward, 'status', t.status, 'registrations', t.registrations,
      'created_at', t.created_at, 'bank_account_last4', t.bank_account_last4,
      'prize_funded', t.prize_funded, 'payout_status', t.payout_status, 'winner_id', t.winner_id
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
    'expires_at', t.expires_at,
    'rules', t.rules, 'prize_type', t.prize_type, 'cash_amount', t.cash_amount,
    'inapp_reward', t.inapp_reward, 'status', t.status, 'registrations', t.registrations,
    'created_at', t.created_at, 'bank_account_last4', t.bank_account_last4,
    'prize_funded', t.prize_funded, 'payout_status', t.payout_status, 'winner_id', t.winner_id
  );
end;
$$;

revoke all on function public.register_for_tournament(uuid) from public, anon;
grant execute on function public.register_for_tournament(uuid) to authenticated;

-- Public browse view includes expires_at; keep bank PII off the view
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
  expires_at,
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

grant select (
  id, host_id, host_tag, name, game, format, max_slots, starts_at, expires_at, rules,
  prize_type, cash_amount, inapp_reward, status, registrations, created_at,
  bank_account_last4, prize_funded, payout_status, winner_id
) on table public.tournaments to anon, authenticated;

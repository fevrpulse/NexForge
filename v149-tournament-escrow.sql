-- v149: Cash tournament bank enforcement + escrow/payout columns
-- Phases 3a–3c foundation

-- Escrow / payout columns
alter table public.tournaments
  add column if not exists prize_funded boolean not null default false,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists prize_payment_intent_id text,
  add column if not exists payout_status text not null default 'none',
  add column if not exists winner_id uuid references auth.users(id),
  add column if not exists stripe_transfer_id text;

alter table public.profiles
  add column if not exists stripe_connect_account_id text,
  add column if not exists stripe_connect_onboarded boolean not null default false;

create table if not exists public.tournament_payouts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  winner_id uuid not null references auth.users(id),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  stripe_transfer_id text unique,
  stripe_checkout_session_id text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (tournament_id)
);

alter table public.tournament_payouts enable row level security;

drop policy if exists "tournament_payouts_deny_all" on public.tournament_payouts;
create policy "tournament_payouts_deny_all"
  on public.tournament_payouts for all to anon, authenticated
  using (false) with check (false);

revoke all on public.tournament_payouts from anon, authenticated;
grant select on public.tournament_payouts to service_role;

-- ABA routing checksum
create or replace function public._aba_routing_valid(p_routing text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  r text := regexp_replace(coalesce(p_routing, ''), '\D', '', 'g');
  d int[] := array[0,0,0,0,0,0,0,0,0];
  i int;
  s int;
begin
  if length(r) <> 9 then return false; end if;
  for i in 1..9 loop
    d[i] := substring(r from i for 1)::int;
  end loop;
  s := 3 * (d[1] + d[4] + d[7]) + 7 * (d[2] + d[5] + d[8]) + (d[3] + d[6] + d[9]);
  return (s % 10) = 0;
end;
$$;

revoke all on function public._aba_routing_valid(text) from public, anon, authenticated;
grant execute on function public._aba_routing_valid(text) to authenticated, service_role;

-- Freeze bank + cash fields after create / funding
create or replace function public._tournaments_freeze_money_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.prize_type in ('cash', 'both') then
      if new.bank_holder is distinct from old.bank_holder
         or new.bank_name is distinct from old.bank_name
         or new.bank_routing is distinct from old.bank_routing
         or new.bank_account is distinct from old.bank_account
         or new.bank_account_last4 is distinct from old.bank_account_last4
         or new.bank_type is distinct from old.bank_type
         or new.bank_country is distinct from old.bank_country
         or new.payout_email is distinct from old.payout_email
         or new.payout_phone is distinct from old.payout_phone
         or new.cash_amount is distinct from old.cash_amount
         or new.prize_type is distinct from old.prize_type then
        -- Allow service role (edge functions) to set funding fields only
        if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
           and session_user not in ('postgres', 'supabase_admin') then
          -- Hosts/authenticated cannot mutate bank/prize after insert
          if auth.uid() is not null then
            raise exception 'Bank and prize details are locked after tournament creation';
          end if;
        end if;
      end if;
    end if;

    -- Never allow un-funding via client
    if old.prize_funded = true and new.prize_funded = false and auth.uid() is not null then
      raise exception 'Cannot unfund a tournament prize';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tournaments_freeze_money_fields on public.tournaments;
create trigger tournaments_freeze_money_fields
  before update on public.tournaments
  for each row execute function public._tournaments_freeze_money_fields();

-- Create tournament RPC (enforces bank for cash)
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
  row public.tournaments;
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
    prize_funded, payout_status
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
    case when needs_cash then 'awaiting_funds' else 'none' end
  )
  returning * into row;

  return jsonb_build_object(
    'id', row.id,
    'host_id', row.host_id,
    'host_tag', row.host_tag,
    'name', row.name,
    'game', row.game,
    'format', row.format,
    'max_slots', row.max_slots,
    'starts_at', row.starts_at,
    'rules', row.rules,
    'prize_type', row.prize_type,
    'cash_amount', row.cash_amount,
    'inapp_reward', row.inapp_reward,
    'status', row.status,
    'registrations', row.registrations,
    'created_at', row.created_at,
    'bank_account_last4', row.bank_account_last4,
    'prize_funded', row.prize_funded,
    'payout_status', row.payout_status,
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

-- Mark funded (service / edge only via service role key)
create or replace function public.mark_tournament_prize_funded(
  p_tournament_id uuid,
  p_session_id text,
  p_payment_intent_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.tournaments;
begin
  update public.tournaments
  set prize_funded = true,
      status = case when status = 'pending_funds' then 'open' else status end,
      stripe_checkout_session_id = p_session_id,
      prize_payment_intent_id = coalesce(p_payment_intent_id, prize_payment_intent_id),
      payout_status = 'escrowed'
  where id = p_tournament_id
  returning * into row;
  if not found then raise exception 'Tournament not found'; end if;
  return jsonb_build_object('ok', true, 'id', row.id, 'status', row.status, 'prize_funded', row.prize_funded);
end;
$$;

revoke all on function public.mark_tournament_prize_funded(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_tournament_prize_funded(uuid, text, text) to service_role;

-- Block joining unfunded cash tournaments (keep jsonb return shape)
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
  if t.prize_type in ('cash', 'both') and coalesce(t.prize_funded, false) is not true then
    raise exception 'Host has not funded the cash prize yet';
  end if;
  if auth.uid() = any(t.registrations) then
    return jsonb_build_object(
      'id', t.id, 'host_id', t.host_id, 'host_tag', t.host_tag, 'name', t.name,
      'game', t.game, 'format', t.format, 'max_slots', t.max_slots, 'starts_at', t.starts_at,
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
    'rules', t.rules, 'prize_type', t.prize_type, 'cash_amount', t.cash_amount,
    'inapp_reward', t.inapp_reward, 'status', t.status, 'registrations', t.registrations,
    'created_at', t.created_at, 'bank_account_last4', t.bank_account_last4,
    'prize_funded', t.prize_funded, 'payout_status', t.payout_status, 'winner_id', t.winner_id
  );
end;
$$;

revoke all on function public.register_for_tournament(uuid) from public, anon;
grant execute on function public.register_for_tournament(uuid) to authenticated;

-- Block direct client inserts (must use create_tournament)
revoke insert on public.tournaments from authenticated, anon;

-- Refresh public view columns if view exists
do $$
begin
  if exists (
    select 1 from information_schema.views
    where table_schema = 'public' and table_name = 'tournaments_public'
  ) then
    execute $v$
      create or replace view public.tournaments_public
      with (security_invoker = true)
      as
      select
        id, host_id, host_tag, name, game, format, max_slots, starts_at, rules,
        prize_type, cash_amount, inapp_reward, status, registrations, created_at,
        bank_account_last4, prize_funded, payout_status, winner_id
      from public.tournaments
    $v$;
    grant select on public.tournaments_public to authenticated, anon;
  end if;
end $$;

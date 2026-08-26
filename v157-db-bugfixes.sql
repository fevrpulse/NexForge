-- v157: Database bugfixes found in schema + RPC audit.
-- Safe to re-run. Apply in the Supabase SQL editor (service role).

-- ---------------------------------------------------------------------------
-- 1) Tournament status: cash create + expiry + live brackets
-- ---------------------------------------------------------------------------
alter table public.tournaments drop constraint if exists tournaments_status_check;
alter table public.tournaments
  add constraint tournaments_status_check
  check (status in ('open', 'registered', 'pending_funds', 'live', 'completed', 'expired'));

-- Hosts must not PATCH status/registrations (skip escrow, fake rosters).
revoke update on table public.tournaments from anon, authenticated;
grant update (
  host_tag, name, game, format, max_slots, starts_at, rules
) on table public.tournaments to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Stripe Connect IDs off the public profiles row
-- ---------------------------------------------------------------------------
create table if not exists public.payout_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_connect_account_id text,
  stripe_connect_onboarded boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.payout_accounts enable row level security;
drop policy if exists "payout_accounts_deny_all" on public.payout_accounts;
create policy "payout_accounts_deny_all"
  on public.payout_accounts for all to anon, authenticated
  using (false) with check (false);

revoke all on table public.payout_accounts from anon, authenticated;
grant all on table public.payout_accounts to service_role;

insert into public.payout_accounts (user_id, stripe_connect_account_id, stripe_connect_onboarded)
select id, stripe_connect_account_id, coalesce(stripe_connect_onboarded, false)
from public.profiles
where stripe_connect_account_id is not null
   or coalesce(stripe_connect_onboarded, false)
on conflict (user_id) do update
  set stripe_connect_account_id = coalesce(
        excluded.stripe_connect_account_id,
        public.payout_accounts.stripe_connect_account_id
      ),
      stripe_connect_onboarded = public.payout_accounts.stripe_connect_onboarded
        or excluded.stripe_connect_onboarded,
      updated_at = now();

update public.profiles
set stripe_connect_account_id = null,
    stripe_connect_onboarded = false
where stripe_connect_account_id is not null
   or coalesce(stripe_connect_onboarded, false);

-- ---------------------------------------------------------------------------
-- 3) Username uniqueness on signup + lock gamer_tag to RPC
-- ---------------------------------------------------------------------------
revoke update on table public.profiles from anon, authenticated;
grant update (
  platform,
  main_game,
  main_game_description,
  onboarding_done,
  custom_status,
  hide_match_history,
  avatar_preset,
  last_seen_at,
  playing_game,
  avatar_path,
  equipped_frame,
  equipped_banner,
  equipped_nameplate
) on table public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  tag text;
  n integer := 0;
  suffix text;
begin
  base := regexp_replace(
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'gamer_tag'), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    '[^a-zA-Z0-9_]',
    '',
    'g'
  );
  base := left(base, 20);
  if char_length(base) < 3 then
    base := 'Player';
  end if;
  tag := base;
  suffix := substr(replace(new.id::text, '-', ''), 1, 4);
  while exists (select 1 from public.profiles where lower(gamer_tag) = lower(tag)) loop
    n := n + 1;
    if n = 1 then
      tag := left(base, 15) || '_' || suffix;
    else
      tag := left(base, 12) || '_' || substr(md5(new.id::text || n::text), 1, 6);
    end if;
    if n > 25 then
      tag := 'p' || left(replace(new.id::text, '-', ''), 19);
      exit;
    end if;
  end loop;

  insert into public.profiles (id, gamer_tag, platform, main_game, onboarding_done)
  values (
    new.id,
    tag,
    coalesce(nullif(trim(new.raw_user_meta_data->>'platform'), ''), 'PC'),
    'Valorant',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Recipients can only mark DMs read
-- ---------------------------------------------------------------------------
revoke update on table public.messages from anon, authenticated;
grant update (read_at) on table public.messages to authenticated;

create or replace function public._messages_protect_content()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sender_id is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.body is distinct from old.body
     or new.image_path is distinct from old.image_path
     or new.reply_to_id is distinct from old.reply_to_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Messages cannot be edited';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_messages_protect_content on public.messages;
create trigger trg_messages_protect_content
  before update on public.messages
  for each row execute function public._messages_protect_content();

create or replace function public.unread_dm_counts()
returns table (sender_id uuid, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select m.sender_id, count(*)::bigint
  from public.messages m
  where m.recipient_id = auth.uid()
    and m.read_at is null
  group by m.sender_id;
$$;

revoke all on function public.unread_dm_counts() from public, anon;
grant execute on function public.unread_dm_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Friend activity respects hide_match_history
-- ---------------------------------------------------------------------------
create or replace function public.friend_activity_feed(p_limit integer default 12)
returns table (
  match_id bigint,
  friend_id uuid,
  gamer_tag text,
  game text,
  mode text,
  result text,
  mmr_change integer,
  played_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id as match_id,
    m.user_id as friend_id,
    p.gamer_tag,
    m.game,
    m.mode,
    m.result,
    m.mmr_change,
    m.played_at
  from public.matches m
  join public.profiles p on p.id = m.user_id
  where coalesce(p.hide_match_history, false) = false
    and m.user_id in (
      select case
        when f.requester_id = auth.uid() then f.addressee_id
        else f.requester_id
      end
      from public.friendships f
      where f.status = 'accepted'
        and auth.uid() in (f.requester_id, f.addressee_id)
    )
  order by m.played_at desc
  limit greatest(1, least(coalesce(p_limit, 12), 30));
$$;

revoke all on function public.friend_activity_feed(integer) from public, anon;
grant execute on function public.friend_activity_feed(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Self-report wins must not mint Forge Coins
-- ---------------------------------------------------------------------------
create or replace function public.award_forge_coins_on_match_win()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.result = 'win' and coalesce(new.source, '') = 'duel' then
    update public.profiles
      set forge_coins = least(1000000, coalesce(forge_coins, 0) + 25)
      where id = new.user_id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Clan join bonus once per player
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists clan_join_bonus_claimed boolean not null default false;

create or replace function public._grant_first_clan_bonus(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set forge_coins = least(1000000, coalesce(forge_coins, 0) + 75),
        clan_join_bonus_claimed = true
  where id = p_uid
    and coalesce(clan_join_bonus_claimed, false) = false;
end;
$$;

revoke all on function public._grant_first_clan_bonus(uuid) from public, anon, authenticated;

create or replace function public.create_clan(
  p_name text,
  p_tag text,
  p_min_mmr integer default 0,
  p_is_open boolean default true
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n text; t text; cid uuid;
  min_req integer := greatest(0, least(5000, coalesce(p_min_mmr, 0)));
  my_mmr integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  n := nullif(trim(coalesce(p_name, '')), '');
  t := upper(nullif(trim(coalesce(p_tag, '')), ''));
  if n is null or t is null then raise exception 'Name and tag required'; end if;
  if char_length(n) < 3 or char_length(n) > 32 then raise exception 'Name must be 3–32 characters'; end if;
  if t !~ '^[A-Z0-9]{2,5}$' then raise exception 'Tag must be 2–5 letters or numbers'; end if;
  if exists (select 1 from public.clan_members where user_id = uid and status = 'joined') then
    raise exception 'Leave your current clan first';
  end if;
  if exists (select 1 from public.clans where tag = t) then
    raise exception 'That clan tag is taken';
  end if;

  select coalesce(mmr, 1200) into my_mmr from public.profiles where id = uid;
  if my_mmr < min_req then
    raise exception 'Your MMR (%) is below this clan requirement (%)', my_mmr, min_req;
  end if;

  delete from public.clan_members where user_id = uid and status = 'invited';

  insert into public.clans (name, tag, owner_id, min_mmr, is_open)
  values (n, t, uid, min_req, coalesce(p_is_open, true))
  returning id into cid;
  insert into public.clan_members (clan_id, user_id, role, status, joined_at)
  values (cid, uid, 'owner', 'joined', now());

  perform public._grant_first_clan_bonus(uid);
  return public.get_my_clan();
end;
$$;

create or replace function public.join_clan(p_clan_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c public.clans;
  my_mmr integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_clan_id is null then raise exception 'Clan required'; end if;

  select * into c from public.clans where id = p_clan_id;
  if not found then raise exception 'Clan not found'; end if;
  if not c.is_open then raise exception 'This clan is invite-only'; end if;

  if exists (select 1 from public.clan_members where user_id = uid and status = 'joined') then
    raise exception 'Leave your current clan first';
  end if;

  select coalesce(mmr, 1200) into my_mmr from public.profiles where id = uid;
  if my_mmr < c.min_mmr then
    raise exception 'Need % MMR to join (you have %)', c.min_mmr, my_mmr;
  end if;

  delete from public.clan_members where user_id = uid and status = 'invited';

  insert into public.clan_members (clan_id, user_id, role, status, joined_at)
  values (p_clan_id, uid, 'member', 'joined', now())
  on conflict (clan_id, user_id) do update
    set status = 'joined', role = 'member', joined_at = now();

  perform public._grant_first_clan_bonus(uid);
  return public.get_my_clan();
end;
$$;

create or replace function public.respond_clan_invite(p_clan_id uuid, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c public.clans;
  my_mmr integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.clan_members
    where clan_id = p_clan_id and user_id = uid and status = 'invited'
  ) then raise exception 'No pending clan invite'; end if;

  if not coalesce(p_accept, false) then
    update public.clan_members set status = 'declined' where clan_id = p_clan_id and user_id = uid;
    return jsonb_build_object('ok', true, 'accepted', false);
  end if;

  if exists (select 1 from public.clan_members where user_id = uid and status = 'joined') then
    raise exception 'Leave your current clan first';
  end if;

  select * into c from public.clans where id = p_clan_id;
  if not found then raise exception 'Clan not found'; end if;
  select coalesce(mmr, 1200) into my_mmr from public.profiles where id = uid;
  if my_mmr < c.min_mmr then
    raise exception 'Need % MMR to join (you have %)', c.min_mmr, my_mmr;
  end if;

  update public.clan_members
    set status = 'joined', joined_at = now(), role = 'member'
    where clan_id = p_clan_id and user_id = uid;

  perform public._grant_first_clan_bonus(uid);
  return public.get_my_clan();
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Voice: cannot ring a blocked player
-- ---------------------------------------------------------------------------
drop policy if exists "voice_call_signals_insert_own" on public.voice_call_signals;
create policy "voice_call_signals_insert_own"
  on public.voice_call_signals for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and not public._party_is_blocked(sender_id, recipient_id)
  );

grant execute on function public._party_is_blocked(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9) Ghost match lobbies after 5 minutes
-- ---------------------------------------------------------------------------
create or replace function public._expire_stale_match_lobbies()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.match_lobby_members m
    set status = 'timeout', ready = false, updated_at = now()
  from public.match_lobbies l
  where m.lobby_id = l.id
    and m.status in ('queued', 'active')
    and l.status in ('open', 'forming')
    and l.expires_at is not null
    and l.expires_at < now();

  update public.match_lobbies
    set status = 'cancelled', updated_at = now()
  where status in ('open', 'forming')
    and expires_at is not null
    and expires_at < now();
end;
$$;

revoke all on function public._expire_stale_match_lobbies() from public, anon, authenticated;

drop function if exists public.get_my_lobby();
create function public.get_my_lobby()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  lid uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public._expire_stale_match_lobbies();
  select lobby_id into lid
  from public.match_lobby_members
  where user_id = uid and status in ('queued', 'active')
  limit 1;
  if lid is null then return null; end if;
  return public._lobby_snapshot(lid);
end;
$$;

grant execute on function public.get_my_lobby() to authenticated;

drop trigger if exists trg_expire_lobbies_before_member on public.match_lobby_members;
create or replace function public._trg_expire_lobbies_before_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._expire_stale_match_lobbies();
  return new;
end;
$$;

create trigger trg_expire_lobbies_before_member
  before insert on public.match_lobby_members
  for each row execute function public._trg_expire_lobbies_before_member();

-- ---------------------------------------------------------------------------
-- 10) My duel (not inferred from a global top-40 list)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_duel()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  open_row jsonb;
  active_row jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public._expire_stale_duel_queues();

  select to_jsonb(d) into open_row
  from public.duels d
  where d.status = 'open' and d.host_id = uid
  order by d.created_at desc
  limit 1;

  select to_jsonb(d) into active_row
  from public.duels d
  where d.status = 'active'
    and (d.host_id = uid or d.challenger_id = uid)
  order by d.created_at desc
  limit 1;

  return jsonb_build_object('open', open_row, 'active', active_row);
end;
$$;

revoke all on function public.get_my_duel() from public, anon;
grant execute on function public.get_my_duel() to authenticated;

create or replace function public.accept_duel(p_duel_id uuid)
returns public.duels
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.duels;
  my_tag text;
  my_mmr integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select gamer_tag, mmr into my_tag, my_mmr
  from public.profiles where id = auth.uid();

  if my_tag is null then
    raise exception 'Profile required';
  end if;

  select * into d from public.duels where id = p_duel_id for update;
  if not found then
    raise exception 'Queue not found';
  end if;
  if d.status <> 'open' then
    raise exception 'Queue is no longer open';
  end if;
  if d.host_id = auth.uid() then
    raise exception 'Cannot accept your own queue';
  end if;
  if public._party_is_blocked(auth.uid(), d.host_id) then
    raise exception 'You cannot duel this player';
  end if;

  update public.duels
    set challenger_id = auth.uid(),
        challenger_tag = my_tag,
        challenger_mmr = coalesce(my_mmr, 1200),
        status = 'active',
        updated_at = now()
    where id = p_duel_id
    returning * into d;

  return d;
end;
$$;

revoke all on function public.accept_duel(uuid) from public, anon;
grant execute on function public.accept_duel(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11) Tournament expiry / register / unregister / brackets
-- ---------------------------------------------------------------------------
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
    and status in ('open', 'pending_funds', 'registered')
    and not exists (
      select 1 from public.tournament_brackets b where b.tournament_id = tournaments.id
    )
    and not (
      coalesce(prize_funded, false)
      and prize_type in ('cash', 'both')
    );
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.expire_stale_tournaments() from public, anon;
grant execute on function public.expire_stale_tournaments() to authenticated, service_role;

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
  if exists (select 1 from public.tournament_brackets where tournament_brackets.tournament_id = tournament_id) then
    raise exception 'Bracket already generated';
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

  select * into t from public.tournaments where id = tournament_id for update;
  if not found then
    raise exception 'Tournament not found';
  end if;
  if t.status <> 'open' then
    raise exception 'Cannot leave this tournament now';
  end if;
  if exists (select 1 from public.tournament_brackets where tournament_brackets.tournament_id = tournament_id) then
    raise exception 'Bracket already generated';
  end if;

  update public.tournaments
    set registrations = array_remove(registrations, auth.uid())
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

revoke all on function public.unregister_from_tournament(uuid) from public, anon;
grant execute on function public.unregister_from_tournament(uuid) to authenticated;

create or replace function public._bracket_place_winner(
  p_tid uuid,
  p_round integer,
  p_match_index integer,
  p_winner uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_round integer := p_round + 1;
  next_index integer := p_match_index / 2;
  next_slot text := case when p_match_index % 2 = 0 then 'a' else 'b' end;
  max_round integer;
begin
  select max(round) into max_round
  from public.tournament_brackets
  where tournament_id = p_tid;
  if max_round is null or next_round > max_round then
    return;
  end if;

  update public.tournament_brackets
    set slot_a = case when next_slot = 'a' then p_winner else slot_a end,
        slot_b = case when next_slot = 'b' then p_winner else slot_b end,
        status = case
          when (
            case when next_slot = 'a' then p_winner else slot_a end
          ) is not null
          and (
            case when next_slot = 'b' then p_winner else slot_b end
          ) is not null
          then 'ready'
          else 'pending'
        end
  where tournament_id = p_tid
    and round = next_round
    and match_index = next_index;
end;
$$;

revoke all on function public._bracket_place_winner(uuid, integer, integer, uuid) from public, anon, authenticated;

create or replace function public.host_generate_bracket(p_tournament_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t public.tournaments;
  players uuid[];
  n integer;
  size integer;
  byes integer;
  i integer;
  a uuid;
  b uuid;
  pidx integer;
  rnd integer;
  slots integer;
  m record;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'Tournament not found'; end if;
  if t.host_id is distinct from uid then raise exception 'Only the host can generate a bracket'; end if;
  if t.status not in ('open', 'registered') then
    raise exception 'Tournament is not open';
  end if;
  if t.prize_type in ('cash', 'both') and coalesce(t.prize_funded, false) is not true then
    raise exception 'Fund the cash prize before generating a bracket';
  end if;
  if exists (select 1 from public.tournament_brackets where tournament_id = p_tournament_id) then
    raise exception 'Bracket already generated';
  end if;

  select coalesce(array_agg(c.user_id order by c.checked_in_at), '{}'::uuid[])
    into players
  from public.tournament_checkins c
  where c.tournament_id = p_tournament_id;

  if coalesce(array_length(players, 1), 0) < 2 then
    players := coalesce(t.registrations, '{}'::uuid[]);
  end if;

  n := coalesce(array_length(players, 1), 0);
  if n < 2 then raise exception 'Need at least 2 players to generate a bracket'; end if;

  size := 2;
  while size < n loop size := size * 2; end loop;
  byes := size - n;
  pidx := 1;
  i := 0;
  while i < size / 2 loop
    if byes > 0 then
      a := players[pidx];
      pidx := pidx + 1;
      b := null;
      byes := byes - 1;
      insert into public.tournament_brackets (tournament_id, round, match_index, slot_a, slot_b, winner_id, status)
      values (p_tournament_id, 1, i, a, null, a, 'done');
    else
      a := players[pidx];
      pidx := pidx + 1;
      b := players[pidx];
      pidx := pidx + 1;
      insert into public.tournament_brackets (tournament_id, round, match_index, slot_a, slot_b, status)
      values (p_tournament_id, 1, i, a, b, 'ready');
    end if;
    i := i + 1;
  end loop;

  rnd := 2;
  slots := size / 4;
  while slots >= 1 loop
    i := 0;
    while i < slots loop
      insert into public.tournament_brackets (tournament_id, round, match_index, slot_a, slot_b, status)
      values (p_tournament_id, rnd, i, null, null, 'pending');
      i := i + 1;
    end loop;
    rnd := rnd + 1;
    slots := slots / 2;
  end loop;

  for m in
    select round, match_index, winner_id
    from public.tournament_brackets
    where tournament_id = p_tournament_id
      and round = 1
      and status = 'done'
      and winner_id is not null
  loop
    perform public._bracket_place_winner(p_tournament_id, m.round, m.match_index, m.winner_id);
  end loop;

  update public.tournaments set status = 'live' where id = p_tournament_id;
  return public.get_tournament_bracket(p_tournament_id);
end;
$$;

revoke all on function public.host_generate_bracket(uuid) from public, anon;
grant execute on function public.host_generate_bracket(uuid) to authenticated;

create or replace function public.host_report_bracket_winner(
  p_tournament_id uuid,
  p_round integer,
  p_match_index integer,
  p_winner_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t public.tournaments;
  m public.tournament_brackets;
  max_round integer;
  final_winner uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into t from public.tournaments where id = p_tournament_id;
  if not found then raise exception 'Tournament not found'; end if;
  if t.host_id is distinct from uid then raise exception 'Only the host can report results'; end if;

  select * into m from public.tournament_brackets
  where tournament_id = p_tournament_id and round = p_round and match_index = p_match_index
  for update;
  if not found then raise exception 'Match not found'; end if;
  if m.status = 'done' then raise exception 'Match already completed'; end if;
  if p_winner_id is distinct from m.slot_a and p_winner_id is distinct from m.slot_b then
    raise exception 'Winner must be one of the match players';
  end if;

  update public.tournament_brackets
    set winner_id = p_winner_id, status = 'done'
    where id = m.id;

  perform public._bracket_place_winner(p_tournament_id, p_round, p_match_index, p_winner_id);

  select max(round) into max_round
  from public.tournament_brackets
  where tournament_id = p_tournament_id;

  if not exists (
    select 1 from public.tournament_brackets
    where tournament_id = p_tournament_id
      and round = max_round
      and status is distinct from 'done'
  ) then
    select winner_id into final_winner
    from public.tournament_brackets
    where tournament_id = p_tournament_id
      and round = max_round
    order by match_index
    limit 1;

    update public.tournaments
      set status = 'completed',
          winner_id = coalesce(final_winner, p_winner_id),
          payout_status = case
            when prize_type in ('cash', 'both') and coalesce(prize_funded, false)
              then 'pending'
            else payout_status
          end
    where id = p_tournament_id;
  end if;

  return public.get_tournament_bracket(p_tournament_id);
end;
$$;

revoke all on function public.host_report_bracket_winner(uuid, integer, integer, uuid) from public, anon;
grant execute on function public.host_report_bracket_winner(uuid, integer, integer, uuid) to authenticated;

do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and c.conrelid = 'public.tournaments'::regclass
      and a.attname = 'winner_id'
  loop
    execute format('alter table public.tournaments drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.tournaments
  add constraint tournaments_winner_id_fkey
  foreign key (winner_id) references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 12) Companion inbox order + skip expired events
-- ---------------------------------------------------------------------------
create or replace function public.get_companion_home()
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  uid uuid := auth.uid();
  prof record;
  unread integer := 0;
  messages jsonb;
  party jsonb;
  lobby jsonb;
  clan jsonb;
  coach jsonb;
  tourneys jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select gamer_tag, mmr, custom_status, main_game
  into prof
  from public.profiles where id = uid;

  select count(*)::integer into unread
  from public.messages
  where recipient_id = uid and read_at is null;

  select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.created_at desc), '[]'::jsonb)
  into messages
  from (
    select
      m.id,
      m.sender_id,
      m.body,
      m.created_at,
      m.read_at,
      coalesce(p.gamer_tag, 'Friend') as sender_tag
    from public.messages m
    left join public.profiles p on p.id = m.sender_id
    where m.recipient_id = uid
    order by m.created_at desc
    limit 12
  ) q;

  begin
    party := public.get_my_party();
  exception when others then
    party := null;
  end;

  begin
    lobby := public.get_my_lobby();
  exception when others then
    lobby := null;
  end;

  begin
    clan := public.get_my_clan();
  exception when others then
    clan := null;
  end;

  select jsonb_build_object(
    'tilt_score', cr.tilt_score,
    'summary', cr.summary,
    'generated_at', cr.generated_at
  )
  into coach
  from public.coach_reports cr
  where cr.user_id = uid;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  into tourneys
  from (
    select
      tm.id,
      tm.name,
      tm.game,
      tm.format,
      tm.starts_at,
      tm.status,
      exists (
        select 1 from public.tournament_checkins c
        where c.tournament_id = tm.id and c.user_id = uid
      ) as checked_in
    from public.tournaments tm
    where uid = any (coalesce(tm.registrations, '{}'::uuid[]))
      and coalesce(tm.status, 'open') not in ('completed', 'expired')
    order by tm.starts_at nulls last
    limit 8
  ) t;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'gamer_tag', coalesce(prof.gamer_tag, 'Player'),
      'mmr', coalesce(prof.mmr, 1200),
      'custom_status', prof.custom_status,
      'main_game', prof.main_game
    ),
    'unread_count', unread,
    'messages', messages,
    'party', party,
    'lobby', lobby,
    'clan', clan,
    'coach', coach,
    'tournaments', tourneys,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.get_companion_home() from public, anon;
grant execute on function public.get_companion_home() to authenticated;

-- ---------------------------------------------------------------------------
-- 13) Indexes + Duel K/D/A cap
-- ---------------------------------------------------------------------------
create index if not exists community_members_user_id_idx
  on public.community_members (user_id);

-- 14) Duel K/D/A cap
create or replace function public.submit_duel_winner(
  p_duel_id uuid,
  p_winner_id uuid,
  p_kills integer default null,
  p_deaths integer default null,
  p_assists integer default null
)
returns public.duels
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.duels;
  other_pick uuid;
  agreed_winner uuid;
  agreed_loser uuid;
  change integer := 15;
  host_new integer;
  chal_new integer;
  my_stats jsonb;
  host_stats jsonb;
  chal_stats jsonb;
  host_k integer;
  host_d integer;
  host_a integer;
  chal_k integer;
  chal_d integer;
  chal_a integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into d from public.duels where id = p_duel_id for update;
  if not found then
    raise exception 'Duel not found';
  end if;
  if d.status <> 'active' then
    raise exception 'Duel is not active';
  end if;
  if auth.uid() <> d.host_id and auth.uid() <> d.challenger_id then
    raise exception 'Only duel participants can report results';
  end if;
  if p_winner_id is distinct from d.host_id and p_winner_id is distinct from d.challenger_id then
    raise exception 'Winner must be one of the duel players';
  end if;

  if p_kills is not null or p_deaths is not null or p_assists is not null then
    if p_kills is null or p_deaths is null or p_assists is null then
      raise exception 'Provide kills, deaths, and assists together';
    end if;
    if p_kills < 0 or p_deaths < 0 or p_assists < 0 then
      raise exception 'Combat stats cannot be negative';
    end if;
    if p_kills > 5000 or p_deaths > 5000 or p_assists > 5000 then
      raise exception 'Combat stats out of range';
    end if;
    my_stats := jsonb_build_object(
      'kills', p_kills,
      'deaths', p_deaths,
      'assists', p_assists,
      'kda', round(((p_kills + p_assists)::numeric / greatest(p_deaths, 1)), 2)
    );
  else
    my_stats := null;
  end if;

  if auth.uid() = d.host_id then
    update public.duels
      set host_winner_pick = p_winner_id,
          host_combat_stats = coalesce(my_stats, host_combat_stats),
          updated_at = now()
      where id = p_duel_id
      returning * into d;
    other_pick := d.challenger_winner_pick;
  else
    update public.duels
      set challenger_winner_pick = p_winner_id,
          challenger_combat_stats = coalesce(my_stats, challenger_combat_stats),
          updated_at = now()
      where id = p_duel_id
      returning * into d;
    other_pick := d.host_winner_pick;
  end if;

  if other_pick is null then
    return d;
  end if;

  if other_pick is distinct from p_winner_id then
    update public.duels
      set host_winner_pick = null,
          challenger_winner_pick = null,
          host_combat_stats = null,
          challenger_combat_stats = null,
          updated_at = now()
      where id = p_duel_id
      returning * into d;
    return d;
  end if;

  agreed_winner := p_winner_id;
  if agreed_winner = d.host_id then
    agreed_loser := d.challenger_id;
  else
    agreed_loser := d.host_id;
  end if;

  host_new := greatest(800, d.host_mmr + case when agreed_winner = d.host_id then change else -change end);
  chal_new := greatest(800, coalesce(d.challenger_mmr, 1200) + case when agreed_winner = d.challenger_id then change else -change end);

  host_stats := coalesce(d.host_combat_stats, '{}'::jsonb);
  chal_stats := coalesce(d.challenger_combat_stats, '{}'::jsonb);

  insert into public.matches (user_id, game, mode, result, mmr_change, stats, duration, played_at, source)
  values
    (
      d.host_id, d.game, d.mode,
      case when agreed_winner = d.host_id then 'win' else 'loss' end,
      case when agreed_winner = d.host_id then change else -change end,
      host_stats || jsonb_build_object(
        'duel_id', d.id,
        'opponent', d.challenger_tag,
        'server', d.server,
        'queue_details', d.details
      ),
      null,
      now(),
      'duel'
    ),
    (
      d.challenger_id, d.game, d.mode,
      case when agreed_winner = d.challenger_id then 'win' else 'loss' end,
      case when agreed_winner = d.challenger_id then change else -change end,
      chal_stats || jsonb_build_object(
        'duel_id', d.id,
        'opponent', d.host_tag,
        'server', d.server,
        'queue_details', d.details
      ),
      null,
      now(),
      'duel'
    );

  host_k := coalesce((host_stats->>'kills')::integer, 0);
  host_d := coalesce((host_stats->>'deaths')::integer, 0);
  host_a := coalesce((host_stats->>'assists')::integer, 0);
  chal_k := coalesce((chal_stats->>'kills')::integer, 0);
  chal_d := coalesce((chal_stats->>'deaths')::integer, 0);
  chal_a := coalesce((chal_stats->>'assists')::integer, 0);

  update public.profiles
    set mmr = host_new,
        wins = wins + case when agreed_winner = d.host_id then 1 else 0 end,
        losses = losses + case when agreed_winner = d.host_id then 0 else 1 end,
        total_kills = total_kills + host_k,
        total_deaths = total_deaths + host_d,
        total_assists = total_assists + host_a
    where id = d.host_id;

  update public.profiles
    set mmr = chal_new,
        wins = wins + case when agreed_winner = d.challenger_id then 1 else 0 end,
        losses = losses + case when agreed_winner = d.challenger_id then 0 else 1 end,
        total_kills = total_kills + chal_k,
        total_deaths = total_deaths + chal_d,
        total_assists = total_assists + chal_a
    where id = d.challenger_id;

  update public.duels
    set status = 'completed',
        winner_id = agreed_winner,
        loser_id = agreed_loser,
        mmr_change = change,
        completed_at = now(),
        updated_at = now()
    where id = p_duel_id
    returning * into d;

  return d;
end;
$$;

revoke all on function public.submit_duel_winner(uuid, uuid, integer, integer, integer) from public;
grant execute on function public.submit_duel_winner(uuid, uuid, integer, integer, integer) to authenticated;


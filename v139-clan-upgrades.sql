-- Clan upgrades: open join, min MMR, profile tags, leaderboard, weekly rewards
-- Safe to re-run.

alter table public.clans
  add column if not exists min_mmr integer not null default 0
    check (min_mmr >= 0 and min_mmr <= 5000);

alter table public.clans
  add column if not exists is_open boolean not null default true;

alter table public.clans
  add column if not exists description text;

alter table public.profiles
  add column if not exists clan_id uuid references public.clans(id) on delete set null;

alter table public.profiles
  add column if not exists clan_tag text;

create table if not exists public.clan_reward_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  coins integer not null default 0 check (coins >= 0),
  claimed_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table public.clan_reward_claims enable row level security;

drop policy if exists "Users read own clan reward claims" on public.clan_reward_claims;
create policy "Users read own clan reward claims"
  on public.clan_reward_claims for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public._clan_week_start(ts timestamptz default now())
returns date
language sql immutable as $$
  select (date_trunc('week', ts at time zone 'utc'))::date;
$$;

create or replace function public._sync_profile_clan(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  t text;
begin
  if p_user_id is null then return; end if;
  select m.clan_id, c.tag into cid, t
  from public.clan_members m
  join public.clans c on c.id = m.clan_id
  where m.user_id = p_user_id and m.status = 'joined'
  limit 1;

  update public.profiles
    set clan_id = cid,
        clan_tag = t
  where id = p_user_id
    and (clan_id is distinct from cid or clan_tag is distinct from t);
end;
$$;

create or replace function public.trg_sync_profile_clan()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public._sync_profile_clan(old.user_id);
    return old;
  end if;
  perform public._sync_profile_clan(new.user_id);
  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    perform public._sync_profile_clan(old.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clan_members_sync_profile on public.clan_members;
create trigger trg_clan_members_sync_profile
  after insert or update or delete on public.clan_members
  for each row execute function public.trg_sync_profile_clan();

-- Backfill existing members
do $$
declare r record;
begin
  for r in
    select distinct user_id from public.clan_members where status = 'joined'
  loop
    perform public._sync_profile_clan(r.user_id);
  end loop;
end $$;

create or replace function public._clan_total_mmr(p_clan_id uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(p.mmr), 0)::integer
  from public.clan_members m
  join public.profiles p on p.id = m.user_id
  where m.clan_id = p_clan_id and m.status = 'joined';
$$;

create or replace function public._clan_member_count(p_clan_id uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
  from public.clan_members m
  where m.clan_id = p_clan_id and m.status = 'joined';
$$;

create or replace function public.get_my_clan()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  mystatus text;
  c public.clans;
  members jsonb;
  v_week_start date := public._clan_week_start();
  claimed boolean := false;
  reward_coins integer := 0;
  rank integer;
  total_mmr integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select clan_id, status into cid, mystatus
  from public.clan_members
  where user_id = uid and status in ('joined', 'invited')
  order by case when status = 'joined' then 0 else 1 end
  limit 1;
  if cid is null then return null; end if;
  select * into c from public.clans where id = cid;
  if not found then return null; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', m.user_id, 'role', m.role, 'status', m.status,
      'gamer_tag', coalesce(pr.gamer_tag, 'Player'),
      'mmr', coalesce(pr.mmr, 1200),
      'clan_tag', c.tag,
      'joined_at', m.joined_at
    ) order by case when m.role = 'owner' then 0 else 1 end, m.joined_at nulls last
  ), '[]'::jsonb)
  into members
  from public.clan_members m
  left join public.profiles pr on pr.id = m.user_id
  where m.clan_id = cid and m.status in ('joined', 'invited');

  total_mmr := public._clan_total_mmr(cid);

  select exists (
    select 1 from public.clan_reward_claims crc
    where crc.user_id = uid and crc.week_start = v_week_start
  ) into claimed;

  if mystatus = 'joined' then
    select x.rank into rank
    from (
      select c2.id,
             row_number() over (order by public._clan_total_mmr(c2.id) desc, c2.created_at asc) as rank
      from public.clans c2
    ) x
    where x.id = cid;

    reward_coins := 40
      + least(80, (total_mmr / 5000) * 10)
      + case
          when rank = 1 then 100
          when rank between 2 and 3 then 50
          when rank between 4 and 10 then 25
          else 0
        end;
  end if;

  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'tag', c.tag, 'owner_id', c.owner_id,
    'min_mmr', c.min_mmr, 'is_open', c.is_open,
    'description', c.description,
    'my_status', mystatus, 'created_at', c.created_at, 'members', members,
    'total_mmr', total_mmr,
    'member_count', public._clan_member_count(cid),
    'leaderboard_rank', rank,
    'reward', jsonb_build_object(
      'week_start', v_week_start,
      'coins', reward_coins,
      'claimed', claimed,
      'available', mystatus = 'joined' and not claimed and reward_coins > 0
    )
  );
end;
$$;

drop function if exists public.create_clan(text, text);

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

  -- Founder join bonus
  update public.profiles
    set forge_coins = least(1000000, coalesce(forge_coins, 0) + 75)
  where id = uid;

  return public.get_my_clan();
end;
$$;

create or replace function public.update_clan_settings(
  p_min_mmr integer default null,
  p_is_open boolean default null,
  p_description text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select id into cid from public.clans where owner_id = uid limit 1;
  if cid is null then raise exception 'Only the clan owner can edit settings'; end if;

  update public.clans set
    min_mmr = case when p_min_mmr is null then min_mmr else greatest(0, least(5000, p_min_mmr)) end,
    is_open = case when p_is_open is null then is_open else p_is_open end,
    description = case
      when p_description is null then description
      else nullif(trim(p_description), '')
    end
  where id = cid;

  return public.get_my_clan();
end;
$$;

create or replace function public.list_joinable_clans(p_limit integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  lim integer := greatest(1, least(50, coalesce(p_limit, 30)));
  rows jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select coalesce(jsonb_agg(row_to_json(q)::jsonb), '[]'::jsonb)
  into rows
  from (
    select
      c.id,
      c.name,
      c.tag,
      c.min_mmr,
      c.is_open,
      c.description,
      public._clan_member_count(c.id) as member_count,
      public._clan_total_mmr(c.id) as total_mmr
    from public.clans c
    where c.is_open = true
    order by public._clan_total_mmr(c.id) desc, c.created_at asc
    limit lim
  ) q;

  return jsonb_build_object('clans', rows);
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

  update public.profiles
    set forge_coins = least(1000000, coalesce(forge_coins, 0) + 75)
  where id = uid;

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

  update public.profiles
    set forge_coins = least(1000000, coalesce(forge_coins, 0) + 75)
  where id = uid;

  return public.get_my_clan();
end;
$$;

create or replace function public.get_clan_leaderboard(p_limit integer default 20)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  lim integer := greatest(1, least(50, coalesce(p_limit, 20)));
  rows jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select coalesce(jsonb_agg(row_to_json(q)::jsonb), '[]'::jsonb)
  into rows
  from (
    select
      c.id,
      c.name,
      c.tag,
      c.min_mmr,
      public._clan_member_count(c.id) as member_count,
      public._clan_total_mmr(c.id) as total_mmr,
      row_number() over (
        order by public._clan_total_mmr(c.id) desc, c.created_at asc
      ) as rank
    from public.clans c
    order by public._clan_total_mmr(c.id) desc, c.created_at asc
    limit lim
  ) q;

  return jsonb_build_object('clans', rows);
end;
$$;

create or replace function public.claim_clan_reward()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  payload jsonb;
  coins integer;
  week_start date := public._clan_week_start();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  payload := public.get_my_clan();
  if payload is null or payload->>'my_status' is distinct from 'joined' then
    raise exception 'Join a clan to claim rewards';
  end if;
  if coalesce((payload->'reward'->>'claimed')::boolean, false) then
    raise exception 'Already claimed this week';
  end if;
  coins := coalesce((payload->'reward'->>'coins')::integer, 0);
  if coins <= 0 then raise exception 'No reward available'; end if;

  insert into public.clan_reward_claims (user_id, week_start, coins)
  values (uid, week_start, coins);

  update public.profiles
    set forge_coins = least(1000000, coalesce(forge_coins, 0) + coins)
  where id = uid;

  return jsonb_build_object(
    'ok', true,
    'coins', coins,
    'week_start', week_start,
    'clan', public.get_my_clan()
  );
end;
$$;

-- Keep invite MMR check aligned (invite_to_clan unchanged otherwise)
create or replace function public.invite_to_clan(p_friend_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  c public.clans;
  friend_mmr integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_friend_id is null or p_friend_id = uid then raise exception 'Invalid invite target'; end if;
  if not public._party_are_friends(uid, p_friend_id) then
    raise exception 'You can only invite friends';
  end if;
  if public._party_is_blocked(uid, p_friend_id) then
    raise exception 'Cannot invite this player';
  end if;

  select c2.* into c
  from public.clans c2
  join public.clan_members m on m.clan_id = c2.id
  where m.user_id = uid and m.status = 'joined' and m.role in ('owner', 'officer')
  limit 1;
  if c.id is null then raise exception 'Only clan officers can invite'; end if;
  cid := c.id;

  if exists (select 1 from public.clan_members where user_id = p_friend_id and status = 'joined') then
    raise exception 'That player is already in a clan';
  end if;
  if exists (select 1 from public.clan_members where user_id = p_friend_id and status = 'invited') then
    raise exception 'That player already has a clan invite';
  end if;

  select coalesce(mmr, 1200) into friend_mmr from public.profiles where id = p_friend_id;
  if friend_mmr < c.min_mmr then
    raise exception 'That player needs % MMR (has %)', c.min_mmr, friend_mmr;
  end if;

  insert into public.clan_members (clan_id, user_id, role, status, invited_by)
  values (cid, p_friend_id, 'member', 'invited', uid)
  on conflict (clan_id, user_id) do update
    set status = 'invited', invited_by = uid, role = 'member', joined_at = null;

  return public.get_my_clan();
end;
$$;

revoke all on function public._sync_profile_clan(uuid) from public;
revoke all on function public._clan_total_mmr(uuid) from public;
revoke all on function public._clan_member_count(uuid) from public;
revoke all on function public._clan_week_start(timestamptz) from public;
revoke all on function public.create_clan(text, text, integer, boolean) from public;
revoke all on function public.update_clan_settings(integer, boolean, text) from public;
revoke all on function public.list_joinable_clans(integer) from public;
revoke all on function public.join_clan(uuid) from public;
revoke all on function public.get_clan_leaderboard(integer) from public;
revoke all on function public.claim_clan_reward() from public;

grant execute on function public.create_clan(text, text, integer, boolean) to authenticated;
grant execute on function public.update_clan_settings(integer, boolean, text) to authenticated;
grant execute on function public.list_joinable_clans(integer) to authenticated;
grant execute on function public.join_clan(uuid) to authenticated;
grant execute on function public.get_clan_leaderboard(integer) to authenticated;
grant execute on function public.claim_clan_reward() to authenticated;
grant execute on function public.get_my_clan() to authenticated;
grant execute on function public.respond_clan_invite(uuid, boolean) to authenticated;
grant execute on function public.invite_to_clan(uuid) to authenticated;

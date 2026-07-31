-- v4 Phase 1: Parties (invite / accept / ready / leave)
-- Safe to re-run. Does NOT change duels or matchmaking yet.
-- Apply before enabling party UI.

-- ── TABLES ──
create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  game text,
  status text not null default 'open'
    check (status in ('open', 'ready', 'disbanded')),
  max_members integer not null default 5
    check (max_members between 2 and 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.party_members (
  party_id uuid not null references public.parties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member'
    check (role in ('host', 'member')),
  status text not null default 'invited'
    check (status in ('invited', 'joined', 'declined', 'left', 'kicked')),
  ready boolean not null default false,
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

create index if not exists parties_host_id_idx on public.parties (host_id);
create index if not exists parties_status_updated_idx on public.parties (status, updated_at desc);
create index if not exists party_members_user_status_idx on public.party_members (user_id, status);

-- One live (joined) party membership per user.
create unique index if not exists party_members_one_joined_idx
  on public.party_members (user_id)
  where status = 'joined';

-- At most one pending invite per invitee (across parties).
create unique index if not exists party_members_one_invite_idx
  on public.party_members (user_id)
  where status = 'invited';

alter table public.parties enable row level security;
alter table public.party_members enable row level security;

-- Members / invitees can see their party. Never world-public.
drop policy if exists "Party members can view parties" on public.parties;
create policy "Party members can view parties"
  on public.parties for select
  to authenticated
  using (
    exists (
      select 1 from public.party_members pm
      where pm.party_id = parties.id
        and pm.user_id = auth.uid()
        and pm.status in ('invited', 'joined')
    )
  );

drop policy if exists "Party members can view membership" on public.party_members;
create policy "Party members can view membership"
  on public.party_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.party_members me
      where me.party_id = party_members.party_id
        and me.user_id = auth.uid()
        and me.status in ('invited', 'joined')
    )
  );

-- Mutations go through security-definer RPCs only (no insert/update/delete policies).

-- ── HELPERS ──
create or replace function public._party_are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = a and f.addressee_id = b)
        or (f.requester_id = b and f.addressee_id = a))
  );
$$;

create or replace function public._party_is_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.player_blocks bl
    where (bl.blocker_id = a and bl.blocked_id = b)
       or (bl.blocker_id = b and bl.blocked_id = a)
  );
$$;

revoke all on function public._party_are_friends(uuid, uuid) from public;
revoke all on function public._party_is_blocked(uuid, uuid) from public;

-- Snapshot first so create/invite can return it safely.
create or replace function public.get_my_party()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pid uuid;
  member_status text;
  party_row public.parties;
  members jsonb;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select party_id, status into pid, member_status
  from public.party_members
  where user_id = uid and status in ('joined', 'invited')
  order by case when status = 'joined' then 0 else 1 end
  limit 1;

  if pid is null then
    return null;
  end if;

  select * into party_row from public.parties where id = pid;
  if not found or party_row.status = 'disbanded' then
    return null;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', pm.user_id,
      'role', pm.role,
      'status', pm.status,
      'ready', pm.ready,
      'gamer_tag', coalesce(pr.gamer_tag, 'Player'),
      'mmr', coalesce(pr.mmr, 1200),
      'avatar_url', pr.avatar_url,
      'equipped_frame', pr.equipped_frame,
      'last_seen_at', pr.last_seen_at,
      'playing_game', pr.playing_game,
      'joined_at', pm.joined_at
    )
    order by case when pm.role = 'host' then 0 else 1 end, pm.joined_at nulls last, pm.created_at
  ), '[]'::jsonb)
  into members
  from public.party_members pm
  left join public.profiles pr on pr.id = pm.user_id
  where pm.party_id = pid
    and pm.status in ('joined', 'invited');

  return jsonb_build_object(
    'id', party_row.id,
    'host_id', party_row.host_id,
    'game', party_row.game,
    'status', party_row.status,
    'max_members', party_row.max_members,
    'my_status', member_status,
    'created_at', party_row.created_at,
    'updated_at', party_row.updated_at,
    'members', members
  );
end;
$$;

create or replace function public.create_party(p_game text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing uuid;
  pid uuid;
  g text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select party_id into existing
  from public.party_members
  where user_id = uid and status = 'joined'
  limit 1;

  if existing is not null then
    return public.get_my_party();
  end if;

  delete from public.party_members
  where user_id = uid and status = 'invited';

  g := nullif(trim(coalesce(p_game, '')), '');
  if g is not null and length(g) > 80 then
    raise exception 'Game name too long';
  end if;

  insert into public.parties (host_id, game, status)
  values (uid, g, 'open')
  returning id into pid;

  insert into public.party_members (party_id, user_id, role, status, ready, joined_at)
  values (pid, uid, 'host', 'joined', false, now());

  return public.get_my_party();
end;
$$;

create or replace function public.invite_to_party(p_friend_id uuid, p_game text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pid uuid;
  joined_count integer;
  max_m integer;
  existing_invite uuid;
  existing_joined uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_friend_id is null or p_friend_id = uid then
    raise exception 'Invalid invite target';
  end if;
  if not public._party_are_friends(uid, p_friend_id) then
    raise exception 'You can only invite friends';
  end if;
  if public._party_is_blocked(uid, p_friend_id) then
    raise exception 'Cannot invite this player';
  end if;

  select pm.party_id into pid
  from public.party_members pm
  where pm.user_id = uid and pm.status = 'joined'
  limit 1;

  if pid is null then
    perform public.create_party(p_game);
    select pm.party_id into pid
    from public.party_members pm
    where pm.user_id = uid and pm.status = 'joined'
    limit 1;
  end if;

  if not exists (
    select 1 from public.parties p
    where p.id = pid and p.host_id = uid and p.status in ('open', 'ready')
  ) then
    raise exception 'Only the party host can invite';
  end if;

  select max_members into max_m from public.parties where id = pid;
  select count(*)::integer into joined_count
  from public.party_members
  where party_id = pid and status = 'joined';

  if joined_count >= max_m then
    raise exception 'Party is full';
  end if;

  select party_id into existing_joined
  from public.party_members
  where user_id = p_friend_id and status = 'joined'
  limit 1;
  if existing_joined is not null then
    raise exception 'That player is already in a party';
  end if;

  select party_id into existing_invite
  from public.party_members
  where user_id = p_friend_id and status = 'invited'
  limit 1;
  if existing_invite = pid then
    return public.get_my_party();
  end if;
  if existing_invite is not null then
    raise exception 'That player already has a pending party invite';
  end if;

  insert into public.party_members (party_id, user_id, role, status, ready, invited_by)
  values (pid, p_friend_id, 'member', 'invited', false, uid)
  on conflict (party_id, user_id) do update
    set status = 'invited',
        ready = false,
        invited_by = uid,
        role = 'member',
        joined_at = null,
        updated_at = now();

  update public.parties
    set status = 'open', updated_at = now()
    where id = pid;
  return public.get_my_party();
end;
$$;

create or replace function public.respond_party_invite(p_party_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  joined_count integer;
  max_m integer;
  pstatus text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_party_id is null then
    raise exception 'Party required';
  end if;

  if not exists (
    select 1 from public.party_members
    where party_id = p_party_id and user_id = uid and status = 'invited'
  ) then
    raise exception 'No pending invite for this party';
  end if;

  if not coalesce(p_accept, false) then
    update public.party_members
      set status = 'declined', ready = false, updated_at = now()
      where party_id = p_party_id and user_id = uid;
    update public.parties set updated_at = now() where id = p_party_id;
    return jsonb_build_object('ok', true, 'accepted', false);
  end if;

  if exists (
    select 1 from public.party_members
    where user_id = uid and status = 'joined'
  ) then
    raise exception 'Leave your current party before accepting';
  end if;

  select status, max_members into pstatus, max_m
  from public.parties where id = p_party_id for update;
  if not found or pstatus not in ('open', 'ready') then
    raise exception 'Party is no longer open';
  end if;

  select count(*)::integer into joined_count
  from public.party_members
  where party_id = p_party_id and status = 'joined';
  if joined_count >= max_m then
    raise exception 'Party is full';
  end if;

  update public.party_members
    set status = 'joined',
        ready = false,
        joined_at = now(),
        updated_at = now()
    where party_id = p_party_id and user_id = uid;

  update public.parties
    set status = 'open', updated_at = now()
    where id = p_party_id;
  return public.get_my_party();
end;
$$;

create or replace function public.set_party_ready(p_ready boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pid uuid;
  all_ready boolean;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select party_id into pid
  from public.party_members
  where user_id = uid and status = 'joined'
  limit 1;
  if pid is null then
    raise exception 'Not in a party';
  end if;

  update public.party_members
    set ready = coalesce(p_ready, false), updated_at = now()
    where party_id = pid and user_id = uid and status = 'joined';

  select bool_and(ready) into all_ready
  from public.party_members
  where party_id = pid and status = 'joined';

  update public.parties
    set status = case when coalesce(all_ready, false) then 'ready' else 'open' end,
        updated_at = now()
    where id = pid and status in ('open', 'ready');

  return public.get_my_party();
end;
$$;

create or replace function public.leave_party()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pid uuid;
  was_host boolean;
  new_host uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select party_id, (role = 'host') into pid, was_host
  from public.party_members
  where user_id = uid and status = 'joined'
  limit 1;

  if pid is null then
    delete from public.party_members
    where user_id = uid and status = 'invited';
    return jsonb_build_object('ok', true, 'left', true);
  end if;

  update public.party_members
    set status = 'left', ready = false, role = 'member', updated_at = now()
    where party_id = pid and user_id = uid;

  if was_host then
    select user_id into new_host
    from public.party_members
    where party_id = pid and status = 'joined'
    order by joined_at nulls last, created_at
    limit 1;

    if new_host is null then
      update public.parties
        set status = 'disbanded', updated_at = now()
        where id = pid;
      update public.party_members
        set status = 'declined', updated_at = now()
        where party_id = pid and status = 'invited';
    else
      update public.party_members
        set role = 'host', updated_at = now()
        where party_id = pid and user_id = new_host;
      update public.parties
        set host_id = new_host, status = 'open', updated_at = now()
        where id = pid;
    end if;
  else
    update public.parties set status = 'open', updated_at = now() where id = pid;
  end if;

  return jsonb_build_object('ok', true, 'left', true);
end;
$$;

create or replace function public.kick_party_member(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pid uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_user_id is null or p_user_id = uid then
    raise exception 'Invalid kick target';
  end if;

  select pm.party_id into pid
  from public.party_members pm
  join public.parties p on p.id = pm.party_id
  where pm.user_id = uid
    and pm.status = 'joined'
    and pm.role = 'host'
    and p.host_id = uid
    and p.status in ('open', 'ready')
  limit 1;

  if pid is null then
    raise exception 'Only the party host can kick';
  end if;

  if not exists (
    select 1 from public.party_members
    where party_id = pid and user_id = p_user_id and status in ('joined', 'invited')
  ) then
    raise exception 'Player is not in this party';
  end if;

  update public.party_members
    set status = 'kicked', ready = false, role = 'member', updated_at = now()
    where party_id = pid and user_id = p_user_id;

  update public.parties
    set status = 'open', updated_at = now()
    where id = pid;

  return public.get_my_party();
end;
$$;

create or replace function public.disband_party()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pid uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select p.id into pid
  from public.parties p
  where p.host_id = uid and p.status in ('open', 'ready')
  limit 1;

  if pid is null then
    raise exception 'Only the party host can disband';
  end if;

  update public.party_members
    set status = case when status = 'joined' then 'left' else 'declined' end,
        ready = false,
        updated_at = now()
    where party_id = pid and status in ('joined', 'invited');

  update public.parties
    set status = 'disbanded', updated_at = now()
    where id = pid;

  return jsonb_build_object('ok', true, 'disbanded', true);
end;
$$;

revoke all on function public.create_party(text) from public;
revoke all on function public.invite_to_party(uuid, text) from public;
revoke all on function public.respond_party_invite(uuid, boolean) from public;
revoke all on function public.set_party_ready(boolean) from public;
revoke all on function public.leave_party() from public;
revoke all on function public.kick_party_member(uuid) from public;
revoke all on function public.disband_party() from public;
revoke all on function public.get_my_party() from public;

grant execute on function public.create_party(text) to authenticated;
grant execute on function public.invite_to_party(uuid, text) to authenticated;
grant execute on function public.respond_party_invite(uuid, boolean) to authenticated;
grant execute on function public.set_party_ready(boolean) to authenticated;
grant execute on function public.leave_party() to authenticated;
grant execute on function public.kick_party_member(uuid) to authenticated;
grant execute on function public.disband_party() to authenticated;
grant execute on function public.get_my_party() to authenticated;

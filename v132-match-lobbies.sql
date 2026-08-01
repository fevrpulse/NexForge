-- v4 Phase 3: Hosted Matchmaking Lobbies (player-hosted codes, no game servers)
-- Safe to re-run. Does NOT alter duels / parties / seasons tables.
-- Matching: join open lobby for same game+mode within MMR band, else create.

create table if not exists public.match_lobbies (
  id uuid primary key default gen_random_uuid(),
  game text not null,
  mode text not null,
  status text not null default 'open'
    check (status in ('open', 'forming', 'ready', 'live', 'completed', 'cancelled')),
  host_id uuid not null references auth.users(id) on delete cascade,
  region text,
  lobby_code text,
  details text,
  target_size integer not null default 2
    check (target_size between 2 and 20),
  mmr_avg integer not null default 1200,
  mmr_min integer not null default 800,
  mmr_max integer not null default 9999,
  season_id uuid references public.seasons(id) on delete set null,
  expires_at timestamptz,
  code_deadline_at timestamptz,
  ready_deadline_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.match_lobby_members (
  lobby_id uuid not null references public.match_lobbies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  party_id uuid references public.parties(id) on delete set null,
  ready boolean not null default false,
  mmr_snapshot integer not null default 1200,
  status text not null default 'queued'
    check (status in ('queued', 'active', 'left', 'kicked', 'timeout')),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (lobby_id, user_id)
);

create index if not exists match_lobbies_open_match_idx
  on public.match_lobbies (status, game, mode, created_at);

create index if not exists match_lobbies_host_idx
  on public.match_lobbies (host_id);

create unique index if not exists match_lobby_members_one_active_idx
  on public.match_lobby_members (user_id)
  where status in ('queued', 'active');

create index if not exists match_lobby_members_lobby_idx
  on public.match_lobby_members (lobby_id, status);

alter table public.match_lobbies enable row level security;
alter table public.match_lobby_members enable row level security;

drop policy if exists "Members can view lobbies" on public.match_lobbies;
create policy "Members can view lobbies"
  on public.match_lobbies for select
  to authenticated
  using (
    exists (
      select 1 from public.match_lobby_members m
      where m.lobby_id = match_lobbies.id
        and m.user_id = auth.uid()
        and m.status in ('queued', 'active')
    )
    or status in ('open', 'forming')
  );

drop policy if exists "Members can view lobby membership" on public.match_lobby_members;
create policy "Members can view lobby membership"
  on public.match_lobby_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.match_lobby_members me
      where me.lobby_id = match_lobby_members.lobby_id
        and me.user_id = auth.uid()
        and me.status in ('queued', 'active')
    )
    or exists (
      select 1 from public.match_lobbies l
      where l.id = match_lobby_members.lobby_id
        and l.status in ('open', 'forming')
    )
  );

create or replace function public._lobby_snapshot(p_lobby_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lob public.match_lobbies;
  members jsonb;
  seats integer;
begin
  select * into lob from public.match_lobbies where id = p_lobby_id;
  if not found then return null; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', m.user_id,
      'party_id', m.party_id,
      'ready', m.ready,
      'mmr_snapshot', m.mmr_snapshot,
      'status', m.status,
      'gamer_tag', coalesce(pr.gamer_tag, 'Player'),
      'joined_at', m.joined_at
    )
    order by m.joined_at
  ), '[]'::jsonb)
  into members
  from public.match_lobby_members m
  left join public.profiles pr on pr.id = m.user_id
  where m.lobby_id = p_lobby_id
    and m.status in ('queued', 'active');

  select count(*)::integer into seats
  from public.match_lobby_members
  where lobby_id = p_lobby_id and status in ('queued', 'active');

  return jsonb_build_object(
    'id', lob.id,
    'game', lob.game,
    'mode', lob.mode,
    'status', lob.status,
    'host_id', lob.host_id,
    'region', lob.region,
    'lobby_code', lob.lobby_code,
    'details', lob.details,
    'target_size', lob.target_size,
    'mmr_avg', lob.mmr_avg,
    'mmr_min', lob.mmr_min,
    'mmr_max', lob.mmr_max,
    'season_id', lob.season_id,
    'expires_at', lob.expires_at,
    'code_deadline_at', lob.code_deadline_at,
    'ready_deadline_at', lob.ready_deadline_at,
    'created_at', lob.created_at,
    'updated_at', lob.updated_at,
    'member_count', seats,
    'seats_left', greatest(lob.target_size - seats, 0),
    'members', members
  );
end;
$$;

create or replace function public._assert_not_in_duel(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.duels d
    where d.status in ('open', 'active')
      and (d.host_id = p_uid or d.challenger_id = p_uid)
  ) then
    raise exception 'Finish or cancel your duel queue first';
  end if;
end;
$$;

create or replace function public._lobby_recompute(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  seats integer;
  tsize integer;
  avg_mmr integer;
  st text;
begin
  select target_size, status into tsize, st
  from public.match_lobbies where id = p_lobby_id for update;
  if not found then return; end if;
  if st in ('cancelled', 'completed') then return; end if;

  select count(*)::integer, coalesce(avg(mmr_snapshot), 1200)::integer
    into seats, avg_mmr
  from public.match_lobby_members
  where lobby_id = p_lobby_id and status in ('queued', 'active');

  if seats = 0 then
    update public.match_lobbies
      set status = 'cancelled', updated_at = now()
      where id = p_lobby_id;
    return;
  end if;

  update public.match_lobbies
    set mmr_avg = avg_mmr,
        status = case
          when seats >= tsize and status = 'open' then 'forming'
          when seats < tsize and status = 'forming' and lobby_code is null then 'open'
          else status
        end,
        code_deadline_at = case
          when seats >= tsize and status = 'open' then now() + interval '120 seconds'
          when seats >= tsize and code_deadline_at is null then now() + interval '120 seconds'
          else code_deadline_at
        end,
        updated_at = now()
    where id = p_lobby_id;
end;
$$;

create or replace function public.get_my_lobby()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  lid uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select lobby_id into lid
  from public.match_lobby_members
  where user_id = uid and status in ('queued', 'active')
  limit 1;
  if lid is null then return null; end if;
  return public._lobby_snapshot(lid);
end;
$$;

create or replace function public.list_open_lobbies(
  p_game text default null,
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lim integer;
  rows jsonb;
begin
  lim := least(greatest(coalesce(p_limit, 12), 1), 30);
  select coalesce(jsonb_agg(item order by created_at), '[]'::jsonb)
  into rows
  from (
    select
      l.created_at,
      jsonb_build_object(
        'id', l.id,
        'game', l.game,
        'mode', l.mode,
        'status', l.status,
        'target_size', l.target_size,
        'mmr_min', l.mmr_min,
        'mmr_max', l.mmr_max,
        'mmr_avg', l.mmr_avg,
        'member_count', (
          select count(*)::integer from public.match_lobby_members m
          where m.lobby_id = l.id and m.status in ('queued', 'active')
        ),
        'host_tag', coalesce(pr.gamer_tag, 'Host'),
        'details', l.details
      ) as item
    from public.match_lobbies l
    left join public.profiles pr on pr.id = l.host_id
    where l.status in ('open', 'forming')
      and (p_game is null or l.game = p_game)
      and (l.expires_at is null or l.expires_at > now())
    order by l.created_at asc
    limit lim
  ) q;
  return rows;
end;
$$;

create or replace function public.join_lobby_queue(
  p_game text,
  p_mode text,
  p_details text default null,
  p_target_size integer default 2,
  p_region text default null,
  p_mmr_band integer default 150,
  p_as_party boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  my_mmr integer;
  need integer := 1;
  party_uuid uuid;
  party_host uuid;
  party_status text;
  band integer;
  tsize integer;
  g text;
  mmode text;
  det text;
  reg text;
  sid uuid;
  cand uuid;
  seats integer;
  lob_min integer;
  lob_max integer;
  lob_tsize integer;
  lid uuid;
  r record;
  ok_band boolean;
  mmr_sum integer;
  mmr_n integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  g := nullif(trim(coalesce(p_game, '')), '');
  mmode := nullif(trim(coalesce(p_mode, '')), '');
  if g is null or mmode is null then
    raise exception 'Game and mode are required';
  end if;
  if length(g) > 80 or length(mmode) > 80 then
    raise exception 'Game or mode too long';
  end if;

  det := nullif(trim(coalesce(p_details, '')), '');
  reg := nullif(trim(coalesce(p_region, '')), '');
  band := least(greatest(coalesce(p_mmr_band, 150), 50), 400);
  tsize := least(greatest(coalesce(p_target_size, 2), 2), 20);

  select coalesce(mmr, 1200) into my_mmr from public.profiles where id = uid;
  if not found then raise exception 'Profile required'; end if;

  perform public._assert_not_in_duel(uid);

  if exists (
    select 1 from public.match_lobby_members
    where user_id = uid and status in ('queued', 'active')
  ) then
    return public.get_my_lobby();
  end if;

  if coalesce(p_as_party, false) then
    select pm.party_id, p.host_id, p.status
      into party_uuid, party_host, party_status
    from public.party_members pm
    join public.parties p on p.id = pm.party_id
    where pm.user_id = uid and pm.status = 'joined'
    limit 1;

    if party_uuid is null then raise exception 'You are not in a party'; end if;
    if party_host is distinct from uid then
      raise exception 'Only the party host can queue the party';
    end if;
    if party_status is distinct from 'ready' then
      raise exception 'Party must be fully ready before queueing';
    end if;

    select count(*)::integer into need
    from public.party_members
    where party_id = party_uuid and status = 'joined';

    if need > tsize then
      raise exception 'Party is larger than the lobby size';
    end if;

    for r in
      select pm.user_id
      from public.party_members pm
      where pm.party_id = party_uuid and pm.status = 'joined'
    loop
      perform public._assert_not_in_duel(r.user_id);
      if exists (
        select 1 from public.match_lobby_members mlm
        where mlm.user_id = r.user_id and mlm.status in ('queued', 'active')
      ) then
        raise exception 'A party member is already in a lobby';
      end if;
    end loop;
  end if;

  select id into sid from public.seasons where active limit 1;

  for cand in
    select l.id
    from public.match_lobbies l
    where l.status = 'open'
      and l.game = g
      and l.mode = mmode
      and (l.expires_at is null or l.expires_at > now())
    order by l.created_at asc
  loop
    select target_size, mmr_min, mmr_max
      into lob_tsize, lob_min, lob_max
    from public.match_lobbies
    where id = cand
    for update;

    if not found or (select status from public.match_lobbies where id = cand) <> 'open' then
      continue;
    end if;

    select count(*)::integer into seats
    from public.match_lobby_members
    where lobby_id = cand and status in ('queued', 'active');

    if seats + need > lob_tsize then
      continue;
    end if;

    if coalesce(p_as_party, false) then
      ok_band := true;
      for r in
        select coalesce(pr.mmr, 1200) as mmr
        from public.party_members pm
        left join public.profiles pr on pr.id = pm.user_id
        where pm.party_id = party_uuid and pm.status = 'joined'
      loop
        if r.mmr < lob_min or r.mmr > lob_max then
          ok_band := false;
          exit;
        end if;
      end loop;
      if not ok_band then continue; end if;

      for r in
        select pm.user_id, coalesce(pr.mmr, 1200) as mmr
        from public.party_members pm
        left join public.profiles pr on pr.id = pm.user_id
        where pm.party_id = party_uuid and pm.status = 'joined'
      loop
        insert into public.match_lobby_members (lobby_id, user_id, party_id, ready, mmr_snapshot, status)
        values (cand, r.user_id, party_uuid, false, r.mmr, 'queued')
        on conflict (lobby_id, user_id) do update
          set status = 'queued', party_id = party_uuid, mmr_snapshot = excluded.mmr_snapshot,
              ready = false, updated_at = now();
      end loop;
    else
      if my_mmr < lob_min or my_mmr > lob_max then
        continue;
      end if;
      insert into public.match_lobby_members (lobby_id, user_id, party_id, ready, mmr_snapshot, status)
      values (cand, uid, null, false, my_mmr, 'queued');
    end if;

    perform public._lobby_recompute(cand);
    return public._lobby_snapshot(cand);
  end loop;

  -- Create new lobby.
  insert into public.match_lobbies (
    game, mode, status, host_id, region, details, target_size,
    mmr_avg, mmr_min, mmr_max, season_id, expires_at
  ) values (
    g, mmode, 'open', uid, reg, det, tsize,
    my_mmr, greatest(800, my_mmr - band), my_mmr + band, sid,
    now() + interval '15 minutes'
  )
  returning id into lid;

  mmr_sum := 0;
  mmr_n := 0;

  if coalesce(p_as_party, false) then
    for r in
      select pm.user_id, coalesce(pr.mmr, 1200) as mmr
      from public.party_members pm
      left join public.profiles pr on pr.id = pm.user_id
      where pm.party_id = party_uuid and pm.status = 'joined'
    loop
      insert into public.match_lobby_members (lobby_id, user_id, party_id, ready, mmr_snapshot, status)
      values (lid, r.user_id, party_uuid, false, r.mmr, 'queued');
      mmr_sum := mmr_sum + r.mmr;
      mmr_n := mmr_n + 1;
    end loop;
    if mmr_n > 0 then
      update public.match_lobbies
        set mmr_avg = mmr_sum / mmr_n,
            mmr_min = greatest(800, (mmr_sum / mmr_n) - band),
            mmr_max = (mmr_sum / mmr_n) + band,
            updated_at = now()
        where id = lid;
    end if;
  else
    insert into public.match_lobby_members (lobby_id, user_id, party_id, ready, mmr_snapshot, status)
    values (lid, uid, null, false, my_mmr, 'queued');
  end if;

  perform public._lobby_recompute(lid);
  return public._lobby_snapshot(lid);
end;
$$;

create or replace function public.leave_lobby()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  lid uuid;
  was_host boolean;
  new_host uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select m.lobby_id, (l.host_id = uid)
    into lid, was_host
  from public.match_lobby_members m
  join public.match_lobbies l on l.id = m.lobby_id
  where m.user_id = uid and m.status in ('queued', 'active')
  limit 1;

  if lid is null then
    return jsonb_build_object('ok', true, 'left', true);
  end if;

  update public.match_lobby_members
    set status = 'left', ready = false, updated_at = now()
    where lobby_id = lid and user_id = uid;

  if was_host then
    select user_id into new_host
    from public.match_lobby_members
    where lobby_id = lid and status in ('queued', 'active')
    order by joined_at
    limit 1;

    if new_host is null then
      update public.match_lobbies
        set status = 'cancelled', updated_at = now()
        where id = lid;
    else
      update public.match_lobbies
        set host_id = new_host, updated_at = now()
        where id = lid;
      perform public._lobby_recompute(lid);
    end if;
  else
    perform public._lobby_recompute(lid);
  end if;

  return jsonb_build_object('ok', true, 'left', true);
end;
$$;

create or replace function public.cancel_lobby()
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

  select l.id into lid
  from public.match_lobbies l
  where l.host_id = uid
    and l.status in ('open', 'forming', 'ready', 'live')
  limit 1;

  if lid is null then
    raise exception 'Only the lobby host can cancel';
  end if;

  update public.match_lobby_members
    set status = 'left', ready = false, updated_at = now()
    where lobby_id = lid and status in ('queued', 'active');

  update public.match_lobbies
    set status = 'cancelled', updated_at = now()
    where id = lid;

  return jsonb_build_object('ok', true, 'cancelled', true);
end;
$$;

create or replace function public.set_lobby_code(p_code text, p_details text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  lid uuid;
  code text;
  det text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  code := nullif(trim(coalesce(p_code, '')), '');
  if code is null then raise exception 'Lobby code required'; end if;
  if length(code) > 120 then raise exception 'Lobby code too long'; end if;
  det := nullif(trim(coalesce(p_details, '')), '');

  select id into lid
  from public.match_lobbies
  where host_id = uid and status in ('forming', 'ready', 'open', 'live')
  limit 1;
  if lid is null then raise exception 'Only the lobby host can set the code'; end if;

  update public.match_lobbies
    set lobby_code = code,
        details = coalesce(det, details),
        status = 'ready',
        ready_deadline_at = now() + interval '180 seconds',
        updated_at = now()
    where id = lid;

  update public.match_lobby_members
    set ready = false, status = 'active', updated_at = now()
    where lobby_id = lid and status in ('queued', 'active');

  return public._lobby_snapshot(lid);
end;
$$;

create or replace function public.set_lobby_ready(p_ready boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  lid uuid;
  all_ready boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select lobby_id into lid
  from public.match_lobby_members
  where user_id = uid and status in ('queued', 'active')
  limit 1;
  if lid is null then raise exception 'Not in a lobby'; end if;

  if (select status from public.match_lobbies where id = lid) not in ('ready', 'live', 'forming') then
    raise exception 'Lobby is not ready for ready-up yet';
  end if;

  update public.match_lobby_members
    set ready = coalesce(p_ready, false),
        status = 'active',
        updated_at = now()
    where lobby_id = lid and user_id = uid;

  select bool_and(ready) into all_ready
  from public.match_lobby_members
  where lobby_id = lid and status in ('queued', 'active');

  if coalesce(all_ready, false) then
    update public.match_lobbies
      set status = 'live', updated_at = now()
      where id = lid and status in ('ready', 'forming', 'live');
  else
    update public.match_lobbies
      set status = case when status = 'live' then 'ready' else status end,
          updated_at = now()
      where id = lid;
  end if;

  return public._lobby_snapshot(lid);
end;
$$;

revoke all on function public._lobby_snapshot(uuid) from public;
revoke all on function public._assert_not_in_duel(uuid) from public;
revoke all on function public._lobby_recompute(uuid) from public;
revoke all on function public.get_my_lobby() from public;
revoke all on function public.list_open_lobbies(text, integer) from public;
revoke all on function public.join_lobby_queue(text, text, text, integer, text, integer, boolean) from public;
revoke all on function public.leave_lobby() from public;
revoke all on function public.cancel_lobby() from public;
revoke all on function public.set_lobby_code(text, text) from public;
revoke all on function public.set_lobby_ready(boolean) from public;

grant execute on function public.get_my_lobby() to authenticated;
grant execute on function public.list_open_lobbies(text, integer) to authenticated;
grant execute on function public.join_lobby_queue(text, text, text, integer, text, integer, boolean) to authenticated;
grant execute on function public.leave_lobby() to authenticated;
grant execute on function public.cancel_lobby() to authenticated;
grant execute on function public.set_lobby_code(text, text) to authenticated;
grant execute on function public.set_lobby_ready(boolean) to authenticated;

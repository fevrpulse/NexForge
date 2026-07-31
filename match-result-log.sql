-- Casual / session win-loss logging (no MMR).
-- Safe to re-run.

alter table public.matches
  add column if not exists source text;

alter table public.matches
  add column if not exists game_session_id bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_game_session_id_fkey'
  ) then
    alter table public.matches
      add constraint matches_game_session_id_fkey
      foreign key (game_session_id)
      references public.game_sessions(id)
      on delete set null;
  end if;
end $$;

-- Backfill: ranked duel rows vs anything else.
update public.matches
set source = 'duel'
where source is null
  and (
    (stats ? 'duel_id')
    or coalesce(mmr_change, 0) <> 0
  );

update public.matches
set source = 'self_report'
where source is null;

alter table public.matches drop constraint if exists matches_source_check;
alter table public.matches
  add constraint matches_source_check
  check (source in ('duel', 'self_report'));

alter table public.matches
  alter column source set default 'self_report';

alter table public.matches
  alter column source set not null;

create unique index if not exists matches_user_session_unique
  on public.matches (user_id, game_session_id)
  where game_session_id is not null;

create index if not exists matches_source_played_at_idx
  on public.matches (user_id, source, played_at desc);

-- One-tap / quick-log path: W/L only, never MMR.
create or replace function public.log_match_result(
  p_result text,
  p_game text,
  p_mode text default null,
  p_session_id bigint default null
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  session_game text;
  session_duration integer;
  m public.matches;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_result is distinct from 'win' and p_result is distinct from 'loss' then
    raise exception 'Result must be win or loss';
  end if;
  if p_game is null or length(trim(p_game)) = 0 then
    raise exception 'Game is required';
  end if;
  if length(trim(p_game)) > 80 then
    raise exception 'Game name too long';
  end if;
  if p_mode is not null and length(trim(p_mode)) > 80 then
    raise exception 'Mode too long';
  end if;

  if p_session_id is not null then
    select gs.game, gs.duration_sec
      into session_game, session_duration
      from public.game_sessions gs
      where gs.id = p_session_id
        and gs.user_id = uid;
    if not found then
      raise exception 'Session not found';
    end if;
    if exists (
      select 1 from public.matches
      where user_id = uid and game_session_id = p_session_id
    ) then
      raise exception 'This session already has a result';
    end if;
  end if;

  insert into public.matches (
    user_id, game, mode, result, mmr_change, stats, duration, played_at, source, game_session_id
  ) values (
    uid,
    coalesce(nullif(trim(session_game), ''), trim(p_game)),
    nullif(trim(coalesce(p_mode, '')), ''),
    p_result,
    0,
    jsonb_build_object('logged', true),
    case
      when session_duration is not null then session_duration::text || 's'
      else null
    end,
    now(),
    'self_report',
    p_session_id
  )
  returning * into m;

  if p_result = 'win' then
    update public.profiles
      set wins = coalesce(wins, 0) + 1
      where id = uid;
  else
    update public.profiles
      set losses = coalesce(losses, 0) + 1
      where id = uid;
  end if;

  return m;
end;
$$;

revoke all on function public.log_match_result(text, text, text, bigint) from public;
grant execute on function public.log_match_result(text, text, text, bigint) to authenticated;

-- Tag ranked duel completions as source=duel (also restores correct column names).
drop function if exists public.submit_duel_winner(uuid, uuid);
drop function if exists public.submit_duel_winner(uuid, uuid, integer, integer, integer);

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

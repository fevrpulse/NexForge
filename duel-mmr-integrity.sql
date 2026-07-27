-- Additive: settle duel MMR from live profiles (not client-supplied duel.host_mmr).
-- Also force host_mmr from profiles on queue insert.
-- Paste into Supabase SQL editor. Safe to re-run.

create or replace function public.duels_stamp_host_mmr()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  live_mmr integer;
begin
  select mmr into live_mmr from public.profiles where id = new.host_id;
  new.host_mmr := coalesce(live_mmr, 1200);
  return new;
end;
$$;

drop trigger if exists duels_stamp_host_mmr on public.duels;
create trigger duels_stamp_host_mmr
  before insert on public.duels
  for each row execute function public.duels_stamp_host_mmr();

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
  host_base integer;
  chal_base integer;
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

  -- Always settle from live profile MMR (ignore client-supplied duel snapshot).
  select mmr into host_base from public.profiles where id = d.host_id;
  select mmr into chal_base from public.profiles where id = d.challenger_id;
  host_base := coalesce(host_base, d.host_mmr, 1200);
  chal_base := coalesce(chal_base, d.challenger_mmr, 1200);

  host_new := greatest(800, host_base + case when agreed_winner = d.host_id then change else -change end);
  chal_new := greatest(800, chal_base + case when agreed_winner = d.challenger_id then change else -change end);

  host_stats := coalesce(d.host_combat_stats, '{}'::jsonb);
  chal_stats := coalesce(d.challenger_combat_stats, '{}'::jsonb);

  insert into public.matches (user_id, game, mode, result, mmr_change, stats, duration, played_at)
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
      now()
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
      now()
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
        host_mmr = host_base,
        challenger_mmr = chal_base,
        completed_at = now(),
        updated_at = now()
    where id = p_duel_id
    returning * into d;

  return d;
end;
$$;

grant execute on function public.submit_duel_winner(uuid, uuid, integer, integer, integer) to authenticated;

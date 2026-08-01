-- v4 Phase 2: Ranked Seasons (dual-write beside profiles.mmr)
-- Safe to re-run. Does not reset lifetime MMR / cosmetics gates.
-- Season ladder uses game='_global' for now (same pool as today).

-- ── TABLES ──
create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.season_ratings (
  user_id uuid not null references auth.users(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  game text not null default '_global',
  mmr integer not null default 1200 check (mmr >= 800),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  peak_mmr integer not null default 1200 check (peak_mmr >= 800),
  updated_at timestamptz not null default now(),
  primary key (user_id, season_id, game)
);

create unique index if not exists seasons_one_active_idx
  on public.seasons ((true))
  where active;

create index if not exists season_ratings_leaderboard_idx
  on public.season_ratings (season_id, game, mmr desc);

create index if not exists season_ratings_user_idx
  on public.season_ratings (user_id, season_id);

alter table public.seasons enable row level security;
alter table public.season_ratings enable row level security;

drop policy if exists "Authenticated can read seasons" on public.seasons;
create policy "Authenticated can read seasons"
  on public.seasons for select
  to authenticated
  using (true);

drop policy if exists "Authenticated can read season ratings" on public.season_ratings;
create policy "Authenticated can read season ratings"
  on public.season_ratings for select
  to authenticated
  using (true);

-- Mutations via security-definer RPCs only.

-- Seed Season 1 if no seasons exist yet.
insert into public.seasons (name, starts_at, ends_at, active)
select
  'Season 1',
  now(),
  now() + interval '90 days',
  true
where not exists (select 1 from public.seasons);

-- If seasons exist but none active, activate the latest by starts_at.
update public.seasons s
set active = true
where s.id = (
  select id from public.seasons
  order by starts_at desc
  limit 1
)
and not exists (select 1 from public.seasons where active);

-- ── HELPERS ──
create or replace function public._apply_season_duel_result(
  p_user_id uuid,
  p_won boolean,
  p_seed_mmr integer,
  p_change integer default 15
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
  cur integer;
  new_mmr integer;
  delta integer;
begin
  if p_user_id is null then
    return;
  end if;

  select id into sid from public.seasons where active limit 1;
  if sid is null then
    return;
  end if;

  delta := coalesce(p_change, 15);
  if not coalesce(p_won, false) then
    delta := -delta;
  end if;

  select mmr into cur
  from public.season_ratings
  where user_id = p_user_id
    and season_id = sid
    and game = '_global';

  if not found then
    cur := greatest(800, coalesce(p_seed_mmr, 1200));
  end if;

  new_mmr := greatest(800, cur + delta);

  insert into public.season_ratings as sr (
    user_id, season_id, game, mmr, wins, losses, peak_mmr, updated_at
  ) values (
    p_user_id,
    sid,
    '_global',
    new_mmr,
    case when coalesce(p_won, false) then 1 else 0 end,
    case when coalesce(p_won, false) then 0 else 1 end,
    new_mmr,
    now()
  )
  on conflict (user_id, season_id, game) do update
    set mmr = excluded.mmr,
        wins = sr.wins + excluded.wins,
        losses = sr.losses + excluded.losses,
        peak_mmr = greatest(sr.peak_mmr, excluded.mmr),
        updated_at = now();
end;
$$;

revoke all on function public._apply_season_duel_result(uuid, boolean, integer, integer) from public;

-- ── READ RPCs ──
create or replace function public.get_active_season()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.seasons;
begin
  select * into s from public.seasons where active limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'starts_at', s.starts_at,
    'ends_at', s.ends_at,
    'active', s.active
  );
end;
$$;

create or replace function public.get_my_season_ratings(p_season_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  rows jsonb;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  sid := p_season_id;
  if sid is null then
    select id into sid from public.seasons where active limit 1;
  end if;
  if sid is null then
    return jsonb_build_object('season', null, 'ratings', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'season_id', sr.season_id,
      'game', sr.game,
      'mmr', sr.mmr,
      'wins', sr.wins,
      'losses', sr.losses,
      'peak_mmr', sr.peak_mmr,
      'updated_at', sr.updated_at
    )
    order by sr.game
  ), '[]'::jsonb)
  into rows
  from public.season_ratings sr
  where sr.user_id = uid and sr.season_id = sid;

  return jsonb_build_object(
    'season', public.get_active_season(),
    'season_id', sid,
    'ratings', rows
  );
end;
$$;

create or replace function public.get_season_leaderboard(
  p_season_id uuid default null,
  p_game text default '_global',
  p_limit integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sid uuid;
  g text;
  lim integer;
  rows jsonb;
begin
  sid := p_season_id;
  if sid is null then
    select id into sid from public.seasons where active limit 1;
  end if;
  if sid is null then
    return '[]'::jsonb;
  end if;

  g := coalesce(nullif(trim(p_game), ''), '_global');
  lim := least(greatest(coalesce(p_limit, 10), 1), 50);

  select coalesce(jsonb_agg(row_data order by ord), '[]'::jsonb)
  into rows
  from (
    select
      row_number() over (order by sr.mmr desc, sr.updated_at asc) as ord,
      jsonb_build_object(
        'id', pr.id,
        'gamer_tag', pr.gamer_tag,
        'mmr', sr.mmr,
        'peak_mmr', sr.peak_mmr,
        'wins', sr.wins,
        'losses', sr.losses,
        'main_game', pr.main_game,
        'platform', pr.platform,
        'avatar_path', pr.avatar_path,
        'avatar_preset', pr.avatar_preset,
        'equipped_frame', pr.equipped_frame,
        'equipped_banner', pr.equipped_banner,
        'equipped_nameplate', pr.equipped_nameplate
      ) as row_data
    from public.season_ratings sr
    join public.profiles pr on pr.id = sr.user_id
    where sr.season_id = sid
      and sr.game = g
    order by sr.mmr desc, sr.updated_at asc
    limit lim
  ) ranked;

  return rows;
end;
$$;

revoke all on function public.get_active_season() from public;
revoke all on function public.get_my_season_ratings(uuid) from public;
revoke all on function public.get_season_leaderboard(uuid, text, integer) from public;

grant execute on function public.get_active_season() to authenticated;
grant execute on function public.get_my_season_ratings(uuid) to authenticated;
grant execute on function public.get_season_leaderboard(uuid, text, integer) to authenticated;

-- Dual-write season ratings when a ranked duel match row is inserted.
-- Safer than rewriting submit_duel_winner: existing duel settle path stays identical.
create or replace function public.trg_season_on_duel_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  seed integer;
begin
  if new.source is distinct from 'duel' then
    return new;
  end if;
  if new.result is distinct from 'win' and new.result is distinct from 'loss' then
    return new;
  end if;

  select mmr into seed from public.profiles where id = new.user_id;

  perform public._apply_season_duel_result(
    new.user_id,
    new.result = 'win',
    coalesce(seed, 1200),
    abs(coalesce(nullif(new.mmr_change, 0), 15))
  );

  return new;
end;
$$;

drop trigger if exists trg_season_on_duel_match on public.matches;
create trigger trg_season_on_duel_match
  after insert on public.matches
  for each row
  execute function public.trg_season_on_duel_match();

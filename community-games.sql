-- NexForge community games
-- When enough players set the same custom "Other" main game, promote it into the live catalog.
-- Apply in Supabase SQL editor (after security-hardening.sql).

create table if not exists public.community_games (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_key text not null unique,
  player_count integer not null default 0,
  status text not null default 'watching'
    check (status in ('watching', 'live')),
  category text not null default 'Community',
  mark text,
  created_at timestamptz not null default now(),
  promoted_at timestamptz
);

create index if not exists community_games_status_idx
  on public.community_games (status);

alter table public.community_games enable row level security;

drop policy if exists "Anyone can view community games" on public.community_games;
create policy "Anyone can view community games"
  on public.community_games for select
  to anon, authenticated
  using (true);

-- Built-in catalog (keep in sync with src/renderer/lib/games.js KNOWN_MAIN_GAMES)
create or replace function public.nexforge_builtin_game_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'valorant',
    'cs2',
    'call of duty: warzone',
    'overwatch 2',
    'halo infinite',
    'apex legends',
    'fortnite',
    'pubg',
    'fall guys',
    'rocket league',
    'fifa 25',
    'nba 2k25',
    'league of legends',
    'dota 2',
    'minecraft',
    'roblox',
    'gta online',
    'geometry dash',
    'meccha chameleon'
  ];
$$;

create or replace function public.normalize_game_key(raw text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(lower(trim(coalesce(raw, ''))), '\s+', ' ', 'g'),
    ''
  );
$$;

-- Recount custom main_game values from profiles and promote games that hit the threshold.
create or replace function public.sync_community_games(p_threshold integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_threshold integer := greatest(coalesce(p_threshold, 5), 2);
  v_promoted integer := 0;
  v_watching integer := 0;
  r record;
begin
  -- Aggregate custom (non-builtin) main games from profiles
  for r in
    with ranked as (
      select
        public.normalize_game_key(p.main_game) as name_key,
        mode() within group (order by trim(p.main_game)) as display_name,
        count(*)::integer as player_count
      from public.profiles p
      where p.main_game is not null
        and length(trim(p.main_game)) between 2 and 60
        and public.normalize_game_key(p.main_game) is not null
        and not (public.normalize_game_key(p.main_game) = any (public.nexforge_builtin_game_keys()))
      group by 1
      having count(*) >= 1
    )
    select * from ranked
  loop
    insert into public.community_games as cg (name, name_key, player_count, status, category, mark, promoted_at)
    values (
      r.display_name,
      r.name_key,
      r.player_count,
      case when r.player_count >= v_threshold then 'live' else 'watching' end,
      'Community',
      upper(left(regexp_replace(r.display_name, '[^A-Za-z0-9]', '', 'g'), 4)),
      case when r.player_count >= v_threshold then now() else null end
    )
    on conflict (name_key) do update
      set
        name = excluded.name,
        player_count = excluded.player_count,
        status = case
          when excluded.player_count >= v_threshold then 'live'
          else community_games.status
        end,
        promoted_at = case
          when community_games.status <> 'live' and excluded.player_count >= v_threshold then now()
          else community_games.promoted_at
        end;

    if r.player_count >= v_threshold then
      v_promoted := v_promoted + 1;
    else
      v_watching := v_watching + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'threshold', v_threshold,
    'live_or_promoted', v_promoted,
    'watching', v_watching
  );
end;
$$;

grant execute on function public.sync_community_games(integer) to anon, authenticated;

-- Convenience: clients call after saving an Other main game
create or replace function public.report_custom_main_game(p_game text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_key := public.normalize_game_key(p_game);
  if v_key is null then
    raise exception 'Provide a game name';
  end if;

  if v_key = any (public.nexforge_builtin_game_keys()) then
    return jsonb_build_object('ok', true, 'builtin', true);
  end if;

  -- Profile should already be updated by the client; sync tallies.
  return public.sync_community_games(5);
end;
$$;

grant execute on function public.report_custom_main_game(text) to authenticated;

-- Initial sync for existing data
select public.sync_community_games(5);

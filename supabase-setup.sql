-- NexForge schema setup for project nfaxokwpmaxyhnvatrwf
-- Safe to re-run

-- ── PROFILES ──
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  gamer_tag text not null,
  platform text default 'PC',
  main_game text default 'Valorant',
  main_game_description text,
  onboarding_done boolean not null default true,
  mmr integer not null default 1200,
  wins integer not null default 0,
  losses integer not null default 0,
  total_kills integer not null default 0,
  total_deaths integer not null default 0,
  total_assists integer not null default 0,
  total_damage integer not null default 0,
  created_at timestamptz not null default now()
);

-- Additive columns for existing databases
alter table public.profiles add column if not exists main_game_description text;
alter table public.profiles add column if not exists onboarding_done boolean not null default true;

alter table public.profiles enable row level security;

drop policy if exists "Profiles are viewable by everyone" on public.profiles;
create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- ── MATCHES ──
create table if not exists public.matches (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null,
  mode text,
  result text check (result in ('win', 'loss')),
  mmr_change integer default 0,
  stats jsonb default '{}'::jsonb,
  duration text,
  played_at timestamptz not null default now()
);

create index if not exists matches_user_id_played_at_idx
  on public.matches (user_id, played_at desc);

alter table public.matches enable row level security;

drop policy if exists "Users can view own matches" on public.matches;
create policy "Users can view own matches"
  on public.matches for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own matches" on public.matches;
create policy "Users can insert own matches"
  on public.matches for insert
  with check (auth.uid() = user_id);

-- ── TOURNAMENTS ──
create table if not exists public.tournaments (
  id uuid primary key,
  host_id uuid not null references auth.users(id) on delete cascade,
  host_tag text,
  name text not null,
  game text not null,
  format text,
  max_slots integer not null default 16,
  starts_at timestamptz not null,
  rules text,
  prize_type text not null check (prize_type in ('cash', 'inapp', 'both')),
  cash_amount numeric(12,2),
  inapp_reward text,
  status text not null default 'open' check (status in ('open', 'registered', 'completed')),
  registrations uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  -- Organizer payout / funding details (cash prizes only)
  bank_holder text,
  bank_name text,
  bank_routing text,
  bank_account text,
  bank_account_last4 text,
  bank_type text,
  bank_country text,
  payout_email text,
  payout_phone text
);

create index if not exists tournaments_starts_at_idx
  on public.tournaments (starts_at asc);

create index if not exists tournaments_status_idx
  on public.tournaments (status);

alter table public.tournaments enable row level security;

-- Public can browse tournament cards, but sensitive bank columns are restricted via view/policy pattern.
-- For simplicity: authenticated users can read tournament rows; bank fields are only readable by host.
drop policy if exists "Anyone can view tournaments" on public.tournaments;
create policy "Anyone can view tournaments"
  on public.tournaments for select
  using (true);

drop policy if exists "Authenticated users can create tournaments" on public.tournaments;
create policy "Authenticated users can create tournaments"
  on public.tournaments for insert
  to authenticated
  with check (auth.uid() = host_id);

drop policy if exists "Hosts can update own tournaments" on public.tournaments;
create policy "Hosts can update own tournaments"
  on public.tournaments for update
  to authenticated
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id);

-- Allow registered players to update only the registrations array on open tournaments.
-- Implemented via a SECURITY DEFINER function so clients don't need broad update rights.
create or replace function public.register_for_tournament(tournament_id uuid)
returns public.tournaments
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
  if auth.uid() = any(t.registrations) then
    return t;
  end if;
  if coalesce(array_length(t.registrations, 1), 0) >= t.max_slots then
    raise exception 'Tournament is full';
  end if;

  update public.tournaments
    set registrations = array_append(registrations, auth.uid())
    where id = tournament_id
    returning * into t;

  return t;
end;
$$;

create or replace function public.unregister_from_tournament(tournament_id uuid)
returns public.tournaments
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

  update public.tournaments
    set registrations = array_remove(registrations, auth.uid())
    where id = tournament_id
    returning * into t;

  if not found then
    raise exception 'Tournament not found';
  end if;

  return t;
end;
$$;

grant execute on function public.register_for_tournament(uuid) to authenticated;
grant execute on function public.unregister_from_tournament(uuid) to authenticated;

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, gamer_tag, platform, main_game, onboarding_done)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'gamer_tag', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'platform', 'PC'),
    'Valorant',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── GAME SESSIONS (performance tracking) ──
create table if not exists public.game_sessions (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null,
  process_name text,
  duration_sec integer not null,
  avg_ram_mb numeric,
  max_ram_mb numeric,
  avg_cpu_pct numeric,
  max_cpu_pct numeric,
  avg_ping_ms numeric,
  max_ping_ms numeric,
  tips text[] default '{}',
  samples jsonb default '[]'::jsonb,
  kills integer,
  deaths integer,
  assists integer,
  started_at timestamptz not null,
  ended_at timestamptz not null default now()
);

alter table public.game_sessions add column if not exists kills integer;
alter table public.game_sessions add column if not exists deaths integer;
alter table public.game_sessions add column if not exists assists integer;

create index if not exists game_sessions_user_id_ended_at_idx
  on public.game_sessions (user_id, ended_at desc);

alter table public.game_sessions enable row level security;

drop policy if exists "Users can view own game sessions" on public.game_sessions;
create policy "Users can view own game sessions"
  on public.game_sessions for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own game sessions" on public.game_sessions;
create policy "Users can insert own game sessions"
  on public.game_sessions for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own game sessions" on public.game_sessions;
create policy "Users can update own game sessions"
  on public.game_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
-- Additive: public duel queues + mutual result reporting
-- Paste into Supabase SQL editor

create extension if not exists pgcrypto;

create table if not exists public.duels (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  host_tag text not null,
  host_mmr integer not null default 1200,
  challenger_id uuid references auth.users(id) on delete set null,
  challenger_tag text,
  challenger_mmr integer,
  game text not null,
  mode text,
  details text,
  server text,
  status text not null default 'open'
    check (status in ('open', 'active', 'completed', 'cancelled')),
  host_winner_pick uuid,
  challenger_winner_pick uuid,
  host_combat_stats jsonb,
  challenger_combat_stats jsonb,
  winner_id uuid,
  loser_id uuid,
  mmr_change integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.duels add column if not exists host_combat_stats jsonb;
alter table public.duels add column if not exists challenger_combat_stats jsonb;

create index if not exists duels_status_created_idx
  on public.duels (status, created_at desc);

create index if not exists duels_host_id_idx on public.duels (host_id);
create index if not exists duels_challenger_id_idx on public.duels (challenger_id);

alter table public.duels enable row level security;

drop policy if exists "Anyone can view duels" on public.duels;
create policy "Anyone can view duels"
  on public.duels for select
  using (true);

drop policy if exists "Users can create open duels" on public.duels;
create policy "Users can create open duels"
  on public.duels for insert
  to authenticated
  with check (auth.uid() = host_id and status = 'open');

drop policy if exists "Hosts can cancel own open duels" on public.duels;
create policy "Hosts can cancel own open duels"
  on public.duels for update
  to authenticated
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id);

-- Accept an open queue (sets challenger, status active)
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

-- Host cancels an open queue
create or replace function public.cancel_duel(p_duel_id uuid)
returns public.duels
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.duels;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into d from public.duels where id = p_duel_id for update;
  if not found then
    raise exception 'Queue not found';
  end if;
  if d.host_id <> auth.uid() then
    raise exception 'Only the host can cancel';
  end if;
  if d.status <> 'open' then
    raise exception 'Only open queues can be cancelled';
  end if;

  update public.duels
    set status = 'cancelled', updated_at = now()
    where id = p_duel_id
    returning * into d;

  return d;
end;
$$;

-- Participants submit who won (+ optional K/D/A). When both agree, MMR + match history are written.
-- See combat-stats.sql for the full replace on existing databases.
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
        completed_at = now(),
        updated_at = now()
    where id = p_duel_id
    returning * into d;

  return d;
end;
$$;

grant execute on function public.accept_duel(uuid) to authenticated;
grant execute on function public.cancel_duel(uuid) to authenticated;
grant execute on function public.submit_duel_winner(uuid, uuid, integer, integer, integer) to authenticated;

-- After initial setup, also run security-hardening.sql (bank/PII view, duel cancel
-- policy, profile column grants, add_session_combat).


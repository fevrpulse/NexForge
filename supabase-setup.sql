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
  started_at timestamptz not null,
  ended_at timestamptz not null default now()
);

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

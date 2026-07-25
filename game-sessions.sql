-- Additive: game session performance tracking
-- Paste into Supabase SQL editor if you already ran supabase-setup.sql earlier

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

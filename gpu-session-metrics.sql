-- Additive: average / peak GPU utilization on game sessions
-- Paste into Supabase SQL editor after game_sessions exists

alter table public.game_sessions add column if not exists avg_gpu_pct numeric;
alter table public.game_sessions add column if not exists max_gpu_pct numeric;

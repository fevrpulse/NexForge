-- v159: Disk and Wi-Fi utilization on game sessions (analytics graphs).
-- Safe to re-run.

alter table public.game_sessions add column if not exists avg_disk_pct numeric;
alter table public.game_sessions add column if not exists max_disk_pct numeric;
alter table public.game_sessions add column if not exists avg_wifi_pct numeric;
alter table public.game_sessions add column if not exists max_wifi_pct numeric;

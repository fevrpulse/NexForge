-- Additive: ensure tournament IDs auto-generate when clients omit id
-- Safe to re-run in the Supabase SQL editor

alter table public.tournaments
  alter column id set default gen_random_uuid();

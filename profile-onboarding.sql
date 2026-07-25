-- Additive: main game onboarding fields
-- Paste into Supabase SQL editor if profiles already exists

alter table public.profiles add column if not exists main_game_description text;
alter table public.profiles add column if not exists onboarding_done boolean not null default true;

-- New signups should complete onboarding; existing players stay marked done.
update public.profiles
set onboarding_done = true
where onboarding_done is distinct from true;

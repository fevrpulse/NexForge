-- v4 Phase 6: Season Battle Pass (XP + claimable tiers)
-- Safe to re-run. Dual-writes XP from duel match wins via trigger.

create table if not exists public.season_pass_tiers (
  season_id uuid not null references public.seasons(id) on delete cascade,
  tier integer not null check (tier >= 1),
  xp_required integer not null check (xp_required >= 0),
  reward_coins integer not null default 0 check (reward_coins >= 0),
  reward_label text,
  primary key (season_id, tier)
);

create table if not exists public.season_pass_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  xp integer not null default 0 check (xp >= 0),
  claimed_tiers integer[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, season_id)
);

create table if not exists public.season_challenges (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  key text not null,
  title text not null,
  target integer not null default 1 check (target >= 1),
  xp_reward integer not null default 50 check (xp_reward >= 0),
  active boolean not null default true,
  unique (season_id, key)
);

create table if not exists public.season_challenge_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid not null references public.season_challenges(id) on delete cascade,
  progress integer not null default 0 check (progress >= 0),
  completed_at timestamptz,
  primary key (user_id, challenge_id)
);

alter table public.season_pass_tiers enable row level security;
alter table public.season_pass_progress enable row level security;
alter table public.season_challenges enable row level security;
alter table public.season_challenge_progress enable row level security;

drop policy if exists "Read pass tiers" on public.season_pass_tiers;
create policy "Read pass tiers" on public.season_pass_tiers for select to authenticated using (true);
drop policy if exists "Read own pass progress" on public.season_pass_progress;
create policy "Read own pass progress" on public.season_pass_progress for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Read challenges" on public.season_challenges;
create policy "Read challenges" on public.season_challenges for select to authenticated using (true);
drop policy if exists "Read own challenge progress" on public.season_challenge_progress;
create policy "Read own challenge progress" on public.season_challenge_progress for select to authenticated using (auth.uid() = user_id);

-- Seed tiers + challenges for the active season if empty.
do $$
declare
  sid uuid;
  i integer;
begin
  select id into sid from public.seasons where active limit 1;
  if sid is null then return; end if;

  if not exists (select 1 from public.season_pass_tiers where season_id = sid) then
    for i in 1..10 loop
      insert into public.season_pass_tiers (season_id, tier, xp_required, reward_coins, reward_label)
      values (sid, i, i * 100, 25 * i, 'Tier ' || i || ' Forge Coins');
    end loop;
  end if;

  insert into public.season_challenges (season_id, key, title, target, xp_reward)
  values
    (sid, 'duel_wins_3', 'Win 3 ranked duels', 3, 75),
    (sid, 'duel_wins_10', 'Win 10 ranked duels', 10, 200),
    (sid, 'matches_5', 'Play 5 ranked matches', 5, 50)
  on conflict (season_id, key) do nothing;
end $$;

create or replace function public._award_pass_xp(p_user_id uuid, p_xp integer)
returns void
language plpgsql security definer set search_path = public as $$
declare
  sid uuid;
begin
  if p_user_id is null or coalesce(p_xp, 0) <= 0 then return; end if;
  select id into sid from public.seasons where active limit 1;
  if sid is null then return; end if;

  insert into public.season_pass_progress (user_id, season_id, xp, claimed_tiers, updated_at)
  values (p_user_id, sid, p_xp, '{}', now())
  on conflict (user_id, season_id) do update
    set xp = public.season_pass_progress.xp + excluded.xp,
        updated_at = now();
end;
$$;

create or replace function public.trg_pass_on_duel_match()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sid uuid;
  ch record;
begin
  if new.source is distinct from 'duel' then return new; end if;

  if new.result = 'win' then
    perform public._award_pass_xp(new.user_id, 50);
  else
    perform public._award_pass_xp(new.user_id, 15);
  end if;

  select id into sid from public.seasons where active limit 1;
  if sid is null then return new; end if;

  -- matches_5 challenge
  for ch in
    select c.id, c.target, c.xp_reward, c.key
    from public.season_challenges c
    where c.season_id = sid and c.active and c.key in ('matches_5', 'duel_wins_3', 'duel_wins_10')
  loop
    if ch.key = 'matches_5' or (ch.key like 'duel_wins%' and new.result = 'win') then
      insert into public.season_challenge_progress (user_id, challenge_id, progress)
      values (new.user_id, ch.id, 1)
      on conflict (user_id, challenge_id) do update
        set progress = least(
          ch.target,
          public.season_challenge_progress.progress + 1
        ),
        completed_at = case
          when public.season_challenge_progress.progress + 1 >= ch.target
            and public.season_challenge_progress.completed_at is null
          then now()
          else public.season_challenge_progress.completed_at
        end;

      if exists (
        select 1 from public.season_challenge_progress p
        where p.user_id = new.user_id and p.challenge_id = ch.id
          and p.completed_at is not null
          and p.progress >= ch.target
      ) then
        -- Award challenge XP once: only when just completed (progress hit target this insert).
        -- Simple approach: award if completed_at was set in this statement — approximate by checking progress = target.
        perform public._award_pass_xp(new.user_id, ch.xp_reward);
      end if;
    end if;
  end loop;

  return new;
end;
$$;

-- Challenge XP can double-fire on every win after complete — fix with one-shot flag.
-- Safer challenge award: only when completed_at transitions null -> now.
create or replace function public.trg_pass_on_duel_match()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sid uuid;
  ch record;
  prev integer;
  was_done boolean;
begin
  if new.source is distinct from 'duel' then return new; end if;

  if new.result = 'win' then
    perform public._award_pass_xp(new.user_id, 50);
  else
    perform public._award_pass_xp(new.user_id, 15);
  end if;

  select id into sid from public.seasons where active limit 1;
  if sid is null then return new; end if;

  for ch in
    select c.id, c.target, c.xp_reward, c.key
    from public.season_challenges c
    where c.season_id = sid and c.active
  loop
    if ch.key = 'matches_5' or (ch.key like 'duel_wins%' and new.result = 'win') then
      select progress, completed_at is not null
        into prev, was_done
      from public.season_challenge_progress
      where user_id = new.user_id and challenge_id = ch.id;

      prev := coalesce(prev, 0);
      was_done := coalesce(was_done, false);

      insert into public.season_challenge_progress (user_id, challenge_id, progress, completed_at)
      values (
        new.user_id, ch.id, least(ch.target, prev + 1),
        case when prev + 1 >= ch.target then now() else null end
      )
      on conflict (user_id, challenge_id) do update
        set progress = least(ch.target, public.season_challenge_progress.progress + 1),
            completed_at = case
              when public.season_challenge_progress.completed_at is not null
                then public.season_challenge_progress.completed_at
              when public.season_challenge_progress.progress + 1 >= ch.target then now()
              else null
            end;

      if not was_done and prev + 1 >= ch.target then
        perform public._award_pass_xp(new.user_id, ch.xp_reward);
      end if;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_pass_on_duel_match on public.matches;
create trigger trg_pass_on_duel_match
  after insert on public.matches
  for each row execute function public.trg_pass_on_duel_match();

create or replace function public.get_my_battle_pass()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  sname text;
  prog public.season_pass_progress;
  tiers jsonb;
  challenges jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select id, name into sid, sname from public.seasons where active limit 1;
  if sid is null then
    return jsonb_build_object('season', null);
  end if;

  select * into prog from public.season_pass_progress
  where user_id = uid and season_id = sid;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'tier', t.tier, 'xp_required', t.xp_required,
      'reward_coins', t.reward_coins, 'reward_label', t.reward_label,
      'claimed', coalesce(t.tier = any (prog.claimed_tiers), false),
      'unlocked', coalesce(prog.xp, 0) >= t.xp_required
    ) order by t.tier
  ), '[]'::jsonb)
  into tiers
  from public.season_pass_tiers t
  where t.season_id = sid;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id, 'key', c.key, 'title', c.title,
      'target', c.target, 'xp_reward', c.xp_reward,
      'progress', coalesce(p.progress, 0),
      'completed', p.completed_at is not null
    ) order by c.title
  ), '[]'::jsonb)
  into challenges
  from public.season_challenges c
  left join public.season_challenge_progress p
    on p.challenge_id = c.id and p.user_id = uid
  where c.season_id = sid and c.active;

  return jsonb_build_object(
    'season', jsonb_build_object('id', sid, 'name', sname),
    'xp', coalesce(prog.xp, 0),
    'claimed_tiers', coalesce(to_jsonb(prog.claimed_tiers), '[]'::jsonb),
    'tiers', tiers,
    'challenges', challenges
  );
end;
$$;

create or replace function public.claim_pass_tier(p_tier integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  prog public.season_pass_progress;
  tier_row public.season_pass_tiers;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select id into sid from public.seasons where active limit 1;
  if sid is null then raise exception 'No active season'; end if;

  select * into prog from public.season_pass_progress
  where user_id = uid and season_id = sid for update;
  if not found then raise exception 'No pass progress yet — play ranked duels'; end if;

  select * into tier_row from public.season_pass_tiers
  where season_id = sid and tier = p_tier;
  if not found then raise exception 'Tier not found'; end if;
  if prog.xp < tier_row.xp_required then raise exception 'Tier not unlocked'; end if;
  if p_tier = any (prog.claimed_tiers) then raise exception 'Tier already claimed'; end if;

  update public.season_pass_progress
    set claimed_tiers = array_append(claimed_tiers, p_tier), updated_at = now()
    where user_id = uid and season_id = sid;

  if tier_row.reward_coins > 0 then
    update public.profiles
      set forge_coins = least(1000000, coalesce(forge_coins, 0) + tier_row.reward_coins)
      where id = uid;
  end if;

  return public.get_my_battle_pass();
end;
$$;

revoke all on function public._award_pass_xp(uuid, integer) from public;
revoke all on function public.get_my_battle_pass() from public;
revoke all on function public.claim_pass_tier(integer) from public;
grant execute on function public.get_my_battle_pass() to authenticated;
grant execute on function public.claim_pass_tier(integer) to authenticated;

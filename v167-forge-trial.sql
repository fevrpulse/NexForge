-- v167 The Forge: Forge Coins are minted by clearing a strike trial.
-- Free daily claims and match-win coin drips no longer mint coins.
-- Clan rewards and the season pass are unchanged.
-- Safe to re-run.

create table if not exists public.forge_trials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'cleared', 'failed')),
  strikes integer,
  misses integer,
  coins_awarded integer not null default 0 check (coins_awarded >= 0),
  finished_at timestamptz
);

create index if not exists forge_trials_user_started_idx
  on public.forge_trials (user_id, started_at desc);

alter table public.forge_trials enable row level security;

drop policy if exists "Read own forge trials" on public.forge_trials;
create policy "Read own forge trials"
  on public.forge_trials for select to authenticated
  using (auth.uid() = user_id);

revoke all on table public.forge_trials from public, anon;
grant select on table public.forge_trials to authenticated;

create or replace function public.forge_trial_schedule()
returns jsonb
language sql
stable
as $$
  select jsonb_agg(
    jsonb_build_object(
      'at', 1800 + i * 740,
      'window', 280 - i * 14
    )
    order by i
  )
  from generate_series(0, 11) as i;
$$;

revoke all on function public.forge_trial_schedule() from public, anon;
grant execute on function public.forge_trial_schedule() to authenticated;

create or replace function public._forge_score_hits(p_hits integer[])
returns jsonb
language plpgsql
stable
as $$
declare
  sched jsonb := public.forge_trial_schedule();
  n integer := jsonb_array_length(sched);
  i integer;
  beat_at integer;
  beat_win integer;
  region_start integer;
  region_end integer;
  prev_at integer;
  next_at integer;
  hit integer;
  in_region integer;
  matched integer;
  strikes integer := 0;
  misses integer := 0;
  coins integer := 0;
begin
  if p_hits is null then
    p_hits := array[]::integer[];
  end if;

  if coalesce(array_length(p_hits, 1), 0) > 40 then
    return jsonb_build_object('strikes', 0, 'misses', n, 'coins', 0);
  end if;

  for i in 0..(n - 1) loop
    beat_at := (sched -> i ->> 'at')::integer;
    beat_win := (sched -> i ->> 'window')::integer;
    if i = 0 then
      region_start := 0;
    else
      prev_at := (sched -> (i - 1) ->> 'at')::integer;
      region_start := (prev_at + beat_at) / 2;
    end if;
    if i = n - 1 then
      region_end := beat_at + beat_win;
    else
      next_at := (sched -> (i + 1) ->> 'at')::integer;
      region_end := (beat_at + next_at) / 2;
    end if;

    in_region := 0;
    matched := 0;
    foreach hit in array p_hits loop
      if hit >= region_start and hit < region_end then
        in_region := in_region + 1;
        if abs(hit - beat_at) * 2 <= beat_win then
          matched := matched + 1;
        end if;
      end if;
    end loop;

    if in_region = 1 and matched = 1 then
      strikes := strikes + 1;
    else
      misses := misses + 1;
    end if;
  end loop;

  coins := case
    when misses = 0 then 420
    when misses = 1 then 260
    when misses = 2 then 160
    else 0
  end;

  return jsonb_build_object('strikes', strikes, 'misses', misses, 'coins', coins);
end;
$$;

revoke all on function public._forge_score_hits(integer[]) from public, anon, authenticated;

create or replace function public._forge_close_stale_trials(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.forge_trials
    set status = 'failed',
        strikes = 0,
        misses = 12,
        coins_awarded = 0,
        finished_at = now()
  where user_id = p_uid
    and status = 'active'
    and started_at < now() - interval '20 seconds';
end;
$$;

revoke all on function public._forge_close_stale_trials(uuid) from public, anon, authenticated;

create or replace function public.forge_trial_status()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  window_start timestamptz := now() - interval '20 hours';
  finished_count integer := 0;
  cleared_at timestamptz;
  oldest_start timestamptz;
  attempts_left integer := 2;
  next_at timestamptz;
  last_row public.forge_trials%rowtype;
  has_last boolean := false;
begin
  if uid is null then
    raise exception 'Sign in required';
  end if;

  perform public._forge_close_stale_trials(uid);

  select
    count(*) filter (where status <> 'active'),
    max(started_at) filter (where status = 'cleared'),
    min(started_at)
  into finished_count, cleared_at, oldest_start
  from public.forge_trials
  where user_id = uid
    and started_at >= window_start;

  if cleared_at is not null then
    attempts_left := 0;
    next_at := cleared_at + interval '20 hours';
  else
    attempts_left := greatest(0, 2 - coalesce(finished_count, 0));
    if attempts_left = 0 and oldest_start is not null then
      next_at := oldest_start + interval '20 hours';
    end if;
  end if;

  select * into last_row
  from public.forge_trials
  where user_id = uid
    and status <> 'active'
  order by started_at desc
  limit 1;
  has_last := found;

  return json_build_object(
    'attempts_left', attempts_left,
    'max_attempts', 2,
    'cooldown', cleared_at is not null,
    'next_at', next_at,
    'in_progress', exists (
      select 1 from public.forge_trials
      where user_id = uid and status = 'active'
    ),
    'last', case
      when not has_last then null
      else json_build_object(
        'status', last_row.status,
        'strikes', last_row.strikes,
        'misses', last_row.misses,
        'coins', last_row.coins_awarded,
        'finished_at', last_row.finished_at
      )
    end
  );
end;
$$;

revoke all on function public.forge_trial_status() from public, anon;
grant execute on function public.forge_trial_status() to authenticated;

create or replace function public.start_forge_trial()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  window_start timestamptz := now() - interval '20 hours';
  finished_count integer := 0;
  cleared_at timestamptz;
  existing public.forge_trials%rowtype;
  created public.forge_trials%rowtype;
  has_existing boolean := false;
  attempt_no integer;
begin
  if uid is null then
    raise exception 'Sign in required';
  end if;

  perform 1 from public.profiles where id = uid for update;
  if not found then
    raise exception 'Profile missing';
  end if;

  perform public._forge_close_stale_trials(uid);

  select * into existing
  from public.forge_trials
  where user_id = uid
    and status = 'active'
  order by started_at desc
  limit 1;
  has_existing := found;

  select
    count(*) filter (where status <> 'active'),
    max(started_at) filter (where status = 'cleared')
  into finished_count, cleared_at
  from public.forge_trials
  where user_id = uid
    and started_at >= window_start;

  if cleared_at is not null then
    raise exception 'The Forge is cooling down';
  end if;

  if has_existing then
    return json_build_object(
      'trial_id', existing.id,
      'started_at', existing.started_at,
      'schedule', public.forge_trial_schedule(),
      'attempt', coalesce(finished_count, 0) + 1,
      'max_attempts', 2,
      'resumed', true
    );
  end if;

  if coalesce(finished_count, 0) >= 2 then
    raise exception 'No Forge tries left';
  end if;

  attempt_no := coalesce(finished_count, 0) + 1;

  insert into public.forge_trials (user_id)
  values (uid)
  returning * into created;

  return json_build_object(
    'trial_id', created.id,
    'started_at', created.started_at,
    'schedule', public.forge_trial_schedule(),
    'attempt', attempt_no,
    'max_attempts', 2,
    'resumed', false
  );
end;
$$;

revoke all on function public.start_forge_trial() from public, anon;
grant execute on function public.start_forge_trial() to authenticated;

create or replace function public.finish_forge_trial(p_trial_id uuid, p_hits integer[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  trial public.forge_trials%rowtype;
  sched jsonb := public.forge_trial_schedule();
  n integer := jsonb_array_length(sched);
  last_at integer;
  last_win integer;
  elapsed_ms integer;
  hit integer;
  scored jsonb;
  coins integer;
  new_balance integer;
begin
  if uid is null then
    raise exception 'Sign in required';
  end if;
  if p_trial_id is null then
    raise exception 'Missing forge trial';
  end if;

  if p_hits is not null then
    foreach hit in array p_hits loop
      if hit is null or hit < 0 or hit > 30000 then
        raise exception 'Invalid forge strike';
      end if;
    end loop;
  end if;

  select * into trial
  from public.forge_trials
  where id = p_trial_id
    and user_id = uid
  for update;

  if not found then
    raise exception 'Forge trial not found';
  end if;
  if trial.status <> 'active' then
    raise exception 'This mint is already finished';
  end if;

  last_at := (sched -> (n - 1) ->> 'at')::integer;
  last_win := (sched -> (n - 1) ->> 'window')::integer;
  elapsed_ms := floor(extract(epoch from (clock_timestamp() - trial.started_at)) * 1000)::integer;

  if elapsed_ms > 90000 then
    update public.forge_trials
      set status = 'failed',
          strikes = 0,
          misses = 12,
          coins_awarded = 0,
          finished_at = now()
    where id = trial.id;
    raise exception 'This mint expired';
  end if;

  if elapsed_ms < last_at - (last_win / 2) - 400 then
    raise exception 'The mint was submitted too early';
  end if;

  scored := public._forge_score_hits(coalesce(p_hits, array[]::integer[]));
  coins := (scored ->> 'coins')::integer;

  if coins > 0 then
    update public.profiles
      set forge_coins = least(1000000, coalesce(forge_coins, 0) + coins)
    where id = uid
    returning forge_coins into new_balance;

    update public.forge_trials
      set status = 'cleared',
          strikes = (scored ->> 'strikes')::integer,
          misses = (scored ->> 'misses')::integer,
          coins_awarded = coins,
          finished_at = now()
    where id = trial.id;
  else
    update public.forge_trials
      set status = 'failed',
          strikes = (scored ->> 'strikes')::integer,
          misses = (scored ->> 'misses')::integer,
          coins_awarded = 0,
          finished_at = now()
    where id = trial.id;

    select forge_coins into new_balance from public.profiles where id = uid;
  end if;

  return json_build_object(
    'ok', true,
    'cleared', coins > 0,
    'strikes', (scored ->> 'strikes')::integer,
    'misses', (scored ->> 'misses')::integer,
    'coins', coins,
    'forge_coins', new_balance
  );
end;
$$;

revoke all on function public.finish_forge_trial(uuid, integer[]) from public, anon;
grant execute on function public.finish_forge_trial(uuid, integer[]) to authenticated;

-- The free shop button no longer mints coins.
create or replace function public.claim_daily_forge_coins()
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  raise exception 'Forge Coins are minted in the Forge';
end;
$$;

revoke all on function public.claim_daily_forge_coins() from public, anon;
grant execute on function public.claim_daily_forge_coins() to authenticated;

-- Match wins no longer mint Forge Coins. The trigger stays so inserts still succeed.
create or replace function public.award_forge_coins_on_match_win()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return new;
end;
$$;

revoke all on function public.award_forge_coins_on_match_win() from public, anon, authenticated;

-- v4 Phase 8: AI Coach (rule-based insights from sessions + W/L)
-- Safe to re-run. No external LLM — deterministic tips from your tracked data.

create table if not exists public.coach_reports (
  user_id uuid primary key references auth.users(id) on delete cascade,
  generated_at timestamptz not null default now(),
  window_days integer not null default 7,
  summary text,
  tilt_score integer not null default 0 check (tilt_score >= 0 and tilt_score <= 100),
  insights jsonb not null default '[]'::jsonb,
  weekly jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.coach_reports enable row level security;

drop policy if exists "Users read own coach reports" on public.coach_reports;
create policy "Users read own coach reports"
  on public.coach_reports for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.generate_coach_report(p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  existing public.coach_reports;
  insights jsonb := '[]'::jsonb;
  weekly jsonb;
  tilt integer := 0;
  summary text;
  sess_count integer := 0;
  avg_ping numeric;
  avg_cpu numeric;
  avg_ram numeric;
  avg_gpu numeric;
  max_ping numeric;
  week_wins integer := 0;
  week_losses integer := 0;
  recent_results text[];
  streak_kind text := 'none';
  streak_len integer := 0;
  r text;
  i integer;
  short_sessions integer := 0;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  if not coalesce(p_force, false) then
    select * into existing from public.coach_reports where user_id = uid;
    if found and existing.generated_at > now() - interval '6 hours' then
      return jsonb_build_object(
        'user_id', uid,
        'generated_at', existing.generated_at,
        'window_days', existing.window_days,
        'summary', existing.summary,
        'tilt_score', existing.tilt_score,
        'insights', existing.insights,
        'weekly', existing.weekly,
        'cached', true
      );
    end if;
  end if;

  select
    count(*)::integer,
    avg(avg_ping_ms),
    avg(avg_cpu_pct),
    avg(avg_ram_mb),
    avg(avg_gpu_pct),
    max(max_ping_ms),
    count(*) filter (where duration_sec is not null and duration_sec < 900)::integer
  into sess_count, avg_ping, avg_cpu, avg_ram, avg_gpu, max_ping, short_sessions
  from public.game_sessions
  where user_id = uid
    and ended_at >= now() - interval '7 days';

  select
    count(*) filter (where lower(coalesce(result, '')) in ('win', 'w', 'victory'))::integer,
    count(*) filter (where lower(coalesce(result, '')) in ('loss', 'l', 'defeat'))::integer
  into week_wins, week_losses
  from public.matches
  where user_id = uid
    and played_at >= now() - interval '7 days';

  select coalesce(array_agg(lower(coalesce(result, '')) order by played_at desc), '{}')
  into recent_results
  from (
    select result, played_at
    from public.matches
    where user_id = uid
    order by played_at desc
    limit 12
  ) q;

  if array_length(recent_results, 1) is not null then
    r := recent_results[1];
    if r in ('win', 'w', 'victory') then
      streak_kind := 'win';
    elsif r in ('loss', 'l', 'defeat') then
      streak_kind := 'loss';
    end if;
    if streak_kind <> 'none' then
      streak_len := 1;
      i := 2;
      while i <= coalesce(array_length(recent_results, 1), 0) loop
        if (streak_kind = 'win' and recent_results[i] in ('win', 'w', 'victory'))
           or (streak_kind = 'loss' and recent_results[i] in ('loss', 'l', 'defeat')) then
          streak_len := streak_len + 1;
          i := i + 1;
        else
          exit;
        end if;
      end loop;
    end if;
  end if;

  -- Tilt: loss streak + high ping + short sessions
  if streak_kind = 'loss' then
    tilt := least(100, streak_len * 18);
  end if;
  if avg_ping is not null and avg_ping >= 90 then
    tilt := least(100, tilt + 12);
  end if;
  if short_sessions >= 3 then
    tilt := least(100, tilt + 10);
  end if;

  if avg_ping is not null and avg_ping >= 80 then
    insights := insights || jsonb_build_array(jsonb_build_object(
      'id', 'ping_high',
      'severity', case when avg_ping >= 120 then 'high' else 'medium' end,
      'category', 'network',
      'title', 'Ping is elevated',
      'body', format(
        'Your average ping over the last 7 days is %s ms%s. Close background downloads, use a wired connection if you can, and pick closer servers.',
        round(avg_ping)::text,
        case when max_ping is not null then format(' (peak %s ms)', round(max_ping)::text) else '' end
      )
    ));
  elsif avg_ping is not null and avg_ping < 45 and sess_count > 0 then
    insights := insights || jsonb_build_array(jsonb_build_object(
      'id', 'ping_good',
      'severity', 'low',
      'category', 'network',
      'title', 'Network looks solid',
      'body', format('Average ping is %s ms — keep this setup for ranked sessions.', round(avg_ping)::text)
    ));
  end if;

  if avg_cpu is not null and avg_cpu >= 70 then
    insights := insights || jsonb_build_array(jsonb_build_object(
      'id', 'cpu_high',
      'severity', case when avg_cpu >= 85 then 'high' else 'medium' end,
      'category', 'performance',
      'title', 'CPU running hot in-game',
      'body', format(
        'Average CPU was %s%% across recent sessions. Close overlays/browsers you do not need and lower CPU-heavy settings (shadows, crowd density).',
        round(avg_cpu)::text
      )
    ));
  end if;

  if avg_gpu is not null and avg_gpu >= 90 then
    insights := insights || jsonb_build_array(jsonb_build_object(
      'id', 'gpu_high',
      'severity', 'medium',
      'category', 'performance',
      'title', 'GPU near the ceiling',
      'body', format(
        'Average GPU load was %s%%. Cap FPS near your monitor refresh and drop one graphics preset step if frame times spike.',
        round(avg_gpu)::text
      )
    ));
  end if;

  if avg_ram is not null and avg_ram >= 12000 then
    insights := insights || jsonb_build_array(jsonb_build_object(
      'id', 'ram_high',
      'severity', 'medium',
      'category', 'performance',
      'title', 'High RAM use while playing',
      'body', format(
        'Sessions averaged ~%s MB RAM. Close Chromium-heavy apps before ranked queues to reduce stutter.',
        round(avg_ram)::text
      )
    ));
  end if;

  if streak_kind = 'loss' and streak_len >= 3 then
    insights := insights || jsonb_build_array(jsonb_build_object(
      'id', 'tilt_loss_streak',
      'severity', 'high',
      'category', 'tilt',
      'title', format('Loss streak · %s', streak_len),
      'body', 'Tilt risk is up. Take a 10–15 minute break, queue one warm-up deathmatch/custom, then come back for a single focused ranked set.'
    ));
  elsif streak_kind = 'win' and streak_len >= 3 then
    insights := insights || jsonb_build_array(jsonb_build_object(
      'id', 'win_streak',
      'severity', 'low',
      'category', 'form',
      'title', format('Win streak · %s', streak_len),
      'body', 'You are in form. Keep sessions intentional — stop after two losses in a row so the streak does not reverse into tilt.'
    ));
  end if;

  if week_wins + week_losses >= 5 and week_wins::numeric / nullif(week_wins + week_losses, 0) < 0.4 then
    insights := insights || jsonb_build_array(jsonb_build_object(
      'id', 'wr_low_week',
      'severity', 'medium',
      'category', 'form',
      'title', 'Below 40% this week',
      'body', format(
        'Record this week: %sW–%sL. Shorten queue blocks, review one VOD/death pattern, and avoid stacking late-night ranked.',
        week_wins::text, week_losses::text
      )
    ));
  end if;

  if short_sessions >= 3 then
    insights := insights || jsonb_build_array(jsonb_build_object(
      'id', 'short_sessions',
      'severity', 'low',
      'category', 'habits',
      'title', 'Many short sessions',
      'body', format(
        '%s sessions under 15 minutes this week. Prefer one longer focused block over hop-on/hop-off queues.',
        short_sessions::text
      )
    ));
  end if;

  if sess_count = 0 and week_wins + week_losses = 0 then
    insights := insights || jsonb_build_array(jsonb_build_object(
      'id', 'no_data',
      'severity', 'low',
      'category', 'habits',
      'title', 'Not enough data yet',
      'body', 'Play a tracked session or log a few W/L results — the coach builds tips from your last 7 days of activity.'
    ));
  end if;

  if jsonb_array_length(insights) = 0 then
    insights := insights || jsonb_build_array(jsonb_build_object(
      'id', 'steady',
      'severity', 'low',
      'category', 'form',
      'title', 'Steady week',
      'body', 'No major red flags in ping, hardware load, or recent form. Keep doing what you are doing.'
    ));
  end if;

  weekly := jsonb_build_object(
    'sessions', sess_count,
    'avg_ping_ms', case when avg_ping is null then null else round(avg_ping) end,
    'avg_cpu_pct', case when avg_cpu is null then null else round(avg_cpu) end,
    'avg_gpu_pct', case when avg_gpu is null then null else round(avg_gpu) end,
    'avg_ram_mb', case when avg_ram is null then null else round(avg_ram) end,
    'wins', week_wins,
    'losses', week_losses,
    'streak_kind', streak_kind,
    'streak_len', streak_len
  );

  if tilt >= 50 then
    summary := 'Tilt risk is elevated — prioritize recovery over grinding.';
  elsif avg_ping is not null and avg_ping >= 80 then
    summary := 'Network conditions are the main limiter this week.';
  elsif week_wins > week_losses and week_wins + week_losses > 0 then
    summary := 'Form is positive — protect it with short, focused sessions.';
  elsif sess_count > 0 then
    summary := 'Hardware and habits look workable — keep logging results for sharper tips.';
  else
    summary := 'Start a tracked session to unlock personalized coaching.';
  end if;

  insert into public.coach_reports as cr (
    user_id, generated_at, window_days, summary, tilt_score, insights, weekly, updated_at
  ) values (
    uid, now(), 7, summary, tilt, insights, weekly, now()
  )
  on conflict (user_id) do update set
    generated_at = excluded.generated_at,
    window_days = excluded.window_days,
    summary = excluded.summary,
    tilt_score = excluded.tilt_score,
    insights = excluded.insights,
    weekly = excluded.weekly,
    updated_at = now();

  return jsonb_build_object(
    'user_id', uid,
    'generated_at', now(),
    'window_days', 7,
    'summary', summary,
    'tilt_score', tilt,
    'insights', insights,
    'weekly', weekly,
    'cached', false
  );
end;
$$;

create or replace function public.get_my_coach_report()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return public.generate_coach_report(false);
end;
$$;

revoke all on function public.generate_coach_report(boolean) from public;
revoke all on function public.get_my_coach_report() from public;
grant execute on function public.generate_coach_report(boolean) to authenticated;
grant execute on function public.get_my_coach_report() to authenticated;

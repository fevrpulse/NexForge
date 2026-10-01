-- v164: Benchmark leaderboard. Each player keeps their best score.
-- Apply in the Supabase SQL editor. Safe to re-run.

create table if not exists public.bench_scores (
  user_id uuid primary key references auth.users(id) on delete cascade,
  overall integer not null,
  cpu integer not null default 0,
  memory integer not null default 0,
  disk integer not null default 0,
  graphics integer not null default 0,
  duration_sec integer not null,
  cpu_name text,
  gpu_name text,
  updated_at timestamptz not null default now(),
  constraint bench_scores_overall_check check (overall between 1 and 50000),
  constraint bench_scores_cpu_check check (cpu between 0 and 50000),
  constraint bench_scores_memory_check check (memory between 0 and 50000),
  constraint bench_scores_disk_check check (disk between 0 and 50000),
  constraint bench_scores_graphics_check check (graphics between 0 and 50000),
  constraint bench_scores_duration_check check (duration_sec between 45 and 720)
);

alter table public.bench_scores enable row level security;
revoke all on table public.bench_scores from public, anon, authenticated;

create or replace function public.submit_bench_score(
  p_overall integer,
  p_cpu integer,
  p_memory integer,
  p_disk integer,
  p_graphics integer,
  p_duration_sec integer,
  p_cpu_name text,
  p_gpu_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tag text;
  v_cpu text;
  v_gpu text;
  v_prev integer;
  v_rank integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_overall is null or p_overall < 1 or p_overall > 50000 then
    raise exception 'Score is out of range';
  end if;
  if p_duration_sec is null or p_duration_sec < 45 or p_duration_sec > 720 then
    raise exception 'Run the benchmark longer before posting';
  end if;
  if p_cpu is null or p_cpu < 0 or p_cpu > 50000
    or p_memory is null or p_memory < 0 or p_memory > 50000
    or p_disk is null or p_disk < 0 or p_disk > 50000
    or p_graphics is null or p_graphics < 0 or p_graphics > 50000 then
    raise exception 'Score is out of range';
  end if;

  v_cpu := nullif(left(regexp_replace(coalesce(p_cpu_name, ''), '[[:cntrl:]]', '', 'g'), 80), '');
  v_gpu := nullif(left(regexp_replace(coalesce(p_gpu_name, ''), '[[:cntrl:]]', '', 'g'), 80), '');

  select overall into v_prev from public.bench_scores where user_id = v_uid;
  if v_prev is not null and v_prev >= p_overall then
    select count(*) + 1 into v_rank
    from public.bench_scores
    where overall > v_prev;
    return jsonb_build_object('posted', false, 'best', v_prev, 'rank', v_rank);
  end if;

  insert into public.bench_scores (
    user_id, overall, cpu, memory, disk, graphics, duration_sec, cpu_name, gpu_name, updated_at
  )
  values (
    v_uid, p_overall, p_cpu, p_memory, p_disk, p_graphics, p_duration_sec, v_cpu, v_gpu, now()
  )
  on conflict (user_id) do update
    set overall = excluded.overall,
        cpu = excluded.cpu,
        memory = excluded.memory,
        disk = excluded.disk,
        graphics = excluded.graphics,
        duration_sec = excluded.duration_sec,
        cpu_name = excluded.cpu_name,
        gpu_name = excluded.gpu_name,
        updated_at = now()
    where excluded.overall > public.bench_scores.overall;

  select gamer_tag into v_tag from public.profiles where id = v_uid;
  select count(*) + 1 into v_rank from public.bench_scores where overall > p_overall;
  return jsonb_build_object(
    'posted', true,
    'best', p_overall,
    'rank', v_rank,
    'gamer_tag', v_tag
  );
end;
$$;

create or replace function public.list_bench_leaderboard(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  result jsonb;
begin
  select coalesce(jsonb_agg(item order by (item->>'overall')::int desc, item->>'updated_at' desc), '[]'::jsonb)
  into result
  from (
    select jsonb_build_object(
      'gamer_tag', coalesce(p.gamer_tag, 'Player'),
      'overall', s.overall,
      'cpu', s.cpu,
      'memory', s.memory,
      'disk', s.disk,
      'graphics', s.graphics,
      'duration_sec', s.duration_sec,
      'cpu_name', s.cpu_name,
      'gpu_name', s.gpu_name,
      'updated_at', s.updated_at
    ) as item
    from public.bench_scores s
    left join public.profiles p on p.id = s.user_id
    order by s.overall desc, s.updated_at desc
    limit v_limit
  ) ranked;
  return result;
end;
$$;

revoke all on function public.submit_bench_score(integer, integer, integer, integer, integer, integer, text, text) from public, anon;
revoke all on function public.list_bench_leaderboard(integer) from public;

grant execute on function public.submit_bench_score(integer, integer, integer, integer, integer, integer, text, text) to authenticated;
grant execute on function public.list_bench_leaderboard(integer) to anon, authenticated;

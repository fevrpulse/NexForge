-- v169: Rankings for each benchmark test. Multi core stays in bench_scores (v164),
-- so older apps keep posting there. Single core and GPU live in bench_parts.
-- Apply in the Supabase SQL editor. Safe to re-run.

create table if not exists public.bench_parts (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  pts integer not null,
  duration_sec integer not null,
  cpu_name text,
  gpu_name text,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind),
  constraint bench_parts_kind_check check (kind in ('single', 'gpu')),
  constraint bench_parts_pts_check check (pts between 1 and 50000),
  constraint bench_parts_duration_check check (duration_sec between 45 and 720)
);

create index if not exists bench_parts_kind_pts_idx on public.bench_parts (kind, pts desc);

alter table public.bench_parts enable row level security;
revoke all on table public.bench_parts from public, anon, authenticated;

create or replace function public.submit_bench_part(
  p_kind text,
  p_pts integer,
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
  v_cpu text;
  v_gpu text;
  v_prev integer;
  v_rank integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_kind is null or p_kind not in ('single', 'gpu') then
    raise exception 'Unknown benchmark test';
  end if;
  if p_pts is null or p_pts < 1 or p_pts > 50000 then
    raise exception 'Score is out of range';
  end if;
  if p_duration_sec is null or p_duration_sec < 45 or p_duration_sec > 720 then
    raise exception 'Run the benchmark longer before posting';
  end if;

  v_cpu := nullif(left(regexp_replace(coalesce(p_cpu_name, ''), '[[:cntrl:]]', '', 'g'), 80), '');
  v_gpu := nullif(left(regexp_replace(coalesce(p_gpu_name, ''), '[[:cntrl:]]', '', 'g'), 80), '');

  select pts into v_prev from public.bench_parts where user_id = v_uid and kind = p_kind;
  if v_prev is not null and v_prev >= p_pts then
    select count(*) + 1 into v_rank
    from public.bench_parts
    where kind = p_kind and pts > v_prev;
    return jsonb_build_object('posted', false, 'best', v_prev, 'rank', v_rank);
  end if;

  insert into public.bench_parts (user_id, kind, pts, duration_sec, cpu_name, gpu_name, updated_at)
  values (v_uid, p_kind, p_pts, p_duration_sec, v_cpu, v_gpu, now())
  on conflict (user_id, kind) do update
    set pts = excluded.pts,
        duration_sec = excluded.duration_sec,
        cpu_name = excluded.cpu_name,
        gpu_name = excluded.gpu_name,
        updated_at = now()
    where excluded.pts > public.bench_parts.pts;

  select count(*) + 1 into v_rank
  from public.bench_parts
  where kind = p_kind and pts > p_pts;
  return jsonb_build_object('posted', true, 'best', p_pts, 'rank', v_rank);
end;
$$;

create or replace function public.list_bench_ranking(p_kind text, p_limit integer default 20)
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
  if p_kind = 'multi' then
    select coalesce(jsonb_agg(item order by (item->>'pts')::int desc, item->>'updated_at' desc), '[]'::jsonb)
    into result
    from (
      select jsonb_build_object(
        'gamer_tag', coalesce(p.gamer_tag, 'Player'),
        'pts', s.overall,
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
  elsif p_kind in ('single', 'gpu') then
    select coalesce(jsonb_agg(item order by (item->>'pts')::int desc, item->>'updated_at' desc), '[]'::jsonb)
    into result
    from (
      select jsonb_build_object(
        'gamer_tag', coalesce(p.gamer_tag, 'Player'),
        'pts', b.pts,
        'duration_sec', b.duration_sec,
        'cpu_name', b.cpu_name,
        'gpu_name', b.gpu_name,
        'updated_at', b.updated_at
      ) as item
      from public.bench_parts b
      left join public.profiles p on p.id = b.user_id
      where b.kind = p_kind
      order by b.pts desc, b.updated_at desc
      limit v_limit
    ) ranked;
  else
    raise exception 'Unknown benchmark test';
  end if;
  return result;
end;
$$;

revoke all on function public.submit_bench_part(text, integer, integer, text, text) from public, anon;
revoke all on function public.list_bench_ranking(text, integer) from public;

grant execute on function public.submit_bench_part(text, integer, integer, text, text) to authenticated;
grant execute on function public.list_bench_ranking(text, integer) to anon, authenticated;

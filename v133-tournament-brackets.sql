-- v4 Phase 4: Tournament check-in + single-elimination brackets
-- Safe to re-run. Keeps registrations[] and register_for_tournament intact.

create table if not exists public.tournament_checkins (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

create table if not exists public.tournament_brackets (
  id bigserial primary key,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round integer not null check (round >= 1),
  match_index integer not null check (match_index >= 0),
  slot_a uuid references auth.users(id) on delete set null,
  slot_b uuid references auth.users(id) on delete set null,
  winner_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'live', 'done')),
  unique (tournament_id, round, match_index)
);

create index if not exists tournament_brackets_tid_idx
  on public.tournament_brackets (tournament_id, round, match_index);

alter table public.tournament_checkins enable row level security;
alter table public.tournament_brackets enable row level security;

drop policy if exists "Anyone can read checkins" on public.tournament_checkins;
create policy "Anyone can read checkins"
  on public.tournament_checkins for select to authenticated using (true);

drop policy if exists "Anyone can read brackets" on public.tournament_brackets;
create policy "Anyone can read brackets"
  on public.tournament_brackets for select to authenticated using (true);

create or replace function public.check_in_tournament(p_tournament_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t public.tournaments;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into t from public.tournaments where id = p_tournament_id;
  if not found then raise exception 'Tournament not found'; end if;
  if not (uid = any (coalesce(t.registrations, '{}'::uuid[]))) then
    raise exception 'Register before checking in';
  end if;
  insert into public.tournament_checkins (tournament_id, user_id)
  values (p_tournament_id, uid)
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'checked_in', true);
end;
$$;

create or replace function public.host_generate_bracket(p_tournament_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t public.tournaments;
  players uuid[];
  n integer;
  size integer;
  i integer;
  a uuid;
  b uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'Tournament not found'; end if;
  if t.host_id is distinct from uid then raise exception 'Only the host can generate a bracket'; end if;
  if exists (select 1 from public.tournament_brackets where tournament_id = p_tournament_id) then
    raise exception 'Bracket already generated';
  end if;

  select coalesce(array_agg(c.user_id order by c.checked_in_at), '{}'::uuid[])
    into players
  from public.tournament_checkins c
  where c.tournament_id = p_tournament_id;

  if coalesce(array_length(players, 1), 0) < 2 then
    -- Fallback to registrations if nobody checked in yet.
    players := coalesce(t.registrations, '{}'::uuid[]);
  end if;

  n := coalesce(array_length(players, 1), 0);
  if n < 2 then raise exception 'Need at least 2 players to generate a bracket'; end if;

  size := 2;
  while size < n loop size := size * 2; end loop;

  i := 0;
  while i < size / 2 loop
    a := players[i * 2 + 1];
    b := players[i * 2 + 2];
    if a is not null and b is null then
      insert into public.tournament_brackets (tournament_id, round, match_index, slot_a, slot_b, winner_id, status)
      values (p_tournament_id, 1, i, a, null, a, 'done');
    elsif b is not null and a is null then
      insert into public.tournament_brackets (tournament_id, round, match_index, slot_a, slot_b, winner_id, status)
      values (p_tournament_id, 1, i, null, b, b, 'done');
    else
      insert into public.tournament_brackets (tournament_id, round, match_index, slot_a, slot_b, status)
      values (
        p_tournament_id, 1, i, a, b,
        case when a is not null and b is not null then 'ready' else 'pending' end
      );
    end if;
    i := i + 1;
  end loop;

  return public.get_tournament_bracket(p_tournament_id);
end;
$$;

create or replace function public.host_report_bracket_winner(
  p_tournament_id uuid,
  p_round integer,
  p_match_index integer,
  p_winner_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t public.tournaments;
  m public.tournament_brackets;
  next_round integer;
  next_index integer;
  next_slot text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into t from public.tournaments where id = p_tournament_id;
  if not found then raise exception 'Tournament not found'; end if;
  if t.host_id is distinct from uid then raise exception 'Only the host can report results'; end if;

  select * into m from public.tournament_brackets
  where tournament_id = p_tournament_id and round = p_round and match_index = p_match_index
  for update;
  if not found then raise exception 'Match not found'; end if;
  if m.status = 'done' then raise exception 'Match already completed'; end if;
  if p_winner_id is distinct from m.slot_a and p_winner_id is distinct from m.slot_b then
    raise exception 'Winner must be one of the match players';
  end if;

  update public.tournament_brackets
    set winner_id = p_winner_id, status = 'done'
    where id = m.id;

  next_round := p_round + 1;
  next_index := p_match_index / 2;
  next_slot := case when p_match_index % 2 = 0 then 'a' else 'b' end;

  insert into public.tournament_brackets (tournament_id, round, match_index, slot_a, slot_b, status)
  values (
    p_tournament_id, next_round, next_index,
    case when next_slot = 'a' then p_winner_id else null end,
    case when next_slot = 'b' then p_winner_id else null end,
    'pending'
  )
  on conflict (tournament_id, round, match_index) do update
    set slot_a = case when next_slot = 'a' then p_winner_id else tournament_brackets.slot_a end,
        slot_b = case when next_slot = 'b' then p_winner_id else tournament_brackets.slot_b end,
        status = case
          when (
            case when next_slot = 'a' then p_winner_id else tournament_brackets.slot_a end
          ) is not null
          and (
            case when next_slot = 'b' then p_winner_id else tournament_brackets.slot_b end
          ) is not null
          then 'ready'
          else 'pending'
        end;

  -- Mark tournament completed when only one undefeated final exists with a winner.
  if not exists (
    select 1 from public.tournament_brackets
    where tournament_id = p_tournament_id and status <> 'done'
  ) and exists (
    select 1 from public.tournament_brackets
    where tournament_id = p_tournament_id and round = (
      select max(round) from public.tournament_brackets where tournament_id = p_tournament_id
    ) and winner_id is not null
  ) then
    update public.tournaments set status = 'completed' where id = p_tournament_id;
  end if;

  return public.get_tournament_bracket(p_tournament_id);
end;
$$;

create or replace function public.get_tournament_bracket(p_tournament_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  matches jsonb;
  checkins integer;
begin
  select count(*)::integer into checkins
  from public.tournament_checkins where tournament_id = p_tournament_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'round', b.round,
      'match_index', b.match_index,
      'slot_a', b.slot_a,
      'slot_b', b.slot_b,
      'winner_id', b.winner_id,
      'status', b.status,
      'tag_a', pa.gamer_tag,
      'tag_b', pb.gamer_tag,
      'winner_tag', pw.gamer_tag
    )
    order by b.round, b.match_index
  ), '[]'::jsonb)
  into matches
  from public.tournament_brackets b
  left join public.profiles pa on pa.id = b.slot_a
  left join public.profiles pb on pb.id = b.slot_b
  left join public.profiles pw on pw.id = b.winner_id
  where b.tournament_id = p_tournament_id;

  return jsonb_build_object(
    'tournament_id', p_tournament_id,
    'checkins', checkins,
    'matches', matches
  );
end;
$$;

revoke all on function public.check_in_tournament(uuid) from public;
revoke all on function public.host_generate_bracket(uuid) from public;
revoke all on function public.host_report_bracket_winner(uuid, integer, integer, uuid) from public;
revoke all on function public.get_tournament_bracket(uuid) from public;
grant execute on function public.check_in_tournament(uuid) to authenticated;
grant execute on function public.host_generate_bracket(uuid) to authenticated;
grant execute on function public.host_report_bracket_winner(uuid, integer, integer, uuid) to authenticated;
grant execute on function public.get_tournament_bracket(uuid) to authenticated;

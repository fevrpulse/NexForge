-- v161: Nobody chooses a winner — close duels without W/L; brackets only advance on concede.
-- Apply in the Supabase SQL editor. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Duels: either player can close an active duel with no winner / MMR
-- ---------------------------------------------------------------------------
create or replace function public.finish_duel(p_duel_id uuid)
returns public.duels
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.duels;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into d from public.duels where id = p_duel_id for update;
  if not found then
    raise exception 'Duel not found';
  end if;
  if d.status <> 'active' then
    raise exception 'Duel is not active';
  end if;
  if auth.uid() is distinct from d.host_id and auth.uid() is distinct from d.challenger_id then
    raise exception 'Only the two players can close this duel';
  end if;

  update public.duels
    set status = 'completed',
        winner_id = null,
        loser_id = null,
        mmr_change = 0,
        host_winner_pick = null,
        challenger_winner_pick = null,
        completed_at = now(),
        updated_at = now()
    where id = p_duel_id
    returning * into d;

  return d;
end;
$$;

revoke all on function public.finish_duel(uuid) from public, anon;
grant execute on function public.finish_duel(uuid) to authenticated;

-- Block leftover duel W/L picker (old clients / earlier SQL).
drop function if exists public.submit_duel_winner(uuid, uuid);
create or replace function public.submit_duel_winner(
  p_duel_id uuid,
  p_winner_id uuid,
  p_kills integer default null,
  p_deaths integer default null,
  p_assists integer default null
)
returns public.duels
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Nobody chooses a winner. Close the duel without a result.';
end;
$$;

revoke all on function public.submit_duel_winner(uuid, uuid, integer, integer, integer) from public, anon;
grant execute on function public.submit_duel_winner(uuid, uuid, integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Tournament match proof
-- ---------------------------------------------------------------------------
alter table public.tournament_brackets
  add column if not exists proof_method text,
  add column if not exists proof_ref text,
  add column if not exists proof_note text,
  add column if not exists reported_by uuid references auth.users(id) on delete set null,
  add column if not exists reported_at timestamptz;

do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.tournament_brackets'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%proof_method%'
  loop
    execute format('alter table public.tournament_brackets drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.tournament_brackets
  add constraint tournament_brackets_proof_method_check
    check (proof_method is null or proof_method in ('clip', 'match_id', 'concede'));

-- Nobody picks a winner. The player who lost concedes; the opponent advances.
create or replace function public.concede_bracket_match(
  p_tournament_id uuid,
  p_round integer,
  p_match_index integer,
  p_proof_ref text default null,
  p_proof_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t public.tournaments;
  m public.tournament_brackets;
  winner uuid;
  ref text := nullif(trim(coalesce(p_proof_ref, '')), '');
  note text := nullif(trim(coalesce(p_proof_note, '')), '');
  next_round integer;
  next_index integer;
  next_slot text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into t from public.tournaments where id = p_tournament_id;
  if not found then raise exception 'Tournament not found'; end if;

  select * into m from public.tournament_brackets
  where tournament_id = p_tournament_id and round = p_round and match_index = p_match_index
  for update;
  if not found then raise exception 'Match not found'; end if;
  if m.status = 'done' then raise exception 'Match already completed'; end if;
  if uid is distinct from m.slot_a and uid is distinct from m.slot_b then
    raise exception 'Only a player in this match can concede';
  end if;

  winner := case when uid is not distinct from m.slot_a then m.slot_b else m.slot_a end;
  if winner is null then raise exception 'No opponent to advance'; end if;

  if note is not null and char_length(note) > 240 then
    note := left(note, 240);
  end if;
  if ref is not null and char_length(ref) > 240 then
    ref := left(ref, 240);
  end if;

  update public.tournament_brackets
    set winner_id = winner,
        status = 'done',
        proof_method = 'concede',
        proof_ref = ref,
        proof_note = note,
        reported_by = uid,
        reported_at = now()
    where id = m.id;

  if not exists (
    select 1 from public.tournament_brackets
    where tournament_id = p_tournament_id and status <> 'done'
  ) then
    update public.tournaments
      set status = 'completed',
          winner_id = winner,
          payout_status = case
            when prize_type in ('cash', 'both') and coalesce(prize_funded, false)
              then 'pending'
            else payout_status
          end
      where id = p_tournament_id;
  else
    next_round := p_round + 1;
    next_index := p_match_index / 2;
    next_slot := case when p_match_index % 2 = 0 then 'a' else 'b' end;

    insert into public.tournament_brackets (tournament_id, round, match_index, slot_a, slot_b, status)
    values (
      p_tournament_id, next_round, next_index,
      case when next_slot = 'a' then winner else null end,
      case when next_slot = 'b' then winner else null end,
      'pending'
    )
    on conflict (tournament_id, round, match_index) do update
      set slot_a = case when next_slot = 'a' then winner else tournament_brackets.slot_a end,
          slot_b = case when next_slot = 'b' then winner else tournament_brackets.slot_b end,
          status = case
            when (
              case when next_slot = 'a' then winner else tournament_brackets.slot_a end
            ) is not null
            and (
              case when next_slot = 'b' then winner else tournament_brackets.slot_b end
            ) is not null
            then 'ready'
            else 'pending'
          end;
  end if;

  return public.get_tournament_bracket(p_tournament_id);
end;
$$;

create or replace function public.report_bracket_winner_proof(
  p_tournament_id uuid,
  p_round integer,
  p_match_index integer,
  p_winner_id uuid,
  p_proof_method text,
  p_proof_ref text default null,
  p_proof_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Nobody chooses a winner. The player who lost must concede.';
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
begin
  raise exception 'Nobody chooses a winner. The player who lost must concede.';
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
      'winner_tag', pw.gamer_tag,
      'proof_method', b.proof_method,
      'proof_ref', b.proof_ref,
      'proof_note', b.proof_note
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

revoke all on function public.concede_bracket_match(uuid, integer, integer, text, text) from public, anon;
grant execute on function public.concede_bracket_match(uuid, integer, integer, text, text) to authenticated;
revoke all on function public.report_bracket_winner_proof(uuid, integer, integer, uuid, text, text, text) from public, anon;
grant execute on function public.report_bracket_winner_proof(uuid, integer, integer, uuid, text, text, text) to authenticated;
revoke all on function public.host_report_bracket_winner(uuid, integer, integer, uuid) from public, anon;
grant execute on function public.host_report_bracket_winner(uuid, integer, integer, uuid) to authenticated;
revoke all on function public.get_tournament_bracket(uuid) from public, anon;
grant execute on function public.get_tournament_bracket(uuid) to authenticated;

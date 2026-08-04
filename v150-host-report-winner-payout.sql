-- Fix final-match completion (do not spawn a phantom next round),
-- record winner_id, and mark cash payout pending when escrowed.
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

  -- If this was the last unfinished match, complete the tournament.
  if not exists (
    select 1 from public.tournament_brackets
    where tournament_id = p_tournament_id and status <> 'done'
  ) then
    update public.tournaments
      set status = 'completed',
          winner_id = p_winner_id,
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
  end if;

  return public.get_tournament_bracket(p_tournament_id);
end;
$$;

revoke all on function public.host_report_bracket_winner(uuid, integer, integer, uuid) from public, anon;
grant execute on function public.host_report_bracket_winner(uuid, integer, integer, uuid) to authenticated;

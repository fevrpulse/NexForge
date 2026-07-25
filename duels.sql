-- Additive: public duel queues + mutual result reporting
-- Paste into Supabase SQL editor

create extension if not exists pgcrypto;

create table if not exists public.duels (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  host_tag text not null,
  host_mmr integer not null default 1200,
  challenger_id uuid references auth.users(id) on delete set null,
  challenger_tag text,
  challenger_mmr integer,
  game text not null,
  mode text,
  details text,
  server text,
  status text not null default 'open'
    check (status in ('open', 'active', 'completed', 'cancelled')),
  host_winner_pick uuid,
  challenger_winner_pick uuid,
  winner_id uuid,
  loser_id uuid,
  mmr_change integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists duels_status_created_idx
  on public.duels (status, created_at desc);

create index if not exists duels_host_id_idx on public.duels (host_id);
create index if not exists duels_challenger_id_idx on public.duels (challenger_id);

alter table public.duels enable row level security;

drop policy if exists "Anyone can view duels" on public.duels;
create policy "Anyone can view duels"
  on public.duels for select
  using (true);

drop policy if exists "Users can create open duels" on public.duels;
create policy "Users can create open duels"
  on public.duels for insert
  to authenticated
  with check (auth.uid() = host_id and status = 'open');

drop policy if exists "Hosts can cancel own open duels" on public.duels;
create policy "Hosts can cancel own open duels"
  on public.duels for update
  to authenticated
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id);

-- Accept an open queue (sets challenger, status active)
create or replace function public.accept_duel(p_duel_id uuid)
returns public.duels
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.duels;
  my_tag text;
  my_mmr integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select gamer_tag, mmr into my_tag, my_mmr
  from public.profiles where id = auth.uid();

  if my_tag is null then
    raise exception 'Profile required';
  end if;

  select * into d from public.duels where id = p_duel_id for update;
  if not found then
    raise exception 'Queue not found';
  end if;
  if d.status <> 'open' then
    raise exception 'Queue is no longer open';
  end if;
  if d.host_id = auth.uid() then
    raise exception 'Cannot accept your own queue';
  end if;

  update public.duels
    set challenger_id = auth.uid(),
        challenger_tag = my_tag,
        challenger_mmr = coalesce(my_mmr, 1200),
        status = 'active',
        updated_at = now()
    where id = p_duel_id
    returning * into d;

  return d;
end;
$$;

-- Host cancels an open queue
create or replace function public.cancel_duel(p_duel_id uuid)
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
    raise exception 'Queue not found';
  end if;
  if d.host_id <> auth.uid() then
    raise exception 'Only the host can cancel';
  end if;
  if d.status <> 'open' then
    raise exception 'Only open queues can be cancelled';
  end if;

  update public.duels
    set status = 'cancelled', updated_at = now()
    where id = p_duel_id
    returning * into d;

  return d;
end;
$$;

-- Participants submit who won. When both agree, MMR + match history are written.
create or replace function public.submit_duel_winner(p_duel_id uuid, p_winner_id uuid)
returns public.duels
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.duels;
  other_pick uuid;
  agreed_winner uuid;
  agreed_loser uuid;
  change integer := 15;
  host_new integer;
  chal_new integer;
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
  if auth.uid() <> d.host_id and auth.uid() <> d.challenger_id then
    raise exception 'Only duel participants can report results';
  end if;
  if p_winner_id is distinct from d.host_id and p_winner_id is distinct from d.challenger_id then
    raise exception 'Winner must be one of the duel players';
  end if;

  if auth.uid() = d.host_id then
    update public.duels
      set host_winner_pick = p_winner_id, updated_at = now()
      where id = p_duel_id
      returning * into d;
    other_pick := d.challenger_winner_pick;
  else
    update public.duels
      set challenger_winner_pick = p_winner_id, updated_at = now()
      where id = p_duel_id
      returning * into d;
    other_pick := d.host_winner_pick;
  end if;

  -- Waiting on the other player
  if other_pick is null then
    return d;
  end if;

  -- Disagreement: clear picks so both re-select (do not RAISE — that would roll back the clear)
  if other_pick is distinct from p_winner_id then
    update public.duels
      set host_winner_pick = null,
          challenger_winner_pick = null,
          updated_at = now()
      where id = p_duel_id
      returning * into d;
    return d;
  end if;

  agreed_winner := p_winner_id;
  if agreed_winner = d.host_id then
    agreed_loser := d.challenger_id;
  else
    agreed_loser := d.host_id;
  end if;

  host_new := greatest(800, d.host_mmr + case when agreed_winner = d.host_id then change else -change end);
  chal_new := greatest(800, coalesce(d.challenger_mmr, 1200) + case when agreed_winner = d.challenger_id then change else -change end);

  insert into public.matches (user_id, game, mode, result, mmr_change, stats, duration, played_at)
  values
    (
      d.host_id, d.game, d.mode,
      case when agreed_winner = d.host_id then 'win' else 'loss' end,
      case when agreed_winner = d.host_id then change else -change end,
      jsonb_build_object(
        'duel_id', d.id,
        'opponent', d.challenger_tag,
        'server', d.server,
        'queue_details', d.details
      ),
      null,
      now()
    ),
    (
      d.challenger_id, d.game, d.mode,
      case when agreed_winner = d.challenger_id then 'win' else 'loss' end,
      case when agreed_winner = d.challenger_id then change else -change end,
      jsonb_build_object(
        'duel_id', d.id,
        'opponent', d.host_tag,
        'server', d.server,
        'queue_details', d.details
      ),
      null,
      now()
    );

  update public.profiles
    set mmr = host_new,
        wins = wins + case when agreed_winner = d.host_id then 1 else 0 end,
        losses = losses + case when agreed_winner = d.host_id then 0 else 1 end
    where id = d.host_id;

  update public.profiles
    set mmr = chal_new,
        wins = wins + case when agreed_winner = d.challenger_id then 1 else 0 end,
        losses = losses + case when agreed_winner = d.challenger_id then 0 else 1 end
    where id = d.challenger_id;

  update public.duels
    set status = 'completed',
        winner_id = agreed_winner,
        loser_id = agreed_loser,
        mmr_change = change,
        completed_at = now(),
        updated_at = now()
    where id = p_duel_id
    returning * into d;

  return d;
end;
$$;

grant execute on function public.accept_duel(uuid) to authenticated;
grant execute on function public.cancel_duel(uuid) to authenticated;
grant execute on function public.submit_duel_winner(uuid, uuid) to authenticated;

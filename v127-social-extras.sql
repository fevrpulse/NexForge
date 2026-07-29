-- v1.2.7 social extras: custom status, friend pins, typing, friend activity feed
-- Safe to re-run. Apply after presence-reactions-delete.sql.

-- ── CUSTOM STATUS ──
alter table public.profiles add column if not exists custom_status text;
alter table public.profiles drop constraint if exists profiles_custom_status_check;
alter table public.profiles
  add constraint profiles_custom_status_check
  check (custom_status is null or char_length(custom_status) <= 60);

grant update (custom_status) on table public.profiles to authenticated;

-- ── FRIEND PINS ──
create table if not exists public.friend_pins (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

alter table public.friend_pins enable row level security;

drop policy if exists "Users can view own pins" on public.friend_pins;
create policy "Users can view own pins"
  on public.friend_pins for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can pin accepted friends" on public.friend_pins;
create policy "Users can pin accepted friends"
  on public.friend_pins for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = friend_id)
          or (f.addressee_id = auth.uid() and f.requester_id = friend_id)
        )
    )
  );

drop policy if exists "Users can unpin own pins" on public.friend_pins;
create policy "Users can unpin own pins"
  on public.friend_pins for delete
  to authenticated
  using (auth.uid() = user_id);

-- ── TYPING SIGNALS ──
create table if not exists public.typing_signals (
  user_id uuid not null references auth.users(id) on delete cascade,
  peer_id uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (user_id, peer_id),
  check (user_id <> peer_id)
);

alter table public.typing_signals enable row level security;

drop policy if exists "Peers can view typing toward them" on public.typing_signals;
create policy "Peers can view typing toward them"
  on public.typing_signals for select
  to authenticated
  using (auth.uid() = peer_id);

drop policy if exists "Users can upsert own typing" on public.typing_signals;
create policy "Users can upsert own typing"
  on public.typing_signals for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can refresh own typing" on public.typing_signals;
create policy "Users can refresh own typing"
  on public.typing_signals for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can clear own typing" on public.typing_signals;
create policy "Users can clear own typing"
  on public.typing_signals for delete
  to authenticated
  using (auth.uid() = user_id);

-- ── FRIEND ACTIVITY FEED ──
-- Returns recent match results from accepted friends only (no raw stats payload).
create or replace function public.friend_activity_feed(p_limit integer default 12)
returns table (
  match_id bigint,
  friend_id uuid,
  gamer_tag text,
  game text,
  mode text,
  result text,
  mmr_change integer,
  played_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id as match_id,
    m.user_id as friend_id,
    p.gamer_tag,
    m.game,
    m.mode,
    m.result,
    m.mmr_change,
    m.played_at
  from public.matches m
  join public.profiles p on p.id = m.user_id
  where m.user_id in (
    select case
      when f.requester_id = auth.uid() then f.addressee_id
      else f.requester_id
    end
    from public.friendships f
    where f.status = 'accepted'
      and auth.uid() in (f.requester_id, f.addressee_id)
  )
  order by m.played_at desc
  limit greatest(1, least(coalesce(p_limit, 12), 30));
$$;

revoke all on function public.friend_activity_feed(integer) from public;
grant execute on function public.friend_activity_feed(integer) to authenticated;

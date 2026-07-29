-- v1.2.8: blocks, reports, match-history privacy, richer friend profiles
-- Safe to re-run. Apply after friend-profile.sql.

-- ── PRIVACY ──
alter table public.profiles add column if not exists hide_match_history boolean not null default false;
grant update (hide_match_history) on table public.profiles to authenticated;

-- ── BLOCKS ──
create table if not exists public.player_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.player_blocks enable row level security;

drop policy if exists "Users can view own blocks" on public.player_blocks;
create policy "Users can view own blocks"
  on public.player_blocks for select
  to authenticated
  using (auth.uid() = blocker_id);

drop policy if exists "Users can block others" on public.player_blocks;
create policy "Users can block others"
  on public.player_blocks for insert
  to authenticated
  with check (auth.uid() = blocker_id);

drop policy if exists "Users can unblock" on public.player_blocks;
create policy "Users can unblock"
  on public.player_blocks for delete
  to authenticated
  using (auth.uid() = blocker_id);

-- ── REPORTS ──
create table if not exists public.player_reports (
  id bigserial primary key,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 400),
  created_at timestamptz not null default now(),
  check (reporter_id <> reported_id)
);

alter table public.player_reports enable row level security;

drop policy if exists "Users can file reports" on public.player_reports;
create policy "Users can file reports"
  on public.player_reports for insert
  to authenticated
  with check (auth.uid() = reporter_id);

drop policy if exists "Users can view own reports" on public.player_reports;
create policy "Users can view own reports"
  on public.player_reports for select
  to authenticated
  using (auth.uid() = reporter_id);

-- Blocked players cannot message each other (either direction).
drop policy if exists "Friends can send messages" on public.messages;
create policy "Friends can send messages"
  on public.messages for insert
  to authenticated
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = sender_id and f.addressee_id = recipient_id)
          or (f.requester_id = recipient_id and f.addressee_id = sender_id))
    )
    and not exists (
      select 1 from public.player_blocks b
      where (b.blocker_id = sender_id and b.blocked_id = recipient_id)
         or (b.blocker_id = recipient_id and b.blocked_id = sender_id)
    )
  );

-- Blocked players cannot send new friend requests either direction.
drop policy if exists "Users can send friend requests" on public.friendships;
create policy "Users can send friend requests"
  on public.friendships for insert
  to authenticated
  with check (
    auth.uid() = requester_id
    and status = 'pending'
    and not exists (
      select 1 from public.player_blocks b
      where (b.blocker_id = requester_id and b.blocked_id = addressee_id)
         or (b.blocker_id = addressee_id and b.blocked_id = requester_id)
    )
  );

-- Richer friend profile: privacy-aware history, shared duels, badges.
create or replace function public.get_friend_profile(p_friend_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ok boolean := false;
  hide_hist boolean := false;
  out_json json;
  wins_n int := 0;
  losses_n int := 0;
  kills_n int := 0;
  mmr_n int := 1200;
  duel_wins_n int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_friend_id = auth.uid() then
    ok := true;
  else
    select exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = p_friend_id)
          or (f.addressee_id = auth.uid() and f.requester_id = p_friend_id)
        )
    ) into ok;
  end if;

  if not ok then
    raise exception 'Not friends with this player';
  end if;

  select coalesce(p.hide_match_history, false),
         coalesce(p.wins, 0), coalesce(p.losses, 0),
         coalesce(p.total_kills, 0), coalesce(p.mmr, 1200)
    into hide_hist, wins_n, losses_n, kills_n, mmr_n
  from public.profiles p
  where p.id = p_friend_id;

  select count(*)::int into duel_wins_n
  from public.duels d
  where d.status = 'completed'
    and d.winner_id = p_friend_id;

  select json_build_object(
    'profile', (
      select json_build_object(
        'id', p.id,
        'gamer_tag', p.gamer_tag,
        'mmr', p.mmr,
        'wins', p.wins,
        'losses', p.losses,
        'platform', p.platform,
        'main_game', p.main_game,
        'main_game_description', p.main_game_description,
        'custom_status', p.custom_status,
        'playing_game', p.playing_game,
        'last_seen_at', p.last_seen_at,
        'total_kills', p.total_kills,
        'total_deaths', p.total_deaths,
        'total_assists', p.total_assists,
        'created_at', p.created_at,
        'hide_match_history', coalesce(p.hide_match_history, false)
      )
      from public.profiles p
      where p.id = p_friend_id
    ),
    'matches', case when hide_hist then '[]'::json else (
      select coalesce(json_agg(row_to_json(m)), '[]'::json)
      from (
        select id, game, mode, result, mmr_change, played_at
        from public.matches
        where user_id = p_friend_id
        order by played_at desc nulls last
        limit 12
      ) m
    ) end,
    'sessions', case when hide_hist then '[]'::json else (
      select coalesce(json_agg(row_to_json(s)), '[]'::json)
      from (
        select id, game, duration_sec, ended_at,
               avg_ping_ms, avg_ram_mb, avg_cpu_pct, avg_gpu_pct,
               kills, deaths, assists
        from public.game_sessions
        where user_id = p_friend_id
        order by ended_at desc nulls last
        limit 8
      ) s
    ) end,
    'history_hidden', hide_hist,
    'duels', (
      select coalesce(json_agg(row_to_json(d)), '[]'::json)
      from (
        select id, game, mode, status, winner_id,
               host_id, challenger_id, host_tag, challenger_tag,
               host_mmr, challenger_mmr, created_at
        from public.duels
        where status = 'completed'
          and (
            (host_id = auth.uid() and challenger_id = p_friend_id)
            or (host_id = p_friend_id and challenger_id = auth.uid())
          )
        order by created_at desc nulls last
        limit 10
      ) d
    ),
    'badges', (
      select coalesce(json_agg(json_build_object('id', b.id, 'label', b.label, 'desc', b.descrip)), '[]'::json)
      from (
        select * from (
          values
            ('first_win', 'First Blood', 'Won at least 1 match', (wins_n >= 1)),
            ('ten_wins', 'Contender', 'Won 10 matches', (wins_n >= 10)),
            ('fifty_wins', 'Veteran', 'Won 50 matches', (wins_n >= 50)),
            ('sharpshooter', 'Sharpshooter', '100+ career kills', (kills_n >= 100)),
            ('grinder', 'Grinder', '25+ career matches', ((wins_n + losses_n) >= 25)),
            ('rising', 'Rising Star', 'MMR 1400+', (mmr_n >= 1400)),
            ('elite', 'Elite', 'MMR 2200+', (mmr_n >= 2200)),
            ('duelist', 'Duelist', 'Won a completed duel', (duel_wins_n >= 1))
        ) as t(id, label, descrip, earned)
        where earned
      ) b
    )
  ) into out_json;

  return out_json;
end;
$$;

revoke all on function public.get_friend_profile(uuid) from public;
grant execute on function public.get_friend_profile(uuid) to authenticated;

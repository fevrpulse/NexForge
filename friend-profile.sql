-- Friend profile view: accepted friends can see career stats + recent matches/sessions
-- Safe to re-run.

create or replace function public.get_friend_profile(p_friend_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ok boolean := false;
  out_json json;
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
        'created_at', p.created_at
      )
      from public.profiles p
      where p.id = p_friend_id
    ),
    'matches', (
      select coalesce(json_agg(row_to_json(m)), '[]'::json)
      from (
        select id, game, mode, result, mmr_change, played_at, source
        from public.matches
        where user_id = p_friend_id
        order by played_at desc nulls last
        limit 12
      ) m
    ),
    'sessions', (
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
    )
  ) into out_json;

  return out_json;
end;
$$;

revoke all on function public.get_friend_profile(uuid) from public;
grant execute on function public.get_friend_profile(uuid) to authenticated;

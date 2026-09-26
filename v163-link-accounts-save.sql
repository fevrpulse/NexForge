-- v163: Saving a linked account stores it on the profile and shows it to friends.
-- Apply in the Supabase SQL editor. Safe to re-run.
-- Requires public.stat_links (v137-verified-stats.sql).

do $$
declare r record;
begin
  if to_regclass('public.stat_links') is null then
    raise exception 'public.stat_links is missing — apply v137-verified-stats.sql first';
  end if;

  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.stat_links'::regclass
      and c.contype = 'c'
      and (
        pg_get_constraintdef(c.oid) ilike '%provider%'
        or pg_get_constraintdef(c.oid) ilike '%link_method%'
      )
  loop
    execute format('alter table public.stat_links drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.stat_links
  add column if not exists external_id text,
  add column if not exists avatar_url text,
  add column if not exists link_method text,
  add column if not exists meta jsonb;

update public.stat_links
set link_method = coalesce(nullif(link_method, ''), 'handle')
where link_method is null or link_method = '';

update public.stat_links
set meta = '{}'::jsonb
where meta is null;

alter table public.stat_links
  alter column link_method set default 'handle',
  alter column meta set default '{}'::jsonb;

alter table public.stat_links
  alter column link_method set not null,
  alter column meta set not null;

alter table public.stat_links
  add constraint stat_links_provider_check
    check (provider in ('discord', 'steam', 'riot', 'epic', 'tracker')),
  add constraint stat_links_link_method_check
    check (link_method in ('oauth', 'openid', 'handle', 'proof'));

drop index if exists public.stat_links_verified_handle_uidx;

create or replace function public.link_stat_account(p_provider text, p_handle text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  h text;
  prov text := lower(trim(coalesce(p_provider, '')));
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if prov not in ('discord', 'steam', 'riot', 'epic', 'tracker') then
    raise exception 'Provider must be discord, steam, riot, epic, or tracker';
  end if;

  h := nullif(trim(coalesce(p_handle, '')), '');
  if h is null then raise exception 'Handle required'; end if;
  if char_length(h) < 2 or char_length(h) > 64 then
    raise exception 'Handle must be 2–64 characters';
  end if;

  if prov = 'riot' and position('#' in h) = 0 then
    raise exception 'Riot ID must look like Name#TAG';
  end if;
  if prov = 'steam' and h !~ '^[0-9]{17}$' and position('steamcommunity.com' in lower(h)) = 0
     and lower(h) !~ '^[a-z0-9_-]{3,32}$' then
    raise exception 'Enter a SteamID64 (17 digits) or Steam vanity name';
  end if;
  if prov = 'discord' and h ~ 'discord\.gg/|https?://' then
    raise exception 'Enter your Discord username, not an invite link';
  end if;

  if exists (
    select 1 from public.stat_links sl
    where sl.provider = prov
      and sl.status = 'verified'
      and lower(sl.handle) = lower(h)
      and sl.user_id <> uid
  ) then
    raise exception 'That % account is already linked to another NexForge user', prov;
  end if;

  insert into public.stat_links as sl (
    user_id, provider, handle, status, verify_code, verified_at, last_synced_at,
    snapshot, link_method, external_id, avatar_url, meta, updated_at
  ) values (
    uid, prov, h, 'verified', null, now(), null,
    '{}'::jsonb, 'handle', null, null, '{}'::jsonb, now()
  )
  on conflict (user_id, provider) do update set
    handle = excluded.handle,
    status = 'verified',
    verify_code = null,
    verified_at = now(),
    last_synced_at = null,
    snapshot = '{}'::jsonb,
    link_method = 'handle',
    external_id = null,
    avatar_url = null,
    meta = '{}'::jsonb,
    updated_at = now();

  return public.get_my_stat_links();
end;
$$;

revoke all on function public.link_stat_account(text, text) from public, anon;
grant execute on function public.link_stat_account(text, text) to authenticated;

-- Friend profiles already list verified discord / steam / riot / epic links.
-- Include tracker labels in that same list.
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
        'display_name', p.display_name,
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
        'hide_match_history', coalesce(p.hide_match_history, false),
        'avatar_path', p.avatar_path,
        'avatar_preset', p.avatar_preset,
        'equipped_frame', p.equipped_frame,
        'equipped_banner', p.equipped_banner,
        'equipped_nameplate', p.equipped_nameplate,
        'clan_tag', p.clan_tag
      )
      from public.profiles p
      where p.id = p_friend_id
    ),
    'matches', case when hide_hist then '[]'::json else (
      select coalesce(json_agg(row_to_json(m)), '[]'::json)
      from (
        select id, game, mode, result, mmr_change, played_at, source
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
    'linked_accounts', (
      select coalesce(json_agg(json_build_object(
        'provider', l.provider,
        'handle', l.handle,
        'status', l.status,
        'avatar_url', l.avatar_url,
        'link_method', l.link_method
      ) order by l.provider), '[]'::json)
      from public.stat_links l
      where l.user_id = p_friend_id
        and l.status = 'verified'
        and l.provider in ('discord', 'steam', 'riot', 'epic', 'tracker')
    ),
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

revoke all on function public.get_friend_profile(uuid) from public, anon;
grant execute on function public.get_friend_profile(uuid) to authenticated;

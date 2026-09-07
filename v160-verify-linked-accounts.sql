-- v160: Real account verification + persist linked identities.
-- Handle-only "set your NexForge status to this code" is not proof of ownership
-- of Discord / Steam / Riot / Epic. After this:
--   * Steam can be proven by OpenID login, or a one-time code in public Steam About
--   * Discord / Riot / Epic stay verified only through OAuth
--   * Tracker remains a label (no external identity)
--   * Verified links are stored on stat_links and shown on friend profiles
-- Safe to re-run. Apply in the Supabase SQL editor, then deploy:
--   npx supabase functions deploy link-account-start --project-ref nfaxokwpmaxyhnvatrwf
--   npx supabase functions deploy verify-account-link --project-ref nfaxokwpmaxyhnvatrwf
--   npx supabase functions deploy link-account-callback --project-ref nfaxokwpmaxyhnvatrwf --no-verify-jwt

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- 1) Columns + constraints (works after v137 or v158)
-- ---------------------------------------------------------------------------
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

create unique index if not exists stat_links_provider_external_uidx
  on public.stat_links (provider, external_id)
  where external_id is not null;

-- Steam personas / Discord display names are not unique. Identity is external_id.
drop index if exists public.stat_links_verified_handle_uidx;

-- ---------------------------------------------------------------------------
-- 2) One-time OAuth / OpenID state (service_role only)
-- ---------------------------------------------------------------------------
create table if not exists private.link_oauth_states (
  nonce text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists link_oauth_states_user_idx
  on private.link_oauth_states (user_id);

revoke all on table private.link_oauth_states from public, anon, authenticated;
grant all on table private.link_oauth_states to service_role;

create or replace function public._internal_create_link_state(
  p_user_id uuid,
  p_provider text,
  p_nonce text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = private, public
as $$
begin
  delete from private.link_oauth_states where expires_at < now();
  insert into private.link_oauth_states (nonce, user_id, provider, expires_at)
  values (p_nonce, p_user_id, lower(trim(p_provider)), p_expires_at);
end;
$$;

create or replace function public._internal_take_link_state(p_nonce text)
returns table(user_id uuid, provider text)
language plpgsql
security definer
set search_path = private, public
as $$
declare
  row private.link_oauth_states;
begin
  delete from private.link_oauth_states where expires_at < now();
  delete from private.link_oauth_states
  where nonce = p_nonce
  returning * into row;
  if not found then
    return;
  end if;
  user_id := row.user_id;
  provider := row.provider;
  return next;
end;
$$;

revoke all on function public._internal_create_link_state(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public._internal_take_link_state(text) from public, anon, authenticated;
grant execute on function public._internal_create_link_state(uuid, text, text, timestamptz) to service_role;
grant execute on function public._internal_take_link_state(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Service-role completion after OAuth / OpenID / Steam profile proof
-- ---------------------------------------------------------------------------
create or replace function public._internal_complete_oauth_link(
  p_user_id uuid,
  p_provider text,
  p_external_id text,
  p_handle text,
  p_avatar_url text,
  p_link_method text,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prov text := lower(trim(coalesce(p_provider, '')));
  ext text := nullif(trim(coalesce(p_external_id, '')), '');
  h text := nullif(trim(coalesce(p_handle, '')), '');
  method text := lower(trim(coalesce(p_link_method, 'oauth')));
  owner uuid;
begin
  if p_user_id is null then raise exception 'user required'; end if;
  if prov not in ('discord', 'steam', 'riot', 'epic') then
    raise exception 'Unsupported provider';
  end if;
  if ext is null then raise exception 'external id required'; end if;
  if h is null then h := ext; end if;
  if method not in ('oauth', 'openid', 'handle', 'proof') then method := 'oauth'; end if;

  select user_id into owner
  from public.stat_links
  where provider = prov and external_id = ext
  limit 1;

  if owner is not null and owner <> p_user_id then
    raise exception 'This % account is already linked to another NexForge user', prov;
  end if;

  insert into public.stat_links as sl (
    user_id, provider, handle, status, verify_code, verified_at,
    last_synced_at, snapshot, link_method, external_id, avatar_url, meta, updated_at
  ) values (
    p_user_id, prov, left(h, 64), 'verified', null, now(),
    null, '{}'::jsonb, method, ext, nullif(trim(coalesce(p_avatar_url, '')), ''),
    coalesce(p_meta, '{}'::jsonb), now()
  )
  on conflict (user_id, provider) do update set
    handle = excluded.handle,
    status = 'verified',
    verify_code = null,
    verified_at = now(),
    link_method = excluded.link_method,
    external_id = excluded.external_id,
    avatar_url = excluded.avatar_url,
    meta = excluded.meta,
    updated_at = now();

  return jsonb_build_object('ok', true, 'provider', prov, 'handle', left(h, 64));
exception
  when unique_violation then
    raise exception 'This % account is already linked to another NexForge user', prov;
end;
$$;

revoke all on function public._internal_complete_oauth_link(uuid, text, text, text, text, text, jsonb) from public;
revoke all on function public._internal_complete_oauth_link(uuid, text, text, text, text, text, jsonb) from anon, authenticated;
grant execute on function public._internal_complete_oauth_link(uuid, text, text, text, text, text, jsonb) to service_role;

-- Authenticated helper used by the verify edge function to read the pending code.
create or replace function public.get_pending_stat_link(p_provider text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  prov text := lower(trim(coalesce(p_provider, '')));
  link public.stat_links;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into link
  from public.stat_links
  where user_id = uid and provider = prov and status = 'pending';
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'provider', link.provider,
    'handle', link.handle,
    'verify_code', link.verify_code
  );
end;
$$;

revoke all on function public.get_pending_stat_link(text) from public;
grant execute on function public.get_pending_stat_link(text) to authenticated;

create or replace function public.get_my_stat_links()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  links jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'provider', l.provider,
      'handle', l.handle,
      'status', l.status,
      'verify_code', l.verify_code,
      'verified_at', l.verified_at,
      'last_synced_at', l.last_synced_at,
      'snapshot', l.snapshot,
      'external_id', l.external_id,
      'avatar_url', l.avatar_url,
      'link_method', l.link_method
    ) order by l.provider
  ), '[]'::jsonb)
  into links
  from public.stat_links l
  where l.user_id = uid and l.status in ('pending', 'verified');

  return jsonb_build_object('links', links);
end;
$$;

-- Tracker is a label, not an external identity — linking it is enough.
-- Steam / Discord / Riot / Epic stay pending until live proof or OAuth.
create or replace function public.link_stat_account(p_provider text, p_handle text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  h text;
  code text;
  prov text := lower(trim(coalesce(p_provider, '')));
  is_tracker boolean;
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

  -- Steam display names collide; uniqueness is the SteamID after proof.
  if prov <> 'steam' and exists (
    select 1 from public.stat_links sl
    where sl.provider = prov
      and sl.status = 'verified'
      and lower(sl.handle) = lower(h)
      and sl.user_id <> uid
  ) then
    raise exception 'That % account is already linked to another NexForge user', prov;
  end if;

  is_tracker := (prov = 'tracker');
  code := case when is_tracker then null
               else 'NF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
          end;

  insert into public.stat_links as sl (
    user_id, provider, handle, status, verify_code, verified_at, last_synced_at,
    snapshot, link_method, external_id, avatar_url, meta, updated_at
  ) values (
    uid, prov, h,
    case when is_tracker then 'verified' else 'pending' end,
    code,
    case when is_tracker then now() else null end,
    null,
    '{}'::jsonb, 'handle', null, null, '{}'::jsonb, now()
  )
  on conflict (user_id, provider) do update set
    handle = excluded.handle,
    status = excluded.status,
    verify_code = excluded.verify_code,
    verified_at = excluded.verified_at,
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

-- Old self-confirm (NexForge custom_status) is gone. It never proved the
-- player owned the external account.
create or replace function public.confirm_stat_link(p_provider text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prov text := lower(trim(coalesce(p_provider, '')));
  link public.stat_links;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into link from public.stat_links
  where user_id = uid and provider = prov;
  if not found then raise exception 'Link this account first'; end if;
  if link.status = 'verified' then
    return public.get_my_stat_links();
  end if;
  if prov = 'tracker' then
    update public.stat_links
      set status = 'verified', verified_at = now(), verify_code = null, updated_at = now()
    where user_id = uid and provider = prov;
    return public.get_my_stat_links();
  end if;
  if prov = 'steam' then
    raise exception 'Put the code in your public Steam About, then press Verify. Connecting Steam also works.';
  end if;
  raise exception 'Connect % to prove you own that account. Typing a handle is not enough.', prov;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Friend profiles expose verified links (not pending claims)
-- ---------------------------------------------------------------------------
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
        and l.provider in ('discord', 'steam', 'riot', 'epic')
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

grant execute on function public.link_stat_account(text, text) to authenticated;
grant execute on function public.confirm_stat_link(text) to authenticated;
grant execute on function public.get_my_stat_links() to authenticated;
grant execute on function public.get_pending_stat_link(text) to authenticated;
grant execute on function public.unlink_stat_account(text) to authenticated;
revoke all on function public.get_friend_profile(uuid) from public;
grant execute on function public.get_friend_profile(uuid) to authenticated;

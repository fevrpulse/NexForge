-- v4 Phase 9: Verified Stats (linked accounts + ownership confirm + snapshots)
-- Safe to re-run. Does not call external APIs — syncs from NexForge match history
-- once the player confirms they own the linked handle.

create table if not exists public.stat_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('riot', 'steam', 'tracker')),
  handle text not null,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'revoked')),
  verify_code text,
  verified_at timestamptz,
  last_synced_at timestamptz,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists stat_links_user_idx on public.stat_links (user_id);

alter table public.stat_links enable row level security;

drop policy if exists "Users read own stat links" on public.stat_links;
create policy "Users read own stat links"
  on public.stat_links for select
  to authenticated
  using (auth.uid() = user_id);

-- Friends can see verified handles only (no verify codes).
create or replace view public.stat_links_public
with (security_invoker = true)
as
select
  user_id,
  provider,
  handle,
  status,
  verified_at,
  last_synced_at,
  case when status = 'verified' then snapshot else '{}'::jsonb end as snapshot
from public.stat_links
where status = 'verified';

grant select on public.stat_links_public to authenticated;

create or replace function public._stat_provider_games(p_provider text)
returns text[]
language sql immutable as $$
  select case p_provider
    when 'riot' then array['Valorant', 'League of Legends', 'Teamfight Tactics']
    when 'steam' then array['CS2', 'Counter-Strike 2', 'Dota 2', 'Apex Legends', 'PUBG', 'Rust', 'Team Fortress 2']
    when 'tracker' then array[]::text[] -- all games
    else array[]::text[]
  end;
$$;

create or replace function public.link_stat_account(p_provider text, p_handle text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  h text;
  code text;
  prov text := lower(trim(coalesce(p_provider, '')));
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if prov not in ('riot', 'steam', 'tracker') then
    raise exception 'Provider must be riot, steam, or tracker';
  end if;

  h := nullif(trim(coalesce(p_handle, '')), '');
  if h is null then raise exception 'Handle required'; end if;
  if char_length(h) < 3 or char_length(h) > 64 then
    raise exception 'Handle must be 3–64 characters';
  end if;

  if prov = 'riot' and position('#' in h) = 0 then
    raise exception 'Riot ID must look like Name#TAG';
  end if;
  if prov = 'steam' and h !~ '^[0-9]{17}$' and position('steamcommunity.com' in lower(h)) = 0
     and lower(h) !~ '^[a-z0-9_-]{3,32}$' then
    raise exception 'Enter a SteamID64 (17 digits) or Steam vanity name';
  end if;

  code := 'NF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.stat_links as sl (
    user_id, provider, handle, status, verify_code, verified_at, last_synced_at, snapshot, updated_at
  ) values (
    uid, prov, h, 'pending', code, null, null, '{}'::jsonb, now()
  )
  on conflict (user_id, provider) do update set
    handle = excluded.handle,
    status = 'pending',
    verify_code = excluded.verify_code,
    verified_at = null,
    last_synced_at = null,
    snapshot = '{}'::jsonb,
    updated_at = now();

  return public.get_my_stat_links();
end;
$$;

create or replace function public.confirm_stat_link(p_provider text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prov text := lower(trim(coalesce(p_provider, '')));
  link public.stat_links;
  status_text text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into link from public.stat_links
  where user_id = uid and provider = prov;
  if not found then raise exception 'Link this account first'; end if;
  if link.status = 'verified' then
    return public.get_my_stat_links();
  end if;
  if link.verify_code is null then raise exception 'No verify code — re-link the account'; end if;

  select coalesce(custom_status, '') into status_text
  from public.profiles where id = uid;

  if position(upper(link.verify_code) in upper(status_text)) = 0 then
    raise exception 'Set your NexForge status to include % then try again', link.verify_code;
  end if;

  update public.stat_links
    set status = 'verified',
        verified_at = now(),
        verify_code = null,
        updated_at = now()
  where user_id = uid and provider = prov;

  return public.get_my_stat_links();
end;
$$;

create or replace function public.unlink_stat_account(p_provider text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prov text := lower(trim(coalesce(p_provider, '')));
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  update public.stat_links
    set status = 'revoked', verify_code = null, updated_at = now()
  where user_id = uid and provider = prov;
  delete from public.stat_links where user_id = uid and provider = prov;
  return public.get_my_stat_links();
end;
$$;

create or replace function public.sync_stat_link(p_provider text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prov text := lower(trim(coalesce(p_provider, '')));
  link public.stat_links;
  games text[];
  wins integer := 0;
  losses integer := 0;
  sampled integer := 0;
  last_played timestamptz;
  snap jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into link from public.stat_links
  where user_id = uid and provider = prov and status = 'verified';
  if not found then raise exception 'Verify the account before syncing'; end if;

  games := public._stat_provider_games(prov);

  if prov = 'tracker' or coalesce(array_length(games, 1), 0) = 0 then
    select
      count(*) filter (where lower(coalesce(result, '')) in ('win', 'w', 'victory'))::integer,
      count(*) filter (where lower(coalesce(result, '')) in ('loss', 'l', 'defeat'))::integer,
      count(*)::integer,
      max(played_at)
    into wins, losses, sampled, last_played
    from public.matches
    where user_id = uid
      and played_at >= now() - interval '90 days';
  else
    select
      count(*) filter (where lower(coalesce(result, '')) in ('win', 'w', 'victory'))::integer,
      count(*) filter (where lower(coalesce(result, '')) in ('loss', 'l', 'defeat'))::integer,
      count(*)::integer,
      max(played_at)
    into wins, losses, sampled, last_played
    from public.matches
    where user_id = uid
      and played_at >= now() - interval '90 days'
      and game = any (games);
  end if;

  snap := jsonb_build_object(
    'source', 'nexforge_matches',
    'provider', prov,
    'handle', link.handle,
    'window_days', 90,
    'wins', wins,
    'losses', losses,
    'matches', sampled,
    'win_rate', case when wins + losses > 0
      then round((wins::numeric / (wins + losses)) * 100)
      else null end,
    'last_played_at', last_played,
    'note', 'Synced from NexForge match history for linked games. External Riot/Steam APIs can plug in later when keys are configured.'
  );

  update public.stat_links
    set snapshot = snap,
        last_synced_at = now(),
        updated_at = now()
  where user_id = uid and provider = prov;

  return public.get_my_stat_links();
end;
$$;

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
      'snapshot', l.snapshot
    ) order by l.provider
  ), '[]'::jsonb)
  into links
  from public.stat_links l
  where l.user_id = uid and l.status in ('pending', 'verified');

  return jsonb_build_object('links', links);
end;
$$;

revoke all on function public.link_stat_account(text, text) from public;
revoke all on function public.confirm_stat_link(text) from public;
revoke all on function public.unlink_stat_account(text) from public;
revoke all on function public.sync_stat_link(text) from public;
revoke all on function public.get_my_stat_links() from public;
revoke all on function public._stat_provider_games(text) from public;

grant execute on function public.link_stat_account(text, text) to authenticated;
grant execute on function public.confirm_stat_link(text) to authenticated;
grant execute on function public.unlink_stat_account(text) to authenticated;
grant execute on function public.sync_stat_link(text) to authenticated;
grant execute on function public.get_my_stat_links() to authenticated;

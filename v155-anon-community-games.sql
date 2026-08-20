-- v155: Stop anonymous callers from promoting community games, and clamp the
-- client-supplied threshold so it cannot be lowered below 5.
-- Also re-lock the Groq secret RPC and restore expires_at SELECT if missing.

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'sync_community_games'
  ) then
    execute 'revoke all on function public.sync_community_games(integer) from public, anon';
  end if;
end $$;

create or replace function public.sync_community_games(p_threshold integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_threshold integer := greatest(coalesce(p_threshold, 5), 5);
  v_promoted integer := 0;
  v_watching integer := 0;
  r record;
begin
  for r in
    with ranked as (
      select
        public.normalize_game_key(p.main_game) as name_key,
        mode() within group (order by trim(p.main_game)) as display_name,
        count(*)::integer as player_count
      from public.profiles p
      where p.main_game is not null
        and length(trim(p.main_game)) between 2 and 60
        and public.normalize_game_key(p.main_game) is not null
        and not (public.normalize_game_key(p.main_game) = any (public.nexforge_builtin_game_keys()))
      group by 1
      having count(*) >= 1
    )
    select * from ranked
  loop
    insert into public.community_games as cg (name, name_key, player_count, status, category, mark, promoted_at)
    values (
      r.display_name,
      r.name_key,
      r.player_count,
      case when r.player_count >= v_threshold then 'live' else 'watching' end,
      'Community',
      upper(left(regexp_replace(r.display_name, '[^A-Za-z0-9]', '', 'g'), 4)),
      case when r.player_count >= v_threshold then now() else null end
    )
    on conflict (name_key) do update
      set
        name = excluded.name,
        player_count = excluded.player_count,
        status = case
          when excluded.player_count >= v_threshold then 'live'
          else community_games.status
        end,
        promoted_at = case
          when community_games.status <> 'live' and excluded.player_count >= v_threshold then now()
          else community_games.promoted_at
        end;

    if r.player_count >= v_threshold then
      v_promoted := v_promoted + 1;
    else
      v_watching := v_watching + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'threshold', v_threshold,
    'live_or_promoted', v_promoted,
    'watching', v_watching
  );
end;
$$;

revoke all on function public.sync_community_games(integer) from public, anon;
grant execute on function public.sync_community_games(integer) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'report_custom_main_game'
  ) then
    execute 'revoke all on function public.report_custom_main_game(text) from public, anon';
    execute 'grant execute on function public.report_custom_main_game(text) to authenticated';
  end if;
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_internal_get_app_secret'
  ) then
    execute 'revoke all on function public._internal_get_app_secret(text) from public, anon, authenticated';
    execute 'grant execute on function public._internal_get_app_secret(text) to service_role';
  end if;
end $$;

-- Tournaments list selects expires_at; column-level grants must include it.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournaments'
      and column_name = 'expires_at'
  ) then
    execute 'grant select (expires_at) on table public.tournaments to anon, authenticated';
  end if;
end $$;

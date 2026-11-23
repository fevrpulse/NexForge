-- v170: Clans are removed. Older apps still call these functions, so reads return nothing
-- and every clan action fails with a clear message. No clan coins can be claimed.
-- Clan rows are kept; nothing here deletes them. Safe to re-run.

drop trigger if exists trg_clan_members_sync_profile on public.clan_members;

update public.profiles
  set clan_id = null,
      clan_tag = null
where clan_id is not null or clan_tag is not null;

create or replace function public.get_my_clan()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return null;
end;
$$;

create or replace function public.list_joinable_clans(p_limit integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('clans', '[]'::jsonb);
end;
$$;

create or replace function public.get_clan_leaderboard(p_limit integer default 20)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('clans', '[]'::jsonb);
end;
$$;

create or replace function public._grant_first_clan_bonus(p_uid uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  return;
end;
$$;

-- create_clan has two versions (v135 and v139), so every version found is replaced.
do $$
declare
  f record;
begin
  for f in
    select p.proname, pg_get_function_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_clan', 'join_clan', 'invite_to_clan', 'respond_clan_invite',
        'leave_clan', 'disband_clan', 'update_clan_settings', 'claim_clan_reward'
      )
      and pg_get_function_result(p.oid) = 'jsonb'
  loop
    execute format(
      'create or replace function public.%I(%s) returns jsonb language plpgsql security definer set search_path = public as $f$ begin raise exception %L; end; $f$',
      f.proname, f.args, 'Clans have been removed from NexForge.'
    );
  end loop;
end $$;

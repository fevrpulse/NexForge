-- v171: get_my_party read profiles.avatar_url, which profiles never had, so every party
-- lookup failed (and create/invite/ready, which return it, rolled back). Profiles keep
-- photos in avatar_path and avatar_preset. Safe to re-run.

create or replace function public.get_my_party()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pid uuid;
  member_status text;
  party_row public.parties;
  members jsonb;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select party_id, status into pid, member_status
  from public.party_members
  where user_id = uid and status in ('joined', 'invited')
  order by case when status = 'joined' then 0 else 1 end
  limit 1;

  if pid is null then
    return null;
  end if;

  select * into party_row from public.parties where id = pid;
  if not found or party_row.status = 'disbanded' then
    return null;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', pm.user_id,
      'role', pm.role,
      'status', pm.status,
      'ready', pm.ready,
      'gamer_tag', coalesce(pr.gamer_tag, 'Player'),
      'mmr', coalesce(pr.mmr, 1200),
      'avatar_path', pr.avatar_path,
      'avatar_preset', pr.avatar_preset,
      'equipped_frame', pr.equipped_frame,
      'last_seen_at', pr.last_seen_at,
      'playing_game', pr.playing_game,
      'joined_at', pm.joined_at
    )
    order by case when pm.role = 'host' then 0 else 1 end, pm.joined_at nulls last, pm.created_at
  ), '[]'::jsonb)
  into members
  from public.party_members pm
  left join public.profiles pr on pr.id = pm.user_id
  where pm.party_id = pid
    and pm.status in ('joined', 'invited');

  return jsonb_build_object(
    'id', party_row.id,
    'host_id', party_row.host_id,
    'game', party_row.game,
    'status', party_row.status,
    'max_members', party_row.max_members,
    'my_status', member_status,
    'created_at', party_row.created_at,
    'updated_at', party_row.updated_at,
    'members', members
  );
end;
$$;

revoke all on function public.get_my_party() from public;
grant execute on function public.get_my_party() to authenticated;

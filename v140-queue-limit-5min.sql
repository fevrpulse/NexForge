-- Queue limit: match lobbies + open duel queues expire after 5 minutes.
-- Applied remotely; kept here for repo history / re-apply.

create or replace function public._expire_stale_duel_queues()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.duels
    set status = 'cancelled',
        updated_at = now()
  where status = 'open'
    and created_at < now() - interval '5 minutes';
end;
$$;

revoke all on function public._expire_stale_duel_queues() from public, anon, authenticated;

create or replace function public.list_open_duels(p_limit integer default 40)
returns setof public.duels
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._expire_stale_duel_queues();
  return query
    select d.*
    from public.duels d
    where d.status in ('open', 'active')
    order by d.created_at desc
    limit least(greatest(coalesce(p_limit, 40), 1), 100);
end;
$$;

grant execute on function public.list_open_duels(integer) to authenticated;

-- join_lobby_queue / get_my_lobby: expires_at = now() + interval '5 minutes'
-- and get_my_lobby auto-cancels open lobbies past expires_at.
-- Full bodies live in v132-match-lobbies.sql (patched) and on the remote project.

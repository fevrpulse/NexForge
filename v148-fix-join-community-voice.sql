-- Fix: column reference "kind" is ambiguous in join_community_voice
-- (PL/pgSQL variable name collided with community_channels.kind)

create or replace function public.join_community_voice(p_channel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  comm uuid;
  ch_kind text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select c.community_id, c.kind
    into comm, ch_kind
  from public.community_channels c
  where c.id = p_channel_id;

  if not found then raise exception 'Channel not found'; end if;
  if ch_kind <> 'voice' then raise exception 'Not a voice channel'; end if;
  if not public._is_community_member(comm) then raise exception 'Not a community member'; end if;

  -- Leave other voice channels in this community first.
  delete from public.community_voice_members v
  using public.community_channels ch
  where v.user_id = uid
    and v.channel_id = ch.id
    and ch.community_id = comm
    and v.channel_id <> p_channel_id;

  insert into public.community_voice_members (channel_id, user_id)
  values (p_channel_id, uid)
  on conflict (channel_id, user_id) do update set joined_at = now();

  return jsonb_build_object('ok', true, 'channel_id', p_channel_id);
end;
$$;

grant execute on function public.join_community_voice(uuid) to authenticated;

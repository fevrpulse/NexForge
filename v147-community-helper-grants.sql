-- RLS policies call these helpers as authenticated; EXECUTE is required even for SECURITY DEFINER.
grant execute on function public._is_community_member(uuid) to authenticated;
grant execute on function public._community_channel_community(uuid) to authenticated;

revoke all on function public._is_community_member(uuid) from anon, public;
revoke all on function public._community_channel_community(uuid) from anon, public;

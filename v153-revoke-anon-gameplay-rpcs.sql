-- v153: Revoke anon EXECUTE on gameplay / companion SECURITY DEFINER RPCs

revoke all on function public.accept_duel(uuid) from public, anon;
grant execute on function public.accept_duel(uuid) to authenticated;

revoke all on function public.cancel_duel(uuid) from public, anon;
grant execute on function public.cancel_duel(uuid) to authenticated;

revoke all on function public.list_open_duels(integer) from public, anon;
grant execute on function public.list_open_duels(integer) to authenticated;

revoke all on function public.submit_duel_winner(uuid, uuid, integer, integer, integer) from public, anon;
grant execute on function public.submit_duel_winner(uuid, uuid, integer, integer, integer) to authenticated;

revoke all on function public.get_companion_home() from public, anon;
grant execute on function public.get_companion_home() to authenticated;

revoke all on function public.get_my_battle_pass() from public, anon;
grant execute on function public.get_my_battle_pass() to authenticated;

revoke all on function public.award_forge_coins_on_match_win() from public, anon, authenticated;
revoke all on function public.trg_season_on_duel_match() from public, anon, authenticated;

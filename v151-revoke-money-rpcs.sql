-- v151: Targeted REVOKE of money/shop/tournament RPCs from PUBLIC + anon
revoke all on function public.buy_cosmetic(text) from public, anon;
grant execute on function public.buy_cosmetic(text) to authenticated;

revoke all on function public.gift_cosmetic(uuid, text) from public, anon;
grant execute on function public.gift_cosmetic(uuid, text) to authenticated;

revoke all on function public.equip_cosmetic(text) from public, anon;
grant execute on function public.equip_cosmetic(text) to authenticated;

revoke all on function public.claim_daily_forge_coins() from public, anon;
grant execute on function public.claim_daily_forge_coins() to authenticated;

revoke all on function public.claim_pass_tier(integer) from public, anon;
grant execute on function public.claim_pass_tier(integer) to authenticated;

revoke all on function public.claim_clan_reward() from public, anon;
grant execute on function public.claim_clan_reward() to authenticated;

revoke all on function public.check_in_tournament(uuid) from public, anon;
grant execute on function public.check_in_tournament(uuid) to authenticated;

revoke all on function public.host_generate_bracket(uuid) from public, anon;
grant execute on function public.host_generate_bracket(uuid) to authenticated;

revoke all on function public.get_tournament_bracket(uuid) from public, anon;
grant execute on function public.get_tournament_bracket(uuid) to authenticated;

revoke all on function public.unregister_from_tournament(uuid) from public, anon;
grant execute on function public.unregister_from_tournament(uuid) to authenticated;

revoke all on function public.register_for_tournament(uuid) from public, anon;
grant execute on function public.register_for_tournament(uuid) to authenticated;

revoke all on function public.host_report_bracket_winner(uuid, integer, integer, uuid) from public, anon;
grant execute on function public.host_report_bracket_winner(uuid, integer, integer, uuid) to authenticated;

revoke all on function public.create_tournament(
  text, text, text, integer, timestamptz, text, text, numeric, text,
  text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.create_tournament(
  text, text, text, integer, timestamptz, text, text, numeric, text,
  text, text, text, text, text, text, text, text
) to authenticated;

revoke all on function public.mark_tournament_prize_funded(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_tournament_prize_funded(uuid, text, text) to service_role;

revoke all on function public._aba_routing_valid(text) from public, anon;
grant execute on function public._aba_routing_valid(text) to authenticated, service_role;

revoke all on function public._tournaments_freeze_money_fields() from public, anon, authenticated;

revoke insert, update, delete on public.cosmetic_payments from anon, authenticated;
revoke all on public.tournament_payouts from anon, authenticated;

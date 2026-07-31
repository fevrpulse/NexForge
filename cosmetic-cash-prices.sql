-- Fair cash prices for all cosmetics (by rarity). Defaults stay free.
-- Safe to re-run.

-- common  $0.49 | rare $1.99 | epic $3.99 | legendary $4.99–$6.99
update public.cosmetics set real_money_cents = 0
where id in ('frame_none', 'banner_none', 'plate_default');

update public.cosmetics set real_money_cents = 49
where rarity = 'common'
  and id not in ('frame_none', 'banner_none', 'plate_default');

update public.cosmetics set real_money_cents = 199
where rarity = 'rare';

update public.cosmetics set real_money_cents = 399
where rarity = 'epic';

update public.cosmetics set real_money_cents = 499
where rarity = 'legendary'
  and id in ('frame_gold', 'banner_legend', 'plate_gold');

update public.cosmetics set real_money_cents = 599
where id = 'frame_pulse';

update public.cosmetics set real_money_cents = 699
where id = 'frame_spin';

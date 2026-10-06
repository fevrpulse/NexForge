-- v166 higher Forge Coin prices and cheaper cash tags.
-- Cash is $0.99–$6.99. Stripe checkout rejects anything under $0.50.
-- Safe to re-run.

update public.cosmetics as c
set
  price = v.price,
  real_money_cents = v.cents
from (values
  ('frame_neon', 800, 99),
  ('frame_ice', 900, 99),
  ('frame_mint', 850, 99),
  ('banner_grid', 700, 99),
  ('banner_dusk', 750, 99),
  ('plate_neon', 800, 99),
  ('plate_sky', 800, 99),
  ('plate_mint', 750, 99),
  ('frame_ember', 1800, 199),
  ('frame_rose', 2000, 199),
  ('banner_aurora', 1700, 199),
  ('banner_tide', 1800, 199),
  ('plate_rose', 1600, 199),
  ('plate_ember', 1800, 199),
  ('frame_void', 3600, 399),
  ('frame_storm', 4000, 399),
  ('banner_blaze', 3200, 399),
  ('banner_circuit', 3600, 399),
  ('plate_void', 3400, 399),
  ('frame_gold', 0, 499),
  ('banner_legend', 0, 499),
  ('plate_gold', 0, 499),
  ('frame_prism', 7000, 599),
  ('banner_eclipse', 6500, 599),
  ('frame_pulse', 16000, 599),
  ('plate_prism', 6000, 699),
  ('frame_spin', 25000, 699)
) as v(id, price, cents)
where c.id = v.id;

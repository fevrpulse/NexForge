-- v165 extra frames, banners, and nameplates.
-- Each paid item has a Forge Coin price and a cash price tag.
-- Cash stays at or under $6.99 because checkout rejects anything higher.
-- Safe to re-run.

alter table public.cosmetics
  add column if not exists real_money_cents integer not null default 0;

insert into public.cosmetics (id, slot, name, description, price, min_mmr, rarity, style_key, real_money_cents) values
  ('frame_mint', 'frame', 'Mint Ring', 'Soft mint outline', 85, 0, 'common', 'mint', 99),
  ('frame_rose', 'frame', 'Rose Ring', 'Pink rim with a warm glow', 140, 1200, 'rare', 'rose', 199),
  ('frame_storm', 'frame', 'Storm Ring', 'Animated cyan storm ring', 210, 1600, 'epic', 'storm', 399),
  ('frame_prism', 'frame', 'Prism Ring', 'Animated rainbow ring', 280, 2000, 'legendary', 'prism', 599),
  ('banner_dusk', 'banner', 'Dusk', 'Violet and rose dusk wash', 70, 0, 'common', 'dusk', 99),
  ('banner_tide', 'banner', 'Tide', 'Deep teal current', 130, 0, 'rare', 'tide', 199),
  ('banner_circuit', 'banner', 'Circuit', 'Lime circuit traces', 190, 1500, 'epic', 'circuit', 399),
  ('banner_eclipse', 'banner', 'Eclipse', 'A gold ring on a dark field', 260, 2100, 'legendary', 'eclipse', 599),
  ('plate_mint', 'nameplate', 'Mint Tag', 'Mint gamer tag', 75, 0, 'common', 'mint', 99),
  ('plate_ember', 'nameplate', 'Ember Tag', 'Warm orange tag', 120, 1300, 'rare', 'ember', 199),
  ('plate_void', 'nameplate', 'Void Tag', 'Purple spectral tag', 170, 1700, 'epic', 'void', 399),
  ('plate_prism', 'nameplate', 'Prism Tag', 'Shifting rainbow letters', 240, 2000, 'legendary', 'prism', 699)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  price = excluded.price,
  min_mmr = excluded.min_mmr,
  rarity = excluded.rarity,
  style_key = excluded.style_key,
  slot = excluded.slot,
  real_money_cents = excluded.real_money_cents;

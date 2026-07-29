-- Cosmetics shop, profile avatars, forge coins
-- Safe to re-run.

-- ── PROFILE COSMETIC COLUMNS ──
alter table public.profiles add column if not exists forge_coins integer not null default 250;
alter table public.profiles add column if not exists forge_coins_claimed_at timestamptz;
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists equipped_frame text;
alter table public.profiles add column if not exists equipped_banner text;
alter table public.profiles add column if not exists equipped_nameplate text;

alter table public.profiles drop constraint if exists profiles_avatar_path_check;
alter table public.profiles
  add constraint profiles_avatar_path_check
  check (avatar_path is null or avatar_path like (id::text || '/%'));

alter table public.profiles drop constraint if exists profiles_forge_coins_check;
alter table public.profiles
  add constraint profiles_forge_coins_check
  check (forge_coins >= 0 and forge_coins <= 1000000);

grant update (
  avatar_path,
  equipped_frame,
  equipped_banner,
  equipped_nameplate
) on table public.profiles to authenticated;

-- ── CATALOG ──
create table if not exists public.cosmetics (
  id text primary key,
  slot text not null check (slot in ('frame', 'banner', 'nameplate')),
  name text not null,
  description text not null default '',
  price integer not null default 0 check (price >= 0),
  min_mmr integer not null default 0,
  rarity text not null default 'common' check (rarity in ('common', 'rare', 'epic', 'legendary')),
  style_key text not null
);

alter table public.cosmetics enable row level security;

drop policy if exists "Anyone authenticated can browse cosmetics" on public.cosmetics;
create policy "Anyone authenticated can browse cosmetics"
  on public.cosmetics for select
  to authenticated
  using (true);

insert into public.cosmetics (id, slot, name, description, price, min_mmr, rarity, style_key) values
  ('frame_none', 'frame', 'No Frame', 'Clean default look', 0, 0, 'common', 'none'),
  ('frame_neon', 'frame', 'Neon Ring', 'Bright lime outline', 75, 0, 'common', 'neon'),
  ('frame_ice', 'frame', 'Ice Ring', 'Cool blue outline', 90, 0, 'common', 'ice'),
  ('frame_ember', 'frame', 'Ember Ring', 'Warm orange glow', 120, 1400, 'rare', 'ember'),
  ('frame_void', 'frame', 'Void Ring', 'Purple spectral rim', 180, 1800, 'epic', 'void'),
  ('frame_gold', 'frame', 'Champion Ring', 'Gold for high MMR', 0, 2200, 'legendary', 'gold'),
  ('banner_none', 'banner', 'No Banner', 'Default profile backdrop', 0, 0, 'common', 'none'),
  ('banner_grid', 'banner', 'Forge Grid', 'Subtle neon grid wash', 60, 0, 'common', 'grid'),
  ('banner_aurora', 'banner', 'Aurora', 'Soft teal / violet wash', 110, 0, 'rare', 'aurora'),
  ('banner_blaze', 'banner', 'Blaze', 'Hot red gradient strip', 150, 1600, 'epic', 'blaze'),
  ('banner_legend', 'banner', 'Legend Stripe', 'Unlocked at Master MMR', 0, 2700, 'legendary', 'legend'),
  ('plate_default', 'nameplate', 'Standard Tag', 'Default name color', 0, 0, 'common', 'default'),
  ('plate_neon', 'nameplate', 'Neon Tag', 'Lime gamer tag', 80, 0, 'common', 'neon'),
  ('plate_sky', 'nameplate', 'Sky Tag', 'Bright blue tag', 80, 0, 'common', 'sky'),
  ('plate_rose', 'nameplate', 'Rose Tag', 'Pink accent tag', 100, 1200, 'rare', 'rose'),
  ('plate_gold', 'nameplate', 'Gold Tag', 'Champion gold letters', 0, 2200, 'legendary', 'gold')
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  price = excluded.price,
  min_mmr = excluded.min_mmr,
  rarity = excluded.rarity,
  style_key = excluded.style_key,
  slot = excluded.slot;

-- ── OWNERSHIP ──
create table if not exists public.user_cosmetics (
  user_id uuid not null references auth.users(id) on delete cascade,
  cosmetic_id text not null references public.cosmetics(id) on delete cascade,
  acquired_at timestamptz not null default now(),
  primary key (user_id, cosmetic_id)
);

alter table public.user_cosmetics enable row level security;

drop policy if exists "Users can view own cosmetics" on public.user_cosmetics;
create policy "Users can view own cosmetics"
  on public.user_cosmetics for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can view friends cosmetics" on public.user_cosmetics;
create policy "Users can view friends cosmetics"
  on public.user_cosmetics for select
  to authenticated
  using (
    exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = user_id)
        )
    )
  );

create or replace function public.buy_cosmetic(p_cosmetic_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cosmetics;
  p public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into c from public.cosmetics where id = p_cosmetic_id;
  if not found then
    raise exception 'Unknown cosmetic';
  end if;

  select * into p from public.profiles where id = auth.uid() for update;
  if not found then
    raise exception 'Profile missing';
  end if;

  if coalesce(p.mmr, 1200) < c.min_mmr then
    raise exception 'Need % MMR to unlock this item', c.min_mmr;
  end if;

  if exists (
    select 1 from public.user_cosmetics uc
    where uc.user_id = auth.uid() and uc.cosmetic_id = p_cosmetic_id
  ) then
    return json_build_object('ok', true, 'already_owned', true, 'forge_coins', p.forge_coins);
  end if;

  if c.price > 0 and coalesce(p.forge_coins, 0) < c.price then
    raise exception 'Not enough Forge Coins';
  end if;

  if c.price > 0 then
    update public.profiles
      set forge_coins = forge_coins - c.price
      where id = auth.uid()
      returning * into p;
  end if;

  insert into public.user_cosmetics (user_id, cosmetic_id)
  values (auth.uid(), p_cosmetic_id);

  return json_build_object('ok', true, 'already_owned', false, 'forge_coins', p.forge_coins);
end;
$$;

revoke all on function public.buy_cosmetic(text) from public;
grant execute on function public.buy_cosmetic(text) to authenticated;

create or replace function public.equip_cosmetic(p_cosmetic_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cosmetics;
  user_mmr int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into c from public.cosmetics where id = p_cosmetic_id;
  if not found then
    raise exception 'Unknown cosmetic';
  end if;

  select coalesce(mmr, 1200) into user_mmr from public.profiles where id = auth.uid();

  if not exists (
    select 1 from public.user_cosmetics uc
    where uc.user_id = auth.uid() and uc.cosmetic_id = p_cosmetic_id
  ) then
    if c.price = 0 and user_mmr >= c.min_mmr then
      insert into public.user_cosmetics (user_id, cosmetic_id)
      values (auth.uid(), p_cosmetic_id)
      on conflict do nothing;
    elsif c.price = 0 and c.min_mmr = 0 then
      insert into public.user_cosmetics (user_id, cosmetic_id)
      values (auth.uid(), p_cosmetic_id)
      on conflict do nothing;
    else
      raise exception 'You do not own this cosmetic';
    end if;
  end if;

  if c.slot = 'frame' then
    update public.profiles set equipped_frame = c.id where id = auth.uid();
  elsif c.slot = 'banner' then
    update public.profiles set equipped_banner = c.id where id = auth.uid();
  elsif c.slot = 'nameplate' then
    update public.profiles set equipped_nameplate = c.id where id = auth.uid();
  end if;

  return json_build_object('ok', true, 'slot', c.slot, 'id', c.id);
end;
$$;

revoke all on function public.equip_cosmetic(text) from public;
grant execute on function public.equip_cosmetic(text) to authenticated;

create or replace function public.claim_daily_forge_coins()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  last_claim timestamptz;
  new_balance int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select forge_coins_claimed_at into last_claim
  from public.profiles where id = auth.uid() for update;

  if last_claim is not null and last_claim > now() - interval '20 hours' then
    raise exception 'Daily Forge Coins already claimed';
  end if;

  update public.profiles
    set forge_coins = least(1000000, coalesce(forge_coins, 0) + 50),
        forge_coins_claimed_at = now()
    where id = auth.uid()
    returning forge_coins into new_balance;

  return json_build_object('ok', true, 'forge_coins', new_balance, 'gained', 50);
end;
$$;

revoke all on function public.claim_daily_forge_coins() from public;
grant execute on function public.claim_daily_forge_coins() to authenticated;

-- ── AVATAR STORAGE (public read for friends lists) ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload own avatars" on storage.objects;
create policy "Users can upload own avatars"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update own avatars" on storage.objects;
create policy "Users can update own avatars"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete own avatars" on storage.objects;
create policy "Users can delete own avatars"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Anyone can view avatars" on storage.objects;
create policy "Anyone can view avatars"
  on storage.objects for select
  to authenticated, anon
  using (bucket_id = 'avatars');

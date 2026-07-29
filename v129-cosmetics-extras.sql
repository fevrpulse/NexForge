-- v1.2.9 cosmetics extras: win coins, gifts, avatar presets
-- Safe to re-run.

-- Award Forge Coins whenever a win match row is inserted (duel completion, etc.).
create or replace function public.award_forge_coins_on_match_win()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.result = 'win' then
    update public.profiles
      set forge_coins = least(1000000, coalesce(forge_coins, 0) + 25)
      where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_match_win_coins on public.matches;
create trigger trg_match_win_coins
  after insert on public.matches
  for each row
  execute function public.award_forge_coins_on_match_win();

-- Built-in avatar presets (no upload required).
alter table public.profiles add column if not exists avatar_preset text;
alter table public.profiles drop constraint if exists profiles_avatar_preset_check;
alter table public.profiles
  add constraint profiles_avatar_preset_check
  check (
    avatar_preset is null
    or avatar_preset in ('forge', 'blade', 'pulse', 'circuit', 'ember', 'frost', 'void')
  );

grant update (avatar_preset) on table public.profiles to authenticated;

-- Gift a cosmetic to an accepted friend (buyer pays if friend doesn't own it).
create or replace function public.gift_cosmetic(p_friend_id uuid, p_cosmetic_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cosmetics;
  buyer public.profiles;
  is_friend boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_friend_id = auth.uid() then
    raise exception 'Cannot gift to yourself';
  end if;

  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = auth.uid() and f.addressee_id = p_friend_id)
        or (f.addressee_id = auth.uid() and f.requester_id = p_friend_id)
      )
  ) into is_friend;
  if not is_friend then
    raise exception 'You can only gift to accepted friends';
  end if;

  select * into c from public.cosmetics where id = p_cosmetic_id;
  if not found then
    raise exception 'Unknown cosmetic';
  end if;

  if exists (
    select 1 from public.user_cosmetics uc
    where uc.user_id = p_friend_id and uc.cosmetic_id = p_cosmetic_id
  ) then
    raise exception 'Friend already owns this cosmetic';
  end if;

  select * into buyer from public.profiles where id = auth.uid() for update;
  if not found then
    raise exception 'Profile missing';
  end if;

  -- Free MMR unlocks: friend must meet MMR; otherwise gifter pays the coin price.
  if c.price = 0 then
    if (select coalesce(mmr, 1200) from public.profiles where id = p_friend_id) < c.min_mmr then
      raise exception 'Friend needs % MMR for this unlock', c.min_mmr;
    end if;
  else
    if coalesce(buyer.forge_coins, 0) < c.price then
      raise exception 'Not enough Forge Coins to gift this';
    end if;
    update public.profiles
      set forge_coins = forge_coins - c.price
      where id = auth.uid()
      returning * into buyer;
  end if;

  insert into public.user_cosmetics (user_id, cosmetic_id)
  values (p_friend_id, p_cosmetic_id);

  return json_build_object(
    'ok', true,
    'forge_coins', buyer.forge_coins,
    'gifted_to', p_friend_id,
    'cosmetic_id', p_cosmetic_id
  );
end;
$$;

revoke all on function public.gift_cosmetic(uuid, text) from public;
grant execute on function public.gift_cosmetic(uuid, text) to authenticated;

-- Animated legendary/epic frames (client CSS). Seed an extra animated frame.
insert into public.cosmetics (id, slot, name, description, price, min_mmr, rarity, style_key) values
  ('frame_pulse', 'frame', 'Pulse Ring', 'Animated neon pulse frame', 200, 0, 'legendary', 'pulse'),
  ('frame_spin', 'frame', 'Orbit Ring', 'Animated rotating gold orbit', 220, 1800, 'legendary', 'spin')
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  price = excluded.price,
  min_mmr = excluded.min_mmr,
  rarity = excluded.rarity,
  style_key = excluded.style_key;

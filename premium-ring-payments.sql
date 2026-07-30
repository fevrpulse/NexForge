-- Premium animated rings: high-skill Forge Coin unlocks with Stripe bypass.
-- Safe to re-run.

alter table public.cosmetics
  add column if not exists real_money_cents integer not null default 0;

alter table public.cosmetics
  drop constraint if exists cosmetics_real_money_cents_check;
alter table public.cosmetics
  add constraint cosmetics_real_money_cents_check
  check (real_money_cents >= 0);

update public.cosmetics
set
  description = 'Animated neon pulse frame — earn it at Elite MMR or buy it instantly',
  price = 2500,
  min_mmr = 2800,
  real_money_cents = 499,
  rarity = 'legendary'
where id = 'frame_pulse';

update public.cosmetics
set
  description = 'Animated gold orbit — earn it at Legend MMR or buy it instantly',
  price = 4000,
  min_mmr = 3200,
  real_money_cents = 699,
  rarity = 'legendary'
where id = 'frame_spin';

-- Server-only audit trail. RLS is enabled with no client policies; only the
-- service role used by the verified Stripe webhook can read or write rows.
create table if not exists public.cosmetic_payments (
  stripe_checkout_session_id text primary key,
  stripe_event_id text not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  cosmetic_id text not null references public.cosmetics(id) on delete restrict,
  amount_total integer not null check (amount_total > 0),
  currency text not null check (currency = lower(currency)),
  paid_at timestamptz not null default now()
);

alter table public.cosmetic_payments enable row level security;
revoke all on table public.cosmetic_payments from anon, authenticated;

-- Gifts must respect the recipient's MMR requirement. Stripe is the only path
-- that bypasses MMR; gifting with Forge Coins must not become a loophole.
create or replace function public.gift_cosmetic(p_friend_id uuid, p_cosmetic_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cosmetics;
  buyer public.profiles;
  recipient_mmr integer;
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

  select coalesce(mmr, 1200)
    into recipient_mmr
    from public.profiles
    where id = p_friend_id;
  if not found then
    raise exception 'Friend profile missing';
  end if;
  if recipient_mmr < c.min_mmr then
    raise exception 'Friend needs % MMR for this unlock', c.min_mmr;
  end if;

  select * into buyer from public.profiles where id = auth.uid() for update;
  if not found then
    raise exception 'Profile missing';
  end if;

  if c.price > 0 then
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

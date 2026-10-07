-- v168: nothing in the shop or in clan joins requires a rank.
-- Safe to re-run.

update public.cosmetics
set min_mmr = 0
where min_mmr <> 0;

update public.cosmetics
set description = 'Gold champion ring'
where id = 'frame_gold';

update public.cosmetics
set description = 'Gold legend stripe'
where id = 'banner_legend';

update public.cosmetics
set description = 'Animated neon pulse frame'
where id = 'frame_pulse';

update public.cosmetics
set description = 'Animated gold orbit'
where id = 'frame_spin';

update public.clans
set min_mmr = 0
where min_mmr <> 0;

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
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into c from public.cosmetics where id = p_cosmetic_id;
  if not found then
    raise exception 'Unknown cosmetic';
  end if;

  if not exists (
    select 1 from public.user_cosmetics uc
    where uc.user_id = auth.uid() and uc.cosmetic_id = p_cosmetic_id
  ) then
    if c.price = 0 then
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

  if not exists (select 1 from public.profiles where id = p_friend_id) then
    raise exception 'Friend profile missing';
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

create or replace function public.create_clan(
  p_name text,
  p_tag text,
  p_min_mmr integer default 0,
  p_is_open boolean default true
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n text; t text; cid uuid;
  min_req integer := 0;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  n := nullif(trim(coalesce(p_name, '')), '');
  t := upper(nullif(trim(coalesce(p_tag, '')), ''));
  if n is null or t is null then raise exception 'Name and tag required'; end if;
  if char_length(n) < 3 or char_length(n) > 32 then raise exception 'Name must be 3–32 characters'; end if;
  if t !~ '^[A-Z0-9]{2,5}$' then raise exception 'Tag must be 2–5 letters or numbers'; end if;
  if exists (select 1 from public.clan_members where user_id = uid and status = 'joined') then
    raise exception 'Leave your current clan first';
  end if;
  if exists (select 1 from public.clans where tag = t) then
    raise exception 'That clan tag is taken';
  end if;

  delete from public.clan_members where user_id = uid and status = 'invited';

  insert into public.clans (name, tag, owner_id, min_mmr, is_open)
  values (n, t, uid, min_req, coalesce(p_is_open, true))
  returning id into cid;
  insert into public.clan_members (clan_id, user_id, role, status, joined_at)
  values (cid, uid, 'owner', 'joined', now());

  perform public._grant_first_clan_bonus(uid);
  return public.get_my_clan();
end;
$$;

create or replace function public.join_clan(p_clan_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c public.clans;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_clan_id is null then raise exception 'Clan required'; end if;

  select * into c from public.clans where id = p_clan_id;
  if not found then raise exception 'Clan not found'; end if;
  if not c.is_open then raise exception 'This clan is invite-only'; end if;

  if exists (select 1 from public.clan_members where user_id = uid and status = 'joined') then
    raise exception 'Leave your current clan first';
  end if;

  delete from public.clan_members where user_id = uid and status = 'invited';

  insert into public.clan_members (clan_id, user_id, role, status, joined_at)
  values (p_clan_id, uid, 'member', 'joined', now())
  on conflict (clan_id, user_id) do update
    set status = 'joined', role = 'member', joined_at = now();

  perform public._grant_first_clan_bonus(uid);
  return public.get_my_clan();
end;
$$;

create or replace function public.respond_clan_invite(p_clan_id uuid, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c public.clans;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.clan_members
    where clan_id = p_clan_id and user_id = uid and status = 'invited'
  ) then raise exception 'No pending clan invite'; end if;

  if not coalesce(p_accept, false) then
    update public.clan_members set status = 'declined' where clan_id = p_clan_id and user_id = uid;
    return jsonb_build_object('ok', true, 'accepted', false);
  end if;

  if exists (select 1 from public.clan_members where user_id = uid and status = 'joined') then
    raise exception 'Leave your current clan first';
  end if;

  select * into c from public.clans where id = p_clan_id;
  if not found then raise exception 'Clan not found'; end if;

  update public.clan_members
    set status = 'joined', joined_at = now(), role = 'member'
    where clan_id = p_clan_id and user_id = uid;

  perform public._grant_first_clan_bonus(uid);
  return public.get_my_clan();
end;
$$;

create or replace function public.update_clan_settings(
  p_min_mmr integer default null,
  p_is_open boolean default null,
  p_description text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select id into cid from public.clans where owner_id = uid limit 1;
  if cid is null then raise exception 'Only the clan owner can edit settings'; end if;

  update public.clans set
    min_mmr = 0,
    is_open = case when p_is_open is null then is_open else p_is_open end,
    description = case
      when p_description is null then description
      else nullif(trim(p_description), '')
    end
  where id = cid;

  return public.get_my_clan();
end;
$$;

create or replace function public.invite_to_clan(p_friend_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  c public.clans;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_friend_id is null or p_friend_id = uid then raise exception 'Invalid invite target'; end if;
  if not public._party_are_friends(uid, p_friend_id) then
    raise exception 'You can only invite friends';
  end if;
  if public._party_is_blocked(uid, p_friend_id) then
    raise exception 'Cannot invite this player';
  end if;

  select c2.* into c
  from public.clans c2
  join public.clan_members m on m.clan_id = c2.id
  where m.user_id = uid and m.status = 'joined' and m.role in ('owner', 'officer')
  limit 1;
  if c.id is null then raise exception 'Only clan officers can invite'; end if;
  cid := c.id;

  if exists (select 1 from public.clan_members where user_id = p_friend_id and status = 'joined') then
    raise exception 'That player is already in a clan';
  end if;
  if exists (select 1 from public.clan_members where user_id = p_friend_id and status = 'invited') then
    raise exception 'That player already has a clan invite';
  end if;

  insert into public.clan_members (clan_id, user_id, role, status, invited_by)
  values (cid, p_friend_id, 'member', 'invited', uid)
  on conflict (clan_id, user_id) do update
    set status = 'invited', invited_by = uid, role = 'member', joined_at = null;

  return public.get_my_clan();
end;
$$;

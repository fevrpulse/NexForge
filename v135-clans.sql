-- v4 Phase 7: Clans (create / invite / join / leave)
-- Safe to re-run. Friends-only invites. One joined clan per user.

create table if not exists public.clans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 32),
  tag text not null check (char_length(tag) between 2 and 5),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (tag)
);

create table if not exists public.clan_members (
  clan_id uuid not null references public.clans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'officer', 'member')),
  status text not null default 'invited'
    check (status in ('invited', 'joined', 'left', 'kicked', 'declined')),
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (clan_id, user_id)
);

create unique index if not exists clan_members_one_joined_idx
  on public.clan_members (user_id) where status = 'joined';
create unique index if not exists clan_members_one_invite_idx
  on public.clan_members (user_id) where status = 'invited';
create index if not exists clans_owner_idx on public.clans (owner_id);

alter table public.clans enable row level security;
alter table public.clan_members enable row level security;

drop policy if exists "Members can read clans" on public.clans;
create policy "Members can read clans"
  on public.clans for select to authenticated
  using (
    exists (
      select 1 from public.clan_members m
      where m.clan_id = clans.id and m.user_id = auth.uid()
        and m.status in ('invited', 'joined')
    )
  );

drop policy if exists "Members can read clan membership" on public.clan_members;
create policy "Members can read clan membership"
  on public.clan_members for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.clan_members me
      where me.clan_id = clan_members.clan_id and me.user_id = auth.uid()
        and me.status in ('invited', 'joined')
    )
  );

create or replace function public.get_my_clan()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  mystatus text;
  c public.clans;
  members jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select clan_id, status into cid, mystatus
  from public.clan_members
  where user_id = uid and status in ('joined', 'invited')
  order by case when status = 'joined' then 0 else 1 end
  limit 1;
  if cid is null then return null; end if;
  select * into c from public.clans where id = cid;
  if not found then return null; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', m.user_id, 'role', m.role, 'status', m.status,
      'gamer_tag', coalesce(pr.gamer_tag, 'Player'),
      'joined_at', m.joined_at
    ) order by case when m.role = 'owner' then 0 else 1 end, m.joined_at nulls last
  ), '[]'::jsonb)
  into members
  from public.clan_members m
  left join public.profiles pr on pr.id = m.user_id
  where m.clan_id = cid and m.status in ('joined', 'invited');

  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'tag', c.tag, 'owner_id', c.owner_id,
    'my_status', mystatus, 'created_at', c.created_at, 'members', members
  );
end;
$$;

create or replace function public.create_clan(p_name text, p_tag text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n text; t text; cid uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  n := nullif(trim(coalesce(p_name, '')), '');
  t := upper(nullif(trim(coalesce(p_tag, '')), ''));
  if n is null or t is null then raise exception 'Name and tag required'; end if;
  if char_length(n) < 3 or char_length(n) > 32 then raise exception 'Name must be 3–32 characters'; end if;
  if char_length(t) < 2 or char_length(t) > 5 then raise exception 'Tag must be 2–5 characters'; end if;
  if exists (select 1 from public.clan_members where user_id = uid and status = 'joined') then
    raise exception 'Leave your current clan first';
  end if;

  delete from public.clan_members where user_id = uid and status = 'invited';

  insert into public.clans (name, tag, owner_id) values (n, t, uid) returning id into cid;
  insert into public.clan_members (clan_id, user_id, role, status, joined_at)
  values (cid, uid, 'owner', 'joined', now());
  return public.get_my_clan();
end;
$$;

create or replace function public.invite_to_clan(p_friend_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_friend_id is null or p_friend_id = uid then raise exception 'Invalid invite target'; end if;
  if not public._party_are_friends(uid, p_friend_id) then
    raise exception 'You can only invite friends';
  end if;
  if public._party_is_blocked(uid, p_friend_id) then
    raise exception 'Cannot invite this player';
  end if;

  select c.id into cid
  from public.clans c
  join public.clan_members m on m.clan_id = c.id
  where m.user_id = uid and m.status = 'joined' and m.role in ('owner', 'officer')
  limit 1;
  if cid is null then raise exception 'Only clan officers can invite'; end if;

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

create or replace function public.respond_clan_invite(p_clan_id uuid, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
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

  update public.clan_members
    set status = 'joined', joined_at = now(), role = 'member'
    where clan_id = p_clan_id and user_id = uid;
  return public.get_my_clan();
end;
$$;

create or replace function public.leave_clan()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  was_owner boolean;
  new_owner uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select m.clan_id, (m.role = 'owner') into cid, was_owner
  from public.clan_members m
  where m.user_id = uid and m.status = 'joined' limit 1;

  if cid is null then
    delete from public.clan_members where user_id = uid and status = 'invited';
    return jsonb_build_object('ok', true, 'left', true);
  end if;

  update public.clan_members set status = 'left', role = 'member'
  where clan_id = cid and user_id = uid;

  if was_owner then
    select user_id into new_owner
    from public.clan_members
    where clan_id = cid and status = 'joined'
    order by joined_at nulls last limit 1;
    if new_owner is null then
      delete from public.clans where id = cid;
    else
      update public.clan_members set role = 'owner' where clan_id = cid and user_id = new_owner;
      update public.clans set owner_id = new_owner where id = cid;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'left', true);
end;
$$;

create or replace function public.disband_clan()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select id into cid from public.clans where owner_id = uid limit 1;
  if cid is null then raise exception 'Only the clan owner can disband'; end if;
  delete from public.clans where id = cid;
  return jsonb_build_object('ok', true, 'disbanded', true);
end;
$$;

revoke all on function public.get_my_clan() from public;
revoke all on function public.create_clan(text, text) from public;
revoke all on function public.invite_to_clan(uuid) from public;
revoke all on function public.respond_clan_invite(uuid, boolean) from public;
revoke all on function public.leave_clan() from public;
revoke all on function public.disband_clan() from public;
grant execute on function public.get_my_clan() to authenticated;
grant execute on function public.create_clan(text, text) to authenticated;
grant execute on function public.invite_to_clan(uuid) to authenticated;
grant execute on function public.respond_clan_invite(uuid, boolean) to authenticated;
grant execute on function public.leave_clan() to authenticated;
grant execute on function public.disband_clan() to authenticated;

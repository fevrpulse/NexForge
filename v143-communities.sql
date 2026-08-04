-- Discord-style Communities (servers) for NexForge.
-- Applied remotely as v143_communities.

create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  icon_color text not null default '#3B7EFF',
  owner_id uuid not null references auth.users (id) on delete cascade,
  invite_code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.community_members (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create table if not exists public.community_channels (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  kind text not null check (kind in ('text', 'voice')),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists community_channels_community_pos_idx
  on public.community_channels (community_id, position, created_at);

create table if not exists public.community_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.community_channels (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists community_messages_channel_created_idx
  on public.community_messages (channel_id, created_at desc);

create table if not exists public.community_voice_members (
  channel_id uuid not null references public.community_channels (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_channels enable row level security;
alter table public.community_messages enable row level security;
alter table public.community_voice_members enable row level security;

create or replace function public._is_community_member(p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.community_members m
    where m.community_id = p_community and m.user_id = auth.uid()
  );
$$;

create or replace function public._community_channel_community(p_channel uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select community_id from public.community_channels where id = p_channel;
$$;

revoke all on function public._is_community_member(uuid) from public, anon;
revoke all on function public._community_channel_community(uuid) from public, anon;
grant execute on function public._is_community_member(uuid) to authenticated;
grant execute on function public._community_channel_community(uuid) to authenticated;

drop policy if exists "communities_select_member" on public.communities;
create policy "communities_select_member"
  on public.communities for select to authenticated
  using (public._is_community_member(id) or owner_id = auth.uid());

drop policy if exists "community_members_select" on public.community_members;
create policy "community_members_select"
  on public.community_members for select to authenticated
  using (public._is_community_member(community_id));

drop policy if exists "community_channels_select" on public.community_channels;
create policy "community_channels_select"
  on public.community_channels for select to authenticated
  using (public._is_community_member(community_id));

drop policy if exists "community_messages_select" on public.community_messages;
create policy "community_messages_select"
  on public.community_messages for select to authenticated
  using (
    public._is_community_member(public._community_channel_community(channel_id))
  );

drop policy if exists "community_messages_insert" on public.community_messages;
create policy "community_messages_insert"
  on public.community_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public._is_community_member(public._community_channel_community(channel_id))
  );

drop policy if exists "community_voice_select" on public.community_voice_members;
create policy "community_voice_select"
  on public.community_voice_members for select to authenticated
  using (
    public._is_community_member(public._community_channel_community(channel_id))
  );

drop policy if exists "community_voice_insert" on public.community_voice_members;
create policy "community_voice_insert"
  on public.community_voice_members for insert to authenticated
  with check (
    user_id = auth.uid()
    and public._is_community_member(public._community_channel_community(channel_id))
  );

drop policy if exists "community_voice_delete" on public.community_voice_members;
create policy "community_voice_delete"
  on public.community_voice_members for delete to authenticated
  using (user_id = auth.uid());

create or replace function public.create_community(p_name text, p_icon_color text default '#3B7EFF')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  code text;
  ch_general uuid;
  ch_voice uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'Community name required';
  end if;

  code := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.communities (name, icon_color, owner_id, invite_code)
  values (trim(p_name), coalesce(nullif(trim(p_icon_color), ''), '#3B7EFF'), uid, code)
  returning id into cid;

  insert into public.community_members (community_id, user_id, role)
  values (cid, uid, 'owner');

  insert into public.community_channels (community_id, name, kind, position)
  values (cid, 'general', 'text', 0)
  returning id into ch_general;

  insert into public.community_channels (community_id, name, kind, position)
  values (cid, 'Lounge', 'voice', 1)
  returning id into ch_voice;

  return jsonb_build_object(
    'id', cid,
    'name', trim(p_name),
    'icon_color', coalesce(nullif(trim(p_icon_color), ''), '#3B7EFF'),
    'invite_code', code,
    'owner_id', uid,
    'general_channel_id', ch_general,
    'voice_channel_id', ch_voice
  );
end;
$$;

create or replace function public.join_community(p_invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  c public.communities%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into c from public.communities
  where invite_code = lower(trim(coalesce(p_invite_code, '')));
  if not found then raise exception 'Invalid invite code'; end if;

  insert into public.community_members (community_id, user_id, role)
  values (c.id, uid, 'member')
  on conflict (community_id, user_id) do nothing;

  return jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'icon_color', c.icon_color,
    'invite_code', c.invite_code,
    'owner_id', c.owner_id
  );
end;
$$;

create or replace function public.leave_community(p_community_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  owner uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select owner_id into owner from public.communities where id = p_community_id;
  if not found then raise exception 'Community not found'; end if;
  if owner = uid then
    raise exception 'Owner must delete the community instead of leaving';
  end if;
  delete from public.community_voice_members v
  using public.community_channels ch
  where v.user_id = uid and v.channel_id = ch.id and ch.community_id = p_community_id;
  delete from public.community_members
  where community_id = p_community_id and user_id = uid;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_community(p_community_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  delete from public.communities
  where id = p_community_id and owner_id = uid;
  if not found then raise exception 'Only the owner can delete this community'; end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.create_community_channel(
  p_community_id uuid,
  p_name text,
  p_kind text default 'text'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  role text;
  pos int;
  ch_id uuid;
  kind text := lower(trim(coalesce(p_kind, 'text')));
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if kind not in ('text', 'voice') then raise exception 'Channel kind must be text or voice'; end if;
  select m.role into role from public.community_members m
  where m.community_id = p_community_id and m.user_id = uid;
  if role is null then raise exception 'Not a community member'; end if;
  if role not in ('owner', 'admin') then raise exception 'Only admins can create channels'; end if;

  select coalesce(max(position), -1) + 1 into pos
  from public.community_channels where community_id = p_community_id;

  insert into public.community_channels (community_id, name, kind, position)
  values (p_community_id, trim(p_name), kind, pos)
  returning id into ch_id;

  return jsonb_build_object(
    'id', ch_id,
    'community_id', p_community_id,
    'name', trim(p_name),
    'kind', kind,
    'position', pos
  );
end;
$$;

create or replace function public.join_community_voice(p_channel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  comm uuid;
  ch_kind text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select c.community_id, c.kind into comm, ch_kind
  from public.community_channels c
  where c.id = p_channel_id;
  if not found then raise exception 'Channel not found'; end if;
  if ch_kind <> 'voice' then raise exception 'Not a voice channel'; end if;
  if not public._is_community_member(comm) then raise exception 'Not a community member'; end if;

  -- Leave other voice channels in this community first.
  delete from public.community_voice_members v
  using public.community_channels ch
  where v.user_id = uid
    and v.channel_id = ch.id
    and ch.community_id = comm
    and v.channel_id <> p_channel_id;

  insert into public.community_voice_members (channel_id, user_id)
  values (p_channel_id, uid)
  on conflict (channel_id, user_id) do update set joined_at = now();

  return jsonb_build_object('ok', true, 'channel_id', p_channel_id);
end;
$$;

create or replace function public.leave_community_voice(p_channel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  delete from public.community_voice_members
  where channel_id = p_channel_id and user_id = uid;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.create_community(text, text) to authenticated;
grant execute on function public.join_community(text) to authenticated;
grant execute on function public.leave_community(uuid) to authenticated;
grant execute on function public.delete_community(uuid) to authenticated;
grant execute on function public.create_community_channel(uuid, text, text) to authenticated;
grant execute on function public.join_community_voice(uuid) to authenticated;
grant execute on function public.leave_community_voice(uuid) to authenticated;

grant select on public.communities to authenticated;
grant select on public.community_members to authenticated;
grant select on public.community_channels to authenticated;
grant select, insert on public.community_messages to authenticated;
grant select, insert, delete on public.community_voice_members to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.community_messages;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.community_voice_members;
  exception when others then null;
  end;
end $$;

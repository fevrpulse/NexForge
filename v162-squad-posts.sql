-- v162: Public squad posts. Players write a title and details, then others can accept.
-- Apply in the Supabase SQL editor. Safe to re-run.

create table if not exists public.squad_posts (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  details text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.squad_accepts (
  post_id uuid not null references public.squad_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists squad_posts_open_idx
  on public.squad_posts (created_at desc)
  where status = 'open';

alter table public.squad_posts enable row level security;
alter table public.squad_accepts enable row level security;

revoke all on table public.squad_posts from public, anon, authenticated;
revoke all on table public.squad_accepts from public, anon, authenticated;

create or replace function public.post_squad(p_title text, p_details text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_details text := trim(coalesce(p_details, ''));
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 80 then
    raise exception 'Title must be 1–80 characters';
  end if;
  if char_length(v_details) < 1 or char_length(v_details) > 600 then
    raise exception 'Details must be 1–600 characters';
  end if;
  if exists (
    select 1 from public.squad_posts
    where host_id = auth.uid() and status = 'open'
  ) then
    raise exception 'Close your open squad post before posting another';
  end if;

  insert into public.squad_posts (host_id, title, details)
  values (auth.uid(), v_title, v_details)
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.list_squad_posts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(jsonb_agg(item order by (item->>'created_at') desc), '[]'::jsonb)
  into result
  from (
    select jsonb_build_object(
      'id', p.id,
      'title', p.title,
      'details', p.details,
      'host_id', p.host_id,
      'host_tag', coalesce(h.gamer_tag, 'Player'),
      'created_at', p.created_at,
      'is_host', p.host_id = auth.uid(),
      'accepted', exists (
        select 1 from public.squad_accepts a
        where a.post_id = p.id and a.user_id = auth.uid()
      ),
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
          'user_id', a.user_id,
          'gamer_tag', coalesce(pr.gamer_tag, 'Player')
        ) order by a.created_at)
        from public.squad_accepts a
        left join public.profiles pr on pr.id = a.user_id
        where a.post_id = p.id
      ), '[]'::jsonb)
    ) as item
    from public.squad_posts p
    left join public.profiles h on h.id = p.host_id
    where p.status = 'open'
  ) listed;

  return result;
end;
$$;

create or replace function public.accept_squad_post(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select host_id, status into v_host, v_status
  from public.squad_posts
  where id = p_post_id
  for update;

  if v_host is null then
    raise exception 'Squad post not found';
  end if;
  if v_status <> 'open' then
    raise exception 'This squad is no longer open';
  end if;
  if v_host = auth.uid() then
    raise exception 'You posted this squad';
  end if;

  insert into public.squad_accepts (post_id, user_id)
  values (p_post_id, auth.uid())
  on conflict (post_id, user_id) do nothing;

  return jsonb_build_object('id', p_post_id, 'accepted', true);
end;
$$;

create or replace function public.close_squad_post(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.squad_posts
    set status = 'closed',
        closed_at = now()
    where id = p_post_id
      and host_id = auth.uid()
      and status = 'open'
    returning id into v_id;

  if v_id is null then
    raise exception 'Only the player who posted can close this squad';
  end if;

  return jsonb_build_object('id', v_id, 'status', 'closed');
end;
$$;

revoke all on function public.post_squad(text, text) from public, anon;
revoke all on function public.list_squad_posts() from public, anon;
revoke all on function public.accept_squad_post(uuid) from public, anon;
revoke all on function public.close_squad_post(uuid) from public, anon;

grant execute on function public.post_squad(text, text) to authenticated;
grant execute on function public.list_squad_posts() to authenticated;
grant execute on function public.accept_squad_post(uuid) to authenticated;
grant execute on function public.close_squad_post(uuid) to authenticated;

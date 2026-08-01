-- v4 Phase 10: Companion home payload (mobile/web while desktop tracks)
-- Safe to re-run.

create table if not exists public.companion_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_label text,
  push_token text,
  platform text not null default 'web'
    check (platform in ('web', 'ios', 'android')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, push_token)
);

create index if not exists companion_devices_user_idx
  on public.companion_devices (user_id);

alter table public.companion_devices enable row level security;

drop policy if exists "Users manage own companion devices" on public.companion_devices;
create policy "Users manage own companion devices"
  on public.companion_devices for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.register_companion_device(
  p_platform text default 'web',
  p_device_label text default null,
  p_push_token text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  plat text := lower(trim(coalesce(p_platform, 'web')));
  token text := nullif(trim(coalesce(p_push_token, '')), '');
  label text := nullif(trim(coalesce(p_device_label, '')), '');
  rid uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if plat not in ('web', 'ios', 'android') then plat := 'web'; end if;

  if token is not null then
    insert into public.companion_devices (user_id, platform, device_label, push_token, last_seen_at)
    values (uid, plat, label, token, now())
    on conflict (user_id, push_token) do update set
      platform = excluded.platform,
      device_label = coalesce(excluded.device_label, companion_devices.device_label),
      last_seen_at = now()
    returning id into rid;
  else
    update public.companion_devices
      set last_seen_at = now(),
          device_label = coalesce(label, device_label),
          platform = plat
    where id = (
      select id from public.companion_devices
      where user_id = uid and push_token is null and platform = plat
      order by last_seen_at desc
      limit 1
    )
    returning id into rid;

    if rid is null then
      insert into public.companion_devices (user_id, platform, device_label, push_token, last_seen_at)
      values (uid, plat, coalesce(label, 'Companion'), null, now())
      returning id into rid;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', rid, 'platform', plat);
end;
$$;

create or replace function public.get_companion_home()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prof record;
  unread integer := 0;
  messages jsonb;
  party jsonb;
  lobby jsonb;
  clan jsonb;
  coach jsonb;
  tourneys jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select gamer_tag, mmr, custom_status, main_game
  into prof
  from public.profiles where id = uid;

  select count(*)::integer into unread
  from public.messages
  where recipient_id = uid and read_at is null;

  select coalesce(jsonb_agg(row_to_json(q)::jsonb), '[]'::jsonb)
  into messages
  from (
    select
      m.id,
      m.sender_id,
      m.body,
      m.created_at,
      m.read_at,
      coalesce(p.gamer_tag, 'Friend') as sender_tag
    from public.messages m
    left join public.profiles p on p.id = m.sender_id
    where m.recipient_id = uid
    order by m.created_at desc
    limit 12
  ) q;

  begin
    party := public.get_my_party();
  exception when others then
    party := null;
  end;

  begin
    lobby := public.get_my_lobby();
  exception when others then
    lobby := null;
  end;

  begin
    clan := public.get_my_clan();
  exception when others then
    clan := null;
  end;

  select jsonb_build_object(
    'tilt_score', cr.tilt_score,
    'summary', cr.summary,
    'generated_at', cr.generated_at
  )
  into coach
  from public.coach_reports cr
  where cr.user_id = uid;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  into tourneys
  from (
    select
      tm.id,
      tm.name,
      tm.game,
      tm.format,
      tm.starts_at,
      tm.status,
      exists (
        select 1 from public.tournament_checkins c
        where c.tournament_id = tm.id and c.user_id = uid
      ) as checked_in
    from public.tournaments tm
    where uid = any (coalesce(tm.registrations, '{}'::uuid[]))
      and coalesce(tm.status, 'open') <> 'completed'
    order by tm.starts_at nulls last
    limit 8
  ) t;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'gamer_tag', coalesce(prof.gamer_tag, 'Player'),
      'mmr', coalesce(prof.mmr, 1200),
      'custom_status', prof.custom_status,
      'main_game', prof.main_game
    ),
    'unread_count', unread,
    'messages', messages,
    'party', party,
    'lobby', lobby,
    'clan', clan,
    'coach', coach,
    'tournaments', tourneys,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.register_companion_device(text, text, text) from public;
revoke all on function public.get_companion_home() from public;
grant execute on function public.register_companion_device(text, text, text) to authenticated;
grant execute on function public.get_companion_home() to authenticated;

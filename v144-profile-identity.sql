-- Username (gamer_tag) + display name for profiles
alter table public.profiles
  add column if not exists display_name text;

alter table public.profiles
  drop constraint if exists profiles_display_name_check;

alter table public.profiles
  add constraint profiles_display_name_check
  check (display_name is null or char_length(btrim(display_name)) between 1 and 32);

create unique index if not exists profiles_gamer_tag_lower_uidx
  on public.profiles (lower(gamer_tag));

create or replace function public.update_profile_identity(
  p_gamer_tag text,
  p_display_name text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tag text;
  v_display text;
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  v_tag := regexp_replace(coalesce(trim(p_gamer_tag), ''), '[^a-zA-Z0-9_]', '', 'g');
  if char_length(v_tag) < 3 or char_length(v_tag) > 20 then
    raise exception 'Username must be 3–20 letters, numbers, or underscores';
  end if;

  v_display := nullif(btrim(coalesce(p_display_name, '')), '');
  if v_display is not null then
    v_display := left(v_display, 32);
  end if;

  if exists (
    select 1 from public.profiles
    where lower(gamer_tag) = lower(v_tag)
      and id <> v_uid
  ) then
    raise exception 'That username is already taken';
  end if;

  update public.profiles
  set gamer_tag = v_tag,
      display_name = v_display
  where id = v_uid
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Profile not found';
  end if;

  return v_row;
end;
$$;

revoke all on function public.update_profile_identity(text, text) from public;
grant execute on function public.update_profile_identity(text, text) to authenticated;

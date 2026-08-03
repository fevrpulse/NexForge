-- Service-role-only secret lookup for edge functions.
create or replace function public._internal_get_app_secret(p_name text)
returns text
language sql
security definer
set search_path = private, public
as $$
  select value from private.app_secrets where name = p_name limit 1;
$$;

revoke all on function public._internal_get_app_secret(text) from public;
revoke all on function public._internal_get_app_secret(text) from anon, authenticated;
grant execute on function public._internal_get_app_secret(text) to service_role;

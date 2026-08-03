-- Private secrets for edge functions (service_role only). Do not store API keys in git.
create schema if not exists private;

create table if not exists private.app_secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
grant usage on schema private to service_role;
grant all on all tables in schema private to service_role;

alter default privileges in schema private
  grant all on tables to service_role;

-- Set the live key via Dashboard SQL or MCP — never commit real values here:
-- insert into private.app_secrets (name, value) values ('groq_api_key', '…')
-- on conflict (name) do update set value = excluded.value, updated_at = now();

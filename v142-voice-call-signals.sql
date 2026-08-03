-- Voice call signaling via Postgres + Realtime (more reliable than broadcast-only).
-- Apply remotely as v142_voice_call_signals.

create table if not exists public.voice_call_signals (
  id bigserial primary key,
  call_id text not null,
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('ring', 'ready', 'offer', 'answer', 'ice', 'hangup', 'decline', 'busy')),
  body jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists voice_call_signals_recipient_created_idx
  on public.voice_call_signals (recipient_id, created_at desc);

create index if not exists voice_call_signals_call_created_idx
  on public.voice_call_signals (call_id, created_at);

alter table public.voice_call_signals enable row level security;

drop policy if exists "voice_call_signals_insert_own" on public.voice_call_signals;
create policy "voice_call_signals_insert_own"
  on public.voice_call_signals for insert
  to authenticated
  with check (sender_id = auth.uid());

drop policy if exists "voice_call_signals_select_own" on public.voice_call_signals;
create policy "voice_call_signals_select_own"
  on public.voice_call_signals for select
  to authenticated
  using (recipient_id = auth.uid() or sender_id = auth.uid());

drop policy if exists "voice_call_signals_delete_own" on public.voice_call_signals;
create policy "voice_call_signals_delete_own"
  on public.voice_call_signals for delete
  to authenticated
  using (recipient_id = auth.uid() or sender_id = auth.uid());

grant select, insert, delete on public.voice_call_signals to authenticated;
grant usage, select on sequence public.voice_call_signals_id_seq to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.voice_call_signals;
  exception
    when duplicate_object then null;
    when others then null;
  end;
end $$;

-- Opportunistic cleanup helper (safe to call from clients / cron later).
create or replace function public.cleanup_voice_call_signals()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.voice_call_signals
  where created_at < now() - interval '2 hours';
$$;

revoke all on function public.cleanup_voice_call_signals() from public, anon, authenticated;
grant execute on function public.cleanup_voice_call_signals() to service_role;

-- Presence (online + now playing), emoji reactions, and message deletion
-- Safe to re-run. Apply after message-replies-photos.sql.

-- ── PRESENCE ──
-- Clients heartbeat their own row; "online" = last_seen_at within ~2 minutes.
alter table public.profiles add column if not exists last_seen_at timestamptz;
alter table public.profiles add column if not exists playing_game text;

-- Profile updates are column-granted (security-hardening.sql); allow the presence fields too.
grant update (last_seen_at, playing_game) on table public.profiles to authenticated;

-- ── MESSAGE REACTIONS ──
create table if not exists public.message_reactions (
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

alter table public.message_reactions enable row level security;

drop policy if exists "Participants can view reactions" on public.message_reactions;
create policy "Participants can view reactions"
  on public.message_reactions for select
  to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and auth.uid() in (m.sender_id, m.recipient_id)
    )
  );

drop policy if exists "Participants can add own reactions" on public.message_reactions;
create policy "Participants can add own reactions"
  on public.message_reactions for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.messages m
      where m.id = message_id and auth.uid() in (m.sender_id, m.recipient_id)
    )
  );

drop policy if exists "Users can remove own reactions" on public.message_reactions;
create policy "Users can remove own reactions"
  on public.message_reactions for delete
  to authenticated
  using (auth.uid() = user_id);

-- ── MESSAGE DELETION ──
drop policy if exists "Senders can delete own messages" on public.messages;
create policy "Senders can delete own messages"
  on public.messages for delete
  to authenticated
  using (auth.uid() = sender_id);

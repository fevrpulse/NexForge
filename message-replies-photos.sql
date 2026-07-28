-- Message replies + photo attachments
-- Safe to re-run. Apply after friends-messages.sql.

-- ── MESSAGE COLUMNS ──
alter table public.messages
  add column if not exists reply_to_id bigint references public.messages(id) on delete set null;

alter table public.messages
  add column if not exists image_path text;

-- Allow image-only messages (empty body) and pin attachments to the sender's own storage folder.
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check
  check (char_length(body) <= 2000 and (char_length(body) > 0 or image_path is not null));

alter table public.messages drop constraint if exists messages_image_path_check;
alter table public.messages add constraint messages_image_path_check
  check (image_path is null or image_path like (sender_id::text || '/%'));

-- ── STORAGE BUCKET (private — access via signed URLs) ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload own chat images" on storage.objects;
create policy "Users can upload own chat images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Senders always see their own uploads; recipients see an image once a message references it.
drop policy if exists "Participants can view chat images" on storage.objects;
create policy "Participants can view chat images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-images'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.messages m
        where m.image_path = name and m.recipient_id = auth.uid()
      )
    )
  );

drop policy if exists "Users can delete own chat images" on storage.objects;
create policy "Users can delete own chat images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

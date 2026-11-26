-- One-off helper (2026-11-26): files left in storage from QA chats that were deleted before their files were.
-- Storage only lets the app delete a file a 'deleted' polo points at, so this puts back a placeholder chat per lost
-- folder, owned by a ZZTest person, with a 'deleted' polo per file. Then node scripts/clean-qa-remote.mjs deletes the
-- files and removes the placeholders like any QA leftovers. Only touches folders whose chat no longer exists.
with o as (
  select name, split_part(name, '/', 1) folder from storage.objects
   where bucket_id = 'holler' and name not like 'avatars/%'
     and split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
     and split_part(name, '/', 1) not in (select id::text from holler.chats)
     and name not in (select path from holler.polos where path is not null union select thumb_path from holler.polos where thumb_path is not null)),
p as (insert into holler.people (name, token_hash) values ('ZZTest purge', md5(random()::text || clock_timestamp()::text)) returning id),
c as (insert into holler.chats (id, invite_code, created_by)
        select distinct folder::uuid, 'zz' || left(md5(folder), 10), (select id from p) from o returning id),
x as (insert into holler.polos (chat_id, author_id, kind, status, path)
        select o.folder::uuid, (select id from p), 'video', 'deleted', o.name from o join c on c.id::text = o.folder returning 1)
select (select count(*) from c) chats, (select count(*) from x) files;

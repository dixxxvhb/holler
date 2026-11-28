-- Dry run of qa-clean-1.sql: runs it and rolls it back, to prove it still parses and runs. Keeps nothing.
begin;
-- QA cleanup step 1 (run by scripts/clean-qa-remote.mjs from the Neo, over and over until it returns no paths):
-- marks the QA people's hollers deleted, then lists up to 50 files still in storage that belong to them: anything in a
-- chat with only QA members (files are chat/polo.ext), plus any QA holler's files elsewhere. Reading storage itself means a
-- file is listed until it is really gone, and batches keep each reply under pc-run's output limit.
-- First: a QA holler the per-chat limit took out sits in a hold, and storage keeps a held file (supabase/limits.sql).
-- QA files have no hold, so it is cleared here; without this the file would be left behind when its chat goes.
-- Does nothing until limits.sql has been applied (the column is not there before that).
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'holler' and table_name = 'polos' and column_name = 'purge_after') then
    execute $q$update holler.polos set purge_after = null where purge_after is not null
               and author_id in (select id from holler.people where name in ('QA Bot','Avery QA','Blake QA') or name like 'ZZTest%')$q$;
  end if;
end $$;
with q as (select id from holler.people where name in ('QA Bot','Avery QA','Blake QA') or name like 'ZZTest%'),
  c as (select ch.id::text id from holler.chats ch
         where not exists (select 1 from holler.members m where m.chat_id = ch.id and m.person_id not in (select id from q))),
  d as (update holler.polos set status = 'deleted' where author_id in (select id from q) and status <> 'deleted' returning 1),
  f as (select o.name from storage.objects o where o.bucket_id = 'holler'
          and (split_part(o.name, '/', 1) in (select id from c)
               or o.name in (select x from holler.polos po, lateral (values (po.path), (po.thumb_path)) v(x)
                              where po.author_id in (select id from q) and x is not null))
        limit 50)
select coalesce((select json_agg(name) from f), '[]') paths, (select count(*) from d) marked;
rollback;
select 'qa-clean-1 runs' ok;

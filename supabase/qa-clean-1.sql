-- QA cleanup step 1 (run by scripts/clean-qa-remote.mjs from the Neo, over and over until it returns no paths):
-- marks the QA people's hollers deleted, then lists up to 50 files still in storage that belong to them: anything in a
-- chat with only QA members (files are chat/polo.ext), plus any QA holler's files elsewhere. Reading storage itself means a
-- file is listed until it is really gone, and batches keep each reply under pc-run's output limit.
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

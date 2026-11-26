-- QA cleanup step 2: chats with only QA members (games cascade), then the QA people. Files go between steps 1 and 2.
with q as (select id from holler.people where name in ('QA Bot','Avery QA','Blake QA') or name like 'ZZTest%'),
  c as (delete from holler.chats ch where not exists (select 1 from holler.members m where m.chat_id = ch.id and m.person_id not in (select id from q)) returning 1),
  p as (delete from holler.people where id in (select id from q) returning 1)
-- the *_before counts are from before this delete (a statement sees one snapshot)
select (select count(*) from c) chats, (select count(*) from p) people,
  (select count(*) from holler.people) people_before, (select count(*) from holler.games) games_before;

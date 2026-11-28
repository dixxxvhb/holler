-- Puts back every holler the limit took out whose file storage still has (that is, inside the hold, or any time
-- while the limit is switched off). Run limits-off.sql first, or the next daily run takes them out again.
-- A holler whose file is already gone cannot come back.
-- Putting a holler back must not ring anyone's phone ("X hollered"), so the new-holler push is off for the length
-- of this one statement; it is all one transaction, so the push is back on whatever happens.
begin;
alter table holler.polos disable trigger polos_notify;
update holler.polos po set status = 'ready', removed_at = null, purge_after = null, leaves_at = null
 where po.status = 'deleted' and po.removed_at is not null
   and exists (select 1 from storage.objects o where o.bucket_id = 'holler' and o.name = po.path);
alter table holler.polos enable trigger polos_notify;
commit;
select json_build_object(
  'still_out_file_gone', (select count(*) from holler.polos po where po.status = 'deleted' and po.removed_at is not null
                      and not exists (select 1 from storage.objects o where o.bucket_id = 'holler' and o.name = po.path)),
  'still_out_file_there', (select count(*) from holler.polos po where po.status = 'deleted' and po.removed_at is not null
                      and exists (select 1 from storage.objects o where o.bucket_id = 'holler' and o.name = po.path)),
  'push_trigger_on', (select tgenabled <> 'D' from pg_trigger where tgrelid = 'holler.polos'::regclass and tgname = 'polos_notify')) undone;

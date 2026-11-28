-- Switches the per-chat limit OFF: no more daily run, and every "leaving" mark on a holler still in its chat is
-- taken away, so nothing shows as leaving. Hollers already taken out stay out (see limits-undo.sql); their files
-- are no longer deleted, because nothing runs.
insert into holler.config values ('limit_on', '0') on conflict (key) do update set value = excluded.value;
select cron.unschedule(jobid) from cron.job where jobname = 'holler-limit';
with u as (update holler.polos set leaves_at = null where leaves_at is not null and status = 'ready' returning 1)
select json_build_object('limit_on', holler.limit_setting('limit_on', '0'), 'marks_cleared', (select count(*) from u),
  'job_left', (select count(*) from cron.job where jobname = 'holler-limit')) switched_off;

-- SWITCHES THE PER-CHAT LIMIT ON. Run only with Dixon's yes. See supabase/limits.sql for the rule.
-- From then on, once a day at 17:00 UTC (noon Eastern in winter), holler.limit_run('all') marks what has fallen
-- past each chat's 12 minutes, pings the chat, takes out what has been leaving for 3 days, and a day later asks
-- storage to delete those files. Undo: supabase/limits-off.sql (and limits-undo.sql for anything already taken out).
insert into holler.config values ('limit_on', '1') on conflict (key) do update set value = excluded.value;
select cron.unschedule(jobid) from cron.job where jobname = 'holler-limit';
select cron.schedule('holler-limit', '0 17 * * *', $$select holler.limit_run('all')$$);
select json_build_object('limit_on', holler.limit_setting('limit_on', '0'),
  'keep_seconds', holler.limit_setting('limit_keep_seconds', '720'), 'grace_days', holler.limit_setting('limit_grace_days', '3'),
  'hold_hours', holler.limit_setting('limit_hold_hours', '24'), 'saved_same', holler.limit_setting('limit_saved_same', '1'),
  'has_storage_key', exists (select 1 from holler.config where key = 'storage_key'),
  'job', (select json_agg(json_build_object('name', jobname, 'when', schedule, 'on', active)) from cron.job where jobname = 'holler-limit')) switched_on;

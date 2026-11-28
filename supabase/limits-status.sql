-- Read-only: where the per-chat limit stands. Switch, numbers, the daily job, what is leaving, the last runs,
-- how full storage is, and how each chat sits against its limit (chats by the first 8 characters of their id).
select json_build_object(
  'limit_on', holler.limit_setting('limit_on', '0'),
  'keep_seconds', holler.limit_setting('limit_keep_seconds', '720'), 'grace_days', holler.limit_setting('limit_grace_days', '3'),
  'hold_hours', holler.limit_setting('limit_hold_hours', '24'), 'saved_same', holler.limit_setting('limit_saved_same', '1'),
  'has_storage_key', exists (select 1 from holler.config where key = 'storage_key'),
  'job', (select json_agg(json_build_object('when', schedule, 'on', active)) from cron.job where jobname = 'holler-limit'),
  'storage_mb', (select round(sum(coalesce((metadata->>'size')::bigint, 0)) / 1e6, 1) from storage.objects where bucket_id = 'holler'),
  'leaving_now', (select count(*) from holler.polos where status = 'ready' and leaves_at is not null),
  'removed_in_their_hold', (select count(*) from holler.polos po where po.status = 'deleted' and po.purge_after > now()),
  'files_due_or_overdue', (select count(*) from storage.objects o join holler.polos po on (po.path = o.name or po.thumb_path = o.name)
                              where o.bucket_id = 'holler' and po.status = 'deleted' and po.purge_after <= now()),
  'chats', (select json_agg(x order by x.minutes desc) from (
     select left(po.chat_id::text, 8) chat, round((sum(holler.limit_seconds(po.duration)) / 60)::numeric, 1) minutes,
            count(*) hollers, count(*) filter (where po.leaves_at is not null) leaving
       from holler.polos po where po.status = 'ready' and po.kind in ('video', 'audio') and po.game_id is null group by po.chat_id) x),
  'last_runs', (select json_agg(x) from (select at, scope, report - 'removed' - 'hidden_game_clips' report,
                  jsonb_array_length(report->'removed') removed, jsonb_array_length(report->'hidden_game_clips') hidden_clips
                  from holler.limit_log order by id desc limit 5) x)
) status;

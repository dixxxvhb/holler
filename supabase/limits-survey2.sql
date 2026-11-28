-- Read-only: what the per-chat limit can lean on. Space used by every bucket in this project (the 1 GB is shared),
-- which pg_net calls exist, what is already scheduled, and which settings Holler holds (names only). Changes nothing.
select json_build_object(
  'buckets', (select json_agg(x) from (select bucket_id, count(*) files, round(sum(coalesce((metadata->>'size')::bigint, 0)) / 1e6, 1) mb from storage.objects group by 1 order by 3 desc) x),
  'net', (select json_agg(p.proname || '(' || pg_get_function_arguments(p.oid) || ')') from pg_proc p where p.pronamespace = 'net'::regnamespace and p.proname like 'http_%'),
  'cron', (select json_agg(json_build_object('name', jobname, 'when', schedule, 'on', active)) from cron.job),
  'config_keys', (select json_agg(key) from holler.config),
  'storage_triggers', (select json_agg(tgname) from pg_trigger where tgrelid = 'storage.objects'::regclass and not tgisinternal),
  'polo_cols', (select json_agg(column_name::text) from information_schema.columns where table_schema = 'holler' and table_name = 'polos'),
  'pg', version()
) report;

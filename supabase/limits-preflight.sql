-- Read-only: the three live functions limits.sql re-creates, as the database has them now, so they can be compared
-- with the repo before applying. Also whether the limit's columns or settings already exist. Changes nothing.
select json_build_object(
  'holler_chat', (select prosrc from pg_proc where oid = 'public.holler_chat(text,uuid)'::regprocedure),
  'polo_json', (select prosrc from pg_proc where oid = 'holler.polo_json(holler.polos)'::regprocedure),
  'holler_delete_ok', (select prosrc from pg_proc where oid = 'public.holler_delete_ok(text)'::regprocedure),
  'limit_cols', (select json_agg(column_name::text) from information_schema.columns where table_schema = 'holler' and table_name = 'polos' and column_name in ('leaves_at', 'removed_at', 'purge_after')),
  'config_keys', (select json_agg(key) from holler.config),
  'cron', (select count(*) from cron.job where jobname = 'holler-limit')
) report;

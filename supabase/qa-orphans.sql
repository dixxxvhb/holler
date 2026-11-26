-- Read-only: files in the holler bucket that nothing points at any more (no polo, no person's avatar).
-- These can only come from a cleanup that lost track of them. Lists counts and size, plus up to 5 names.
with refd as (
  select path n from holler.polos where path is not null
  union select thumb_path from holler.polos where thumb_path is not null
  union select avatar_path from holler.people where avatar_path is not null),
o as (select name, coalesce((metadata->>'size')::bigint, 0) sz, created_at from storage.objects
       where bucket_id = 'holler' and name not in (select n from refd))
select count(*) files, pg_size_pretty(sum(sz)) size, min(created_at) oldest, max(created_at) newest,
  (select json_agg(name) from (select name from o order by created_at desc limit 5) x) sample,
  (select count(*) from storage.objects where bucket_id = 'holler') all_files,
  (select pg_size_pretty(sum(coalesce((metadata->>'size')::bigint, 0))) from storage.objects where bucket_id = 'holler') all_size
from o;

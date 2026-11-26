-- QA cleanup step 1 (run by scripts/clean-qa-remote.mjs from the Neo, over and over until it returns no paths):
-- takes up to 40 of the QA people's hollers that still have files, marks them deleted, clears their paths, and lists those files.
-- Batches keep each reply under pc-run's output limit.
with q as (select id from holler.people where name in ('QA Bot','Avery QA','Blake QA') or name like 'ZZTest%'),
  pick as (select id, path, thumb_path from holler.polos
            where author_id in (select id from q) and (path is not null or thumb_path is not null) limit 40),
  u as (update holler.polos po set status = 'deleted', path = null, thumb_path = null
          from pick where po.id = pick.id returning pick.path, pick.thumb_path)
select coalesce(json_agg(p), '[]') paths from (select path p from u where path is not null union all select thumb_path from u where thumb_path is not null) t;

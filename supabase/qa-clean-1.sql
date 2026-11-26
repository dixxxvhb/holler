-- QA cleanup step 1 (run by scripts/clean-qa-remote.mjs from the Neo): mark QA people's hollers deleted and list their files.
with u as (update holler.polos set status = 'deleted'
            where author_id in (select id from holler.people where name in ('QA Bot','Avery QA','Blake QA') or name like 'ZZTest%')
            returning path, thumb_path)
select coalesce(json_agg(p), '[]') paths from (select path p from u where path is not null union all select thumb_path from u where thumb_path is not null) t;

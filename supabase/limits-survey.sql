-- Read-only: what Holler holds right now, for setting the picture quality and the per-chat limit.
-- No names: chats are shown by the first 8 characters of their id. Changes nothing.
with f as (select name, coalesce((metadata->>'size')::bigint, 0) sz from storage.objects where bucket_id = 'holler'),
qa as (select id from holler.people where name in ('QA Bot','Avery QA','Blake QA') or name like 'ZZTest%'),
po as (select p.*, f.sz from holler.polos p left join f on f.name = p.path where p.author_id not in (select id from qa)),
gp as (select distinct (j.value #>> '{}')::uuid id from holler.games g, lateral jsonb_path_query(g.state, '$.**.polo') j(value)
        where jsonb_typeof(j.value) = 'string' and (j.value #>> '{}') ~ '^[0-9a-f-]{36}$')
select json_build_object(
  'bucket', (select json_build_object('files', count(*), 'mb', round(sum(sz) / 1e6, 1)) from f),
  'by_status', (select json_agg(x) from (select status, kind, count(*) n, round(coalesce(sum(sz), 0) / 1e6, 1) mb,
                  round((sum(duration) / 60)::numeric, 1) minutes from po group by 1, 2 order by 1, 2) x),
  -- what real phones actually write: kilobits a second, by picture width and file type
  'rates', (select json_agg(x) from (select width w, split_part(mime, ';', 1) mime, coalesce(effects->>'hd', '-') hd, count(*) n,
              round(avg(sz * 8 / duration / 1000)::numeric) avg_kbps, round(min(sz * 8 / duration / 1000)::numeric) min_kbps,
              round(max(sz * 8 / duration / 1000)::numeric) max_kbps, round(max(duration)::numeric) longest_s, round(max(sz) / 1e6, 1) biggest_mb
              from po where status = 'ready' and kind = 'video' and duration > 8 and sz > 0 group by 1, 2, 3 order by 1, 2, 3) x),
  'audio_rates', (select json_build_object('n', count(*), 'avg_kbps', round(avg(sz * 8 / duration / 1000)::numeric))
              from po where status = 'ready' and kind = 'audio' and duration > 5 and sz > 0),
  -- each chat: how much video and voice it holds, and how much of that is saved by someone or belongs to a game
  'chats', (select json_agg(x order by x.minutes desc) from (select left(c.id::text, 8) chat,
              (select count(*) from holler.members m where m.chat_id = c.id) people,
              count(*) filter (where p.kind <> 'text') hollers, round((coalesce(sum(p.duration) filter (where p.kind <> 'text'), 0) / 60)::numeric, 1) minutes,
              round(coalesce(sum(p.sz), 0) / 1e6, 1) mb,
              round((coalesce(sum(p.duration) filter (where exists (select 1 from holler.saves s where s.polo_id = p.id)), 0) / 60)::numeric, 1) saved_min,
              round((coalesce(sum(p.duration) filter (where p.id in (select id from gp)), 0) / 60)::numeric, 1) game_min,
              round((coalesce(sum(p.duration) filter (where p.effects ? 'reactTo' or p.effects ? 'reaction'), 0) / 60)::numeric, 1) react_min,
              min(p.created_at)::date oldest
              from holler.chats c join po p on p.chat_id = c.id and p.status = 'ready' group by c.id) x),
  'deleted_still_stored', (select json_build_object('n', count(*), 'mb', round(coalesce(sum(sz), 0) / 1e6, 1)) from po where status = 'deleted' and sz > 0),
  'stuck_uploading', (select json_build_object('n', count(*), 'mb', round(coalesce(sum(sz), 0) / 1e6, 1)) from po where status = 'uploading' and created_at < now() - interval '1 day'),
  'saves', (select count(*) from holler.saves),
  'games', (select json_agg(x) from (select kind, status, saved_at is not null saved, holler.game_hidden(g) hidden, count(*) n from holler.games g group by 1, 2, 3, 4 order by 1, 2) x),
  'effect_keys', (select json_agg(distinct k) from po, lateral jsonb_object_keys(effects) k),
  'ext', (select json_agg(extname) from pg_extension where extname in ('pg_cron', 'pg_net'))
) report;

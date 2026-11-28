-- Dry run: limits.sql + limits-tests.sql. Built by scripts/build-limits-check.sh; aborts at the end on purpose.
-- Run: ssh pc "pwsh -NoProfile -File C:/Users/bowle/bin/pc-run.ps1 holler-sql limits-check.sql". Expect "LIMITS CHECK PASSED".
begin;
-- Holler per-chat limit (2026-11-28). BUILT, AND OFF.
--
-- Applying this file changes nothing anyone can see and removes nothing. The limit only does its work once
-- supabase/limits-on.sql has been run (it sets holler.config limit_on = '1' and schedules the daily run), and that
-- waits for Dixon's yes. supabase/limits-off.sql switches it back off and takes every "leaving" mark away.
--
-- The rule (Dixon, 11-27):
--   1. Each chat keeps its most recent 12 minutes of video and voice. Notes never count and are never touched.
--      Counting runs from the newest holler back; a holler stays while everything newer than it adds up to less
--      than 12 minutes, so a chat holds between 12 and 15 minutes.
--   2. A holler that falls past that is marked "leaving" for 3 days (polos.leaves_at). It still plays. The chat gets
--      one ping for the whole batch, and the app shows a card with one button each: Save to camera roll.
--   3. After the 3 days it is taken out of the chat (status = 'deleted', removed_at = now()).
--   4. Its file is deleted from storage a day after that (the hold). Until then the removal can be undone with
--      supabase/limits-undo.sql; after that it cannot.
--   5. Clips from a game that is already hidden (over for a week, reel not saved) are taken out the same way,
--      with no notice: nobody can see them any more.
--   6. Saved (open question for Dixon; limit_saved_same = '1' is the lead's pick): a saved holler follows the same
--      rule as any other, and the clips of a saved reel go on the leaving list a week after the game ended.
--      With limit_saved_same = '0', saved hollers and saved reels are left alone.
--
-- Settings live in holler.config (text). A missing row means the default.
--   limit_on            '1' = the real run does its work. Anything else, or missing: it does nothing at all.
--   limit_keep_seconds  720   how much video and voice a chat keeps
--   limit_grace_days    3     how long a holler is "leaving" before it is taken out
--   limit_hold_hours    24    how long a removed holler's file is kept before it is deleted for good
--   limit_saved_same    '1'   see 6
--   storage_key         the project's publishable key, so the database can ask storage to delete a file
--
-- Testing never touches a real person's holler: scope 'qa' only ever looks at chats named exactly 'ZZ limit test'
-- whose every member is a QA person, and it ignores limit_on. Scope 'all' is the real run.

alter table holler.polos add column if not exists leaves_at timestamptz;
alter table holler.polos add column if not exists removed_at timestamptz;
create index if not exists polos_leaving_idx on holler.polos (leaves_at) where leaves_at is not null;

-- every run that did anything is written down: what it marked, what it took out, which files it asked storage to delete
create table if not exists holler.limit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  scope text not null,
  report jsonb not null
);
revoke all on holler.limit_log from anon, authenticated, public;

create or replace function holler.limit_setting(p_key text, p_default text) returns text
language sql stable security definer set search_path = holler as $$
  select coalesce((select value from holler.config where key = p_key), p_default)
$$;

-- Which chats a run may look at.
create or replace function holler.limit_chats(p_scope text) returns setof uuid
language sql stable security definer set search_path = holler as $$
  select c.id from holler.chats c
   where p_scope = 'all'
      or (p_scope = 'qa'
          and c.name = 'ZZ limit test'
          and exists (select 1 from holler.members m where m.chat_id = c.id)
          and not exists (select 1 from holler.members m join holler.people p on p.id = m.person_id
                           where m.chat_id = c.id
                             and not (p.name in ('QA Bot', 'Avery QA', 'Blake QA') or p.name like 'ZZTest%')))
$$;

-- How long a holler counts for. A length that is missing or makes no sense counts as nothing, so one bad number
-- can never push a chat's other hollers out.
create or replace function holler.limit_seconds(p_duration real) returns real
language sql immutable as $$
  select case when p_duration > 0 and p_duration < 3600 then p_duration else 0 end
$$;

-- One run. Order matters: take out what is due, then mark what has newly fallen past the limit, then ping, then
-- ask storage to delete the files of what was taken out more than a hold ago.
-- The three override arguments are for scope 'qa' only; the real run reads its numbers from holler.config.
create or replace function holler.limit_run(p_scope text default 'all', p_keep_seconds int default null,
                                            p_grace interval default null, p_hold interval default null)
returns jsonb language plpgsql security definer set search_path = holler, extensions, public as $$
declare
  keep int; grace interval; hold interval; saved_same boolean;
  removed uuid[] := '{}'; hidden uuid[] := '{}'; marked jsonb := '{}'; marked_reels jsonb := '{}';
  files text[] := '{}'; skey text; psecret text; subs jsonb; cname text; msg text; ndays int; rec record; rep jsonb;
begin
  if p_scope is null or p_scope not in ('all', 'qa') then raise exception 'scope must be all or qa'; end if;

  if p_scope = 'all' then
    if holler.limit_setting('limit_on', '0') <> '1' then
      return jsonb_build_object('scope', 'all', 'on', false);
    end if;
    if p_keep_seconds is not null or p_grace is not null or p_hold is not null then
      raise exception 'the real run takes its numbers from holler.config only';
    end if;
    keep := holler.limit_setting('limit_keep_seconds', '720')::int;
    grace := make_interval(days => holler.limit_setting('limit_grace_days', '3')::int);
    hold := make_interval(hours => holler.limit_setting('limit_hold_hours', '24')::int);
    -- a slipped digit in a setting must not empty a chat: refuse numbers smaller than anyone would mean
    if keep < 300 or grace < interval '1 day' or hold < interval '1 hour' then
      raise exception 'limit settings look wrong (keep % s, grace %, hold %): not running', keep, grace, hold;
    end if;
  else
    keep := coalesce(p_keep_seconds, 720);
    grace := coalesce(p_grace, interval '3 days');
    hold := coalesce(p_hold, interval '24 hours');
  end if;
  saved_same := holler.limit_setting('limit_saved_same', '1') = '1';

  -- one run at a time
  if not pg_try_advisory_xact_lock(hashtext('holler.limit_run')) then
    return jsonb_build_object('scope', p_scope, 'on', true, 'busy', true);
  end if;

  -- 1. take out what has been leaving for the whole grace
  with gone as (
    update holler.polos po set status = 'deleted', removed_at = now()
     where po.status = 'ready' and po.kind in ('video', 'audio')
       and po.leaves_at is not null and po.leaves_at <= now()
       and po.chat_id in (select holler.limit_chats(p_scope))
    returning po.id)
  select coalesce(array_agg(id), '{}') into removed from gone;

  -- 1b. clips of games that are already hidden from everyone
  with gone as (
    update holler.polos po set status = 'deleted', removed_at = now()
      from holler.games g
     where po.game_id = g.id and po.status = 'ready' and po.kind in ('video', 'audio')
       and holler.game_hidden(g)
       and po.chat_id in (select holler.limit_chats(p_scope))
    returning po.id)
  select coalesce(array_agg(id), '{}') into hidden from gone;

  -- 2. mark what has newly fallen past the chat's limit. "newer" is the length of everything newer than this holler.
  with ranked as (
    select po.id,
           coalesce(sum(holler.limit_seconds(po.duration)) over (
             partition by po.chat_id order by po.created_at desc, po.id desc
             rows between unbounded preceding and 1 preceding), 0) as newer
      from holler.polos po
     where po.status = 'ready' and po.kind in ('video', 'audio') and po.game_id is null
       and po.chat_id in (select holler.limit_chats(p_scope))
       and (saved_same or not exists (select 1 from holler.saves s where s.polo_id = po.id))),
  hit as (
    update holler.polos po set leaves_at = now() + grace
      from ranked r
     where r.id = po.id and r.newer >= keep and po.leaves_at is null and po.status = 'ready'
    returning po.chat_id)
  select coalesce(jsonb_object_agg(chat_id, n), '{}') into marked
    from (select chat_id, count(*) n from hit group by chat_id) x;

  -- 2b. a saved reel, a week after its game ended: its clips go on the leaving list too (only when Saved follows the same rule)
  if saved_same then
    with hit as (
      update holler.polos po set leaves_at = now() + grace
        from holler.games g
       where po.game_id = g.id and po.status = 'ready' and po.kind in ('video', 'audio') and po.leaves_at is null
         and g.status <> 'playing' and g.saved_at is not null and g.ended_at <= now() - interval '7 days'
         and po.chat_id in (select holler.limit_chats(p_scope))
      returning po.chat_id)
    select coalesce(jsonb_object_agg(chat_id, n), '{}') into marked_reels
      from (select chat_id, count(*) n from hit group by chat_id) x;
  end if;

  -- 3. one ping per chat for this batch, to everyone in it who has notifications on and has not muted it
  begin
    select value into psecret from holler.config where key = 'push_secret';
    ndays := greatest(1, round(extract(epoch from grace) / 86400)::int);
    if psecret is not null then
      for rec in
        select k.chat_id, sum(k.n)::int n
          from (select key::uuid chat_id, value::int n from jsonb_each_text(marked)
                union all select key::uuid, value::int from jsonb_each_text(marked_reels)) k
         group by k.chat_id
      loop
        select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'sub', s.sub)) into subs
          from holler.members m join holler.push_subs s on s.person_id = m.person_id
         where m.chat_id = rec.chat_id and not m.muted;
        continue when subs is null;
        select nullif(name, '') into cname from holler.chats where id = rec.chat_id;
        msg := case when rec.n = 1 then '1 holler leaves' else rec.n || ' hollers leave' end
               || ' in ' || ndays || case when ndays = 1 then ' day' else ' days' end
               || '. Open the chat to save ' || case when rec.n = 1 then 'it' else 'any you want' end || ' to your camera roll.';
        perform net.http_post(
          url := 'https://swjqlfcqvcrnydpyjyog.supabase.co/functions/v1/holler-push',
          headers := jsonb_build_object('content-type', 'application/json', 'x-holler-secret', psecret),
          body := jsonb_build_object('title', coalesce(cname, 'Holler'), 'body', msg, 'chat', rec.chat_id,
                                     'url', '#/c/' || rec.chat_id, 'subs', subs));
      end loop;
    end if;
  exception when others then
    null; -- a ping that fails never stops the run
  end;

  -- 4. files of what this limit took out more than a hold ago, and that storage still has: ask storage to delete them.
  --    Only ever files of hollers this function itself removed (removed_at is set). Storage checks each one again
  --    against its own rule (the holler must be status 'deleted') before it lets go of it.
  select coalesce(array_agg(name), '{}') into files from (
    select o.name
      from storage.objects o
      join holler.polos po on (po.path = o.name or po.thumb_path = o.name)
     where o.bucket_id = 'holler' and po.status = 'deleted'
       and po.removed_at is not null and po.removed_at <= now() - hold
       and po.chat_id in (select holler.limit_chats(p_scope))
     order by po.removed_at, o.name
     limit 200) f;
  select value into skey from holler.config where key = 'storage_key';
  if skey is not null and coalesce(array_length(files, 1), 0) > 0 then
    begin
      perform net.http_delete(
        url := 'https://swjqlfcqvcrnydpyjyog.supabase.co/storage/v1/object/holler',
        headers := jsonb_build_object('apikey', skey, 'content-type', 'application/json'),
        body := jsonb_build_object('prefixes', to_jsonb(files)),
        timeout_milliseconds := 30000);
    exception when others then
      null; -- the next run asks again for whatever is still there
    end;
  end if;

  rep := jsonb_build_object('scope', p_scope, 'on', true, 'keep_seconds', keep, 'grace', grace::text, 'hold', hold::text,
    'saved_same', saved_same, 'removed', to_jsonb(removed), 'hidden_game_clips', to_jsonb(hidden),
    'marked', marked, 'marked_reels', marked_reels,
    'files_asked', coalesce(array_length(files, 1), 0), 'has_storage_key', skey is not null);
  if coalesce(array_length(removed, 1), 0) + coalesce(array_length(hidden, 1), 0) + coalesce(array_length(files, 1), 0) > 0
     or marked <> '{}'::jsonb or marked_reels <> '{}'::jsonb then
    insert into holler.limit_log (scope, report) values (p_scope, rep);
  end if;
  return rep;
end $$;

revoke all on function holler.limit_run(text, int, interval, interval), holler.limit_chats(text),
  holler.limit_setting(text, text), holler.limit_seconds(real) from public, anon, authenticated;

-- ---------- what the app reads ----------
-- A holler says when it leaves (null for nearly all of them, and for every one while the limit is off).
create or replace function holler.polo_json(po holler.polos) returns jsonb
language sql stable security definer set search_path = holler as $$
  select jsonb_build_object(
    'id', po.id, 'chat', po.chat_id, 'author', po.author_id, 'kind', po.kind, 'path', po.path,
    'thumb', po.thumb_path, 'mime', po.mime, 'duration', po.duration, 'w', po.width, 'h', po.height,
    'body', po.body, 'transcript', po.transcript, 'effects', po.effects, 'at', po.created_at,
    'reactTo', po.react_to, 'game', po.game_id, 'gameTurn', po.game_turn, 'leavesAt', po.leaves_at,
    'views', (select coalesce(jsonb_agg(jsonb_build_object('who', v.person_id, 'at', v.viewed_at)), '[]')
                from holler.views v where v.polo_id = po.id),
    'reactions', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'who', r.person_id, 'kind', r.kind, 't', r.at_sec) order by r.created_at), '[]')
                    from holler.reactions r where r.polo_id = po.id),
    'savedBy', (select coalesce(jsonb_agg(s.person_id), '[]') from holler.saves s where s.polo_id = po.id)
  )
$$;

-- The chat read: the same as before, plus 'leaving' (everything in this chat on its way out, soonest first; game
-- clips only from games that are over, which is the only time anyone can see them) and how much the chat keeps.
create or replace function public.holler_chat(p_token text, p_chat uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); gid uuid;
begin
  if not holler.is_member(p_chat, me) then raise exception 'not in this chat'; end if;
  for gid in select id from holler.games where chat_id = p_chat and status = 'playing' loop perform holler.game_tick(gid); end loop;
  return holler.chat_summary(p_chat, me) || jsonb_build_object(
    'polos', (select coalesce(jsonb_agg(holler.polo_json(po) order by po.created_at), '[]')
                from holler.polos po where po.chat_id = p_chat and po.status = 'ready' and po.game_id is null),
    'games', (select coalesce(jsonb_agg(holler.game_json(g, me) order by g.created_at), '[]')
                from holler.games g where g.chat_id = p_chat
                 and (g.status = 'playing' or g.saved_at is not null or g.ended_at > now() - interval '7 days')),
    'leaving', (select coalesce(jsonb_agg(holler.polo_json(po) order by po.leaves_at, po.created_at), '[]')
                  from holler.polos po
                 where po.chat_id = p_chat and po.status = 'ready' and po.leaves_at is not null
                   and (po.game_id is null
                        or exists (select 1 from holler.games g where g.id = po.game_id and g.status <> 'playing' and not holler.game_hidden(g)))),
    'keepSeconds', holler.limit_setting('limit_keep_seconds', '720')::int);
end $$;
-- ================= checks for limits.sql (this whole file aborts at the end, so nothing above or below is kept) =================
-- Made-up people, chats and hollers only. The one look at real chats (the dry run at the bottom) happens inside
-- its own block that is always rolled back, and reports counts only.
create or replace function pg_temp.mk(p_chat uuid, p_author uuid, p_kind text, p_secs real, p_ago interval, p_game uuid default null) returns uuid
language plpgsql as $$
declare pid uuid := gen_random_uuid();
begin
  insert into holler.polos (id, chat_id, author_id, kind, path, thumb_path, mime, duration, body, status, created_at, ready_at, game_id)
  values (pid, p_chat, p_author, p_kind,
          case when p_kind <> 'text' then p_chat || '/' || pid || '.mp4' end,
          case when p_kind = 'video' then p_chat || '/' || pid || '.jpg' end,
          case when p_kind <> 'text' then 'video/mp4' end, p_secs,
          case when p_kind = 'text' then 'a note' end, 'ready', now() - p_ago, now() - p_ago, p_game);
  if p_kind <> 'text' then insert into storage.objects (bucket_id, name, metadata) values ('holler', p_chat || '/' || pid || '.mp4', '{"size": 50000}'); end if;
  if p_kind = 'video' then insert into storage.objects (bucket_id, name, metadata) values ('holler', p_chat || '/' || pid || '.jpg', '{"size": 900}'); end if;
  return pid;
end $$;
create or replace function pg_temp.chat(p_name text, variadic p_people uuid[]) returns uuid
language plpgsql as $$
declare c uuid; x uuid;
begin
  insert into holler.chats (name, invite_code) values (p_name, 'ZZ' || substr(md5(random()::text), 1, 10)) returning id into c;
  foreach x in array p_people loop insert into holler.members (chat_id, person_id) values (c, x); end loop;
  return c;
end $$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'no error'; exception when others then return sqlerrm; end $$;

do $$
declare
  a uuid; b uuid; real_p uuid;
  cq uuid; c_real uuid; c_other uuid; c_saved uuid;
  v uuid[] := '{}'; aud uuid; note uuid; x uuid; rv uuid[] := '{}'; ov uuid[] := '{}'; sv uuid[] := '{}';
  g_hidden uuid; g_saved uuid; g_playing uuid; g_fresh uuid; k_hidden uuid; k_saved uuid; k_playing uuid; k_fresh uuid;
  rep jsonb; n int; t timestamptz; dry text; i int; real_before int; real_after int;
begin
  insert into holler.people (name, token_hash) values ('ZZTest A', 'zzt-' || gen_random_uuid()) returning id into a;
  insert into holler.people (name, token_hash) values ('ZZTest B', 'zzt-' || gen_random_uuid()) returning id into b;
  insert into holler.people (name, token_hash) values ('Zed Real', 'zzt-' || gen_random_uuid()) returning id into real_p;
  cq := pg_temp.chat('ZZ limit test', a, b);            -- in the test's reach
  c_real := pg_temp.chat('ZZ limit test', a, real_p);   -- same name, but a real person is in it: out of reach
  c_other := pg_temp.chat('Some other name', a, b);     -- QA people, wrong name: out of reach

  -- the same hollers in all three: six 3-minute videos an hour apart (v[6] newest), one older voice holler, one old note
  for i in 1..6 loop
    v := v || pg_temp.mk(cq, a, 'video', 180, make_interval(hours => 7 - i));
    rv := rv || pg_temp.mk(c_real, a, 'video', 180, make_interval(hours => 7 - i));
    ov := ov || pg_temp.mk(c_other, a, 'video', 180, make_interval(hours => 7 - i));
  end loop;
  aud := pg_temp.mk(cq, b, 'audio', 60, interval '8 hours');
  note := pg_temp.mk(cq, b, 'text', null, interval '9 hours');
  -- a holler with a nonsense length counts as nothing and so can never push the others out
  x := pg_temp.mk(cq, a, 'video', 999999, interval '30 minutes');

  -- games in the QA chat: hidden (over 8 days, not saved), saved reel over 8 days, still playing, over 2 days
  insert into holler.games (chat_id, kind, status, ended_at) values (cq, 'passiton', 'done', now() - interval '8 days') returning id into g_hidden;
  insert into holler.games (chat_id, kind, status, ended_at, saved_at, saved_by) values (cq, 'passiton', 'done', now() - interval '8 days', now() - interval '7 days', a) returning id into g_saved;
  insert into holler.games (chat_id, kind, status) values (cq, 'passiton', 'playing') returning id into g_playing;
  insert into holler.games (chat_id, kind, status, ended_at) values (cq, 'passiton', 'done', now() - interval '2 days') returning id into g_fresh;
  k_hidden := pg_temp.mk(cq, a, 'video', 10, interval '9 days', g_hidden);
  k_saved := pg_temp.mk(cq, a, 'video', 10, interval '9 days', g_saved);
  k_playing := pg_temp.mk(cq, a, 'video', 10, interval '9 days', g_playing);
  k_fresh := pg_temp.mk(cq, a, 'video', 10, interval '3 days', g_fresh);

  -- ---- 1. switched off: the real run does nothing at all ----
  delete from holler.config where key in ('limit_on', 'limit_keep_seconds', 'limit_grace_days', 'limit_hold_hours', 'limit_saved_same');
  select count(*) into real_before from holler.polos where status = 'ready';
  rep := holler.limit_run('all');
  assert rep = '{"scope": "all", "on": false}'::jsonb, 'off: says off, got ' || rep;
  assert (select count(*) from holler.polos where chat_id in (cq, c_real, c_other) and (leaves_at is not null or removed_at is not null or status <> 'ready')) = 0, 'off: nothing marked or removed';
  insert into holler.config values ('limit_on', '0');
  assert (holler.limit_run('all')->>'on')::boolean = false, 'off with 0: still off';
  delete from holler.config where key = 'limit_on';
  assert pg_temp.err($q$select holler.limit_run('everything')$q$) like '%scope must be all or qa%', 'bad scope refused';

  -- ---- 2. the QA run marks exactly what is past 12 minutes, and only in the QA chat ----
  select count(*) into n from holler.limit_log;
  rep := holler.limit_run('qa');
  -- newest first: x counts 0, v6 newer 0, v5 180, v4 360, v3 540, v2 720 (past), v1 900 (past), voice 1080 (past)
  assert (select array_agg(id order by created_at) from holler.polos where chat_id = cq and leaves_at is not null and game_id is null)
         = array[aud, v[1], v[2]], 'marks the voice holler and the two oldest videos, nothing else';
  assert (rep->'marked'->>cq::text)::int = 3, 'reports 3 marked, got ' || rep;
  assert (select leaves_at from holler.polos where id = v[1]) between now() + interval '3 days' - interval '1 minute' and now() + interval '3 days' + interval '1 minute', 'leaves in 3 days';
  assert (select leaves_at from holler.polos where id = note) is null and (select status from holler.polos where id = note) = 'ready', 'the note is never touched';
  assert (select count(*) from holler.polos where chat_id in (c_real, c_other) and (leaves_at is not null or status <> 'ready')) = 0, 'chats out of reach are untouched';
  assert (select count(*) from holler.polos where chat_id = cq and status <> 'ready' and id <> k_hidden) = 0, 'nothing leaves the chat on the day it is marked';
  -- games
  assert (select status from holler.polos where id = k_hidden) = 'deleted' and (select removed_at from holler.polos where id = k_hidden) is not null, 'a hidden game''s clip is taken out';
  assert rep->'hidden_game_clips' = to_jsonb(array[k_hidden]), 'and reported';
  assert (select leaves_at from holler.polos where id = k_saved) is not null and (select status from holler.polos where id = k_saved) = 'ready', 'a saved reel''s clip goes on the leaving list';
  assert (rep->'marked_reels'->>cq::text)::int = 1, 'reel clip reported';
  assert (select leaves_at is null and status = 'ready' from holler.polos where id = k_playing), 'a game in play keeps its clips';
  assert (select leaves_at is null and status = 'ready' from holler.polos where id = k_fresh), 'a game over for 2 days keeps its clips';
  assert (select count(*) from holler.limit_log) = n + 1, 'the run is written down';

  -- ---- 3. running again changes nothing ----
  select leaves_at into t from holler.polos where id = v[1];
  rep := holler.limit_run('qa');
  assert rep->'marked' = '{}'::jsonb and rep->'marked_reels' = '{}'::jsonb and rep->'removed' = '[]'::jsonb and rep->'hidden_game_clips' = '[]'::jsonb, 'second run finds nothing new, got ' || rep;
  assert (select leaves_at from holler.polos where id = v[1]) = t, 'the leaving date does not move';

  -- ---- 4. a newer holler pushes the next one out, and only that one ----
  x := pg_temp.mk(cq, b, 'video', 180, interval '1 minute');
  rep := holler.limit_run('qa');
  assert (rep->'marked'->>cq::text)::int = 1 and (select leaves_at from holler.polos where id = v[3]) is not null and (select leaves_at from holler.polos where id = v[4]) is null, 'one more in, one more out';

  -- ---- 5. after the grace it is taken out of the chat; its file waits out the hold ----
  update holler.polos set leaves_at = now() - interval '1 second' where id = v[1];
  rep := holler.limit_run('qa', 720, interval '3 days', interval '1 hour');
  assert rep->'removed' = to_jsonb(array[v[1]]), 'only the one that is due is removed, got ' || rep;
  assert (select status = 'deleted' and removed_at is not null from holler.polos where id = v[1]), 'removed means deleted with a time on it';
  assert (select status from holler.polos where id = v[2]) = 'ready', 'the one still in its 3 days stays';
  assert (select count(*) from storage.objects where name like cq || '/' || v[1] || '.%') = 2, 'its files are still there during the hold';
  -- the hidden game clip was removed in step 2, moments ago: it is inside the hold too
  assert (rep->>'files_asked')::int = 0, 'no file is asked for inside the hold, got ' || rep;
  assert public.holler_delete_ok(cq || '/' || v[1] || '.mp4') and not public.holler_delete_ok(cq || '/' || v[2] || '.mp4'), 'storage would let go of the removed one only';

  -- ---- 6. after the hold its two files are asked for, and nobody else's ----
  update holler.polos set removed_at = now() - interval '2 hours' where id = v[1];
  rep := holler.limit_run('qa', 720, interval '3 days', interval '1 hour');
  assert (rep->>'files_asked')::int = 2, 'video and thumbnail asked for, got ' || rep;
  -- a holler its author deleted (no removed_at) is not this function's business
  update holler.polos set status = 'deleted' where id = v[6];
  rep := holler.limit_run('qa', 720, interval '3 days', interval '0');
  assert (rep->>'files_asked')::int = 2 + 2, 'hold 0: the removed video and the hidden clip (2 files each), not the author-deleted one, got ' || rep;
  update holler.polos set status = 'ready' where id = v[6];

  -- ---- 7. Saved left alone when limit_saved_same is 0 ----
  c_saved := pg_temp.chat('ZZ limit test', a, b);
  for i in 1..6 loop sv := sv || pg_temp.mk(c_saved, a, 'video', 180, make_interval(hours => 7 - i)); end loop;
  insert into holler.saves (polo_id, person_id) values (sv[1], b);
  insert into holler.games (chat_id, kind, status, ended_at, saved_at, saved_by) values (c_saved, 'passiton', 'done', now() - interval '8 days', now() - interval '7 days', a) returning id into g_saved;
  k_saved := pg_temp.mk(c_saved, a, 'video', 10, interval '9 days', g_saved);
  insert into holler.config values ('limit_saved_same', '0');
  rep := holler.limit_run('qa');
  assert (select leaves_at from holler.polos where id = sv[1]) is null, 'a saved holler is left alone';
  assert (select leaves_at from holler.polos where id = sv[2]) is not null, 'the unsaved one past the limit still leaves';
  assert (select leaves_at from holler.polos where id = k_saved) is null, 'a saved reel is left alone';
  delete from holler.config where key = 'limit_saved_same';
  rep := holler.limit_run('qa');
  assert (select leaves_at from holler.polos where id = sv[1]) is not null and (select leaves_at from holler.polos where id = k_saved) is not null, 'with the same rule for Saved, both leave';

  -- ---- 8. what the app reads ----
  assert (holler.polo_json((select po from holler.polos po where id = v[2]))->>'leavesAt') is not null, 'a leaving holler says when';
  assert (holler.polo_json((select po from holler.polos po where id = v[5]))->>'leavesAt') is null, 'a staying holler says nothing';

  -- ---- 9. the real run refuses numbers nobody would mean, and overrides ----
  insert into holler.config values ('limit_on', '1'), ('limit_keep_seconds', '60');
  assert pg_temp.err($q$select holler.limit_run('all')$q$) like '%limit settings look wrong%', 'keep of 60 s refused';
  update holler.config set value = '720' where key = 'limit_keep_seconds';
  insert into holler.config values ('limit_grace_days', '0');
  assert pg_temp.err($q$select holler.limit_run('all')$q$) like '%limit settings look wrong%', 'grace of 0 days refused';
  delete from holler.config where key = 'limit_grace_days';
  assert pg_temp.err($q$select holler.limit_run('all', 10)$q$) like '%holler.config only%', 'the real run takes no overrides';

  -- ---- 10. dry run: what the real run would do today, switched on with the proposed numbers. Always rolled back. ----
  begin
    -- only real people's chats: the made-up ones go first
    delete from holler.chats where id in (cq, c_real, c_other, c_saved);
    rep := holler.limit_run('all');
    raise exception 'DRY %', jsonb_build_object(
      'would_mark', (select coalesce(jsonb_object_agg(left(key, 8), value), '{}') from jsonb_each(rep->'marked')),
      'would_remove_now', jsonb_array_length(rep->'removed'), 'hidden_game_clips', jsonb_array_length(rep->'hidden_game_clips'),
      'files_asked', rep->'files_asked', 'has_storage_key', rep->'has_storage_key');
  exception when others then
    dry := sqlerrm;
    if dry not like 'DRY %' then raise; end if;
  end;
  assert (select count(*) from holler.polos where chat_id not in (cq, c_real, c_other, c_saved) and (leaves_at is not null or removed_at is not null)) = 0, 'the dry run left real chats untouched';
  select count(*) into real_after from holler.polos where status = 'ready' and chat_id not in (cq, c_real, c_other, c_saved);

  raise exception 'LIMITS CHECK PASSED (nothing kept). Real run today: %', dry;
end $$;

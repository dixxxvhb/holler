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
--   4. Its file is deleted from storage a day after that (the hold, polos.purge_after). Until then the removal can
--      be undone with supabase/limits-undo.sql; after that it cannot. Storage itself refuses to let the file go
--      before the hold is over.
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
-- whose every member is a QA person and whose every holler was sent by one, and it ignores limit_on.
-- Scope 'all' is the real run.

alter table holler.polos add column if not exists leaves_at timestamptz;
alter table holler.polos add column if not exists removed_at timestamptz;
-- when storage may let go of a removed holler's file (removed_at + the hold). Storage itself checks this (below).
alter table holler.polos add column if not exists purge_after timestamptz;
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
-- A whole-number setting. Anything that is not a plain number reads as the default, so a typo in a setting can
-- never make the chat read (which uses this) fail.
create or replace function holler.limit_int(p_key text, p_default int) returns int
language sql stable security definer set search_path = holler as $$
  select coalesce((select case when value ~ '^[0-9]{1,6}$' then value::int end from holler.config where key = p_key), p_default)
$$;

-- The real run's read of a number: a setting that is there but is not a plain number stops the run, loudly, rather
-- than quietly becoming the default (someone meant a different number).
create or replace function holler.limit_int_strict(p_key text, p_default int) returns int
language plpgsql stable security definer set search_path = holler as $$
declare v text;
begin
  select value into v from holler.config where key = p_key;
  if v is null then return p_default; end if;
  if v !~ '^[0-9]{1,6}$' then raise exception 'limit setting % is not a plain number (%): not running', p_key, quote_literal(v); end if;
  return v::int;
end $$;

create or replace function holler.limit_is_qa(p_name text) returns boolean
language sql immutable as $$
  select p_name in ('QA Bot', 'Avery QA', 'Blake QA') or p_name like 'ZZTest%'
$$;

-- Which chats a run may look at. The test path needs all three: the test's own chat name, every member a QA person,
-- and every holler in it sent by a QA person (so a chat a real person once posted in is out of reach for good).
create or replace function holler.limit_chats(p_scope text) returns setof uuid
language sql stable security definer set search_path = holler as $$
  select c.id from holler.chats c
   where p_scope = 'all'
      or (p_scope = 'qa'
          and c.name = 'ZZ limit test'
          and exists (select 1 from holler.members m where m.chat_id = c.id)
          and not exists (select 1 from holler.members m join holler.people p on p.id = m.person_id
                           where m.chat_id = c.id and not holler.limit_is_qa(p.name))
          and not exists (select 1 from holler.polos po join holler.people p on p.id = po.author_id
                           where po.chat_id = c.id and not holler.limit_is_qa(p.name)))
$$;

-- How long a holler counts for. A length that is missing or makes no sense counts as nothing, so one bad number
-- can never push a chat's other hollers out.
create or replace function holler.limit_seconds(p_duration real) returns real
language sql immutable as $$
  select case when p_duration > 0 and p_duration < 3600 then p_duration else 0 end
$$;

-- One run. Every run works out afresh which hollers are past the limit, so a mark is never trusted on its own:
--   1. work out what is past the limit right now
--   2. take the mark off anything that no longer is (a newer holler was deleted, the number was raised, it was
--      saved and Saved is exempt)
--   3. a mark that is long overdue means the run was not happening (switched off by hand, a job that failed):
--      those get a fresh 3 days and a fresh ping instead of vanishing unannounced
--   4. take out what has been leaving for the whole grace; stamp when its file may go
--   5. mark what has newly fallen past the limit
--   6. one ping per chat for this batch
--   7. ask storage to delete the files whose hold is over
-- The three override arguments are for scope 'qa' only; the real run reads its numbers from holler.config.
create or replace function holler.limit_run(p_scope text default 'all', p_keep_seconds int default null,
                                            p_grace interval default null, p_hold interval default null)
returns jsonb language plpgsql security definer set search_path = holler, extensions, public as $$
declare
  keep int; grace interval; hold interval; saved_same boolean; g_slack interval; h_slack interval;
  past uuid[] := '{}'; reel uuid[] := '{}';
  removed uuid[] := '{}'; hidden uuid[] := '{}'; unmarked int := 0;
  marked jsonb := '{}'; marked_reels jsonb := '{}'; rewarned jsonb := '{}';
  files text[] := '{}'; skey text; psecret text; subs jsonb; cname text; msg text; ndays int; rec record; rep jsonb;
  pinged int := 0; ping_errors text[] := '{}'; req bigint; delete_error text; overdue int := 0;
begin
  if p_scope is null or p_scope not in ('all', 'qa') then raise exception 'scope must be all or qa'; end if;

  if p_scope = 'all' then
    if holler.limit_setting('limit_on', '0') <> '1' then
      return jsonb_build_object('scope', 'all', 'on', false);
    end if;
    if p_keep_seconds is not null or p_grace is not null or p_hold is not null then
      raise exception 'the real run takes its numbers from holler.config only';
    end if;
    keep := holler.limit_int_strict('limit_keep_seconds', 720);
    grace := make_interval(days => holler.limit_int_strict('limit_grace_days', 3));
    hold := make_interval(hours => holler.limit_int_strict('limit_hold_hours', 24));
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
  -- the run happens once a day, a few moments apart each time. Stamps are set half an hour short, so "3 days" is
  -- met by the run 3 days later rather than slipping to the day after (and the day the app shows is the real one).
  g_slack := case when grace >= interval '1 day' then interval '30 minutes' else interval '0' end;
  h_slack := case when hold >= interval '1 hour' then interval '30 minutes' else interval '0' end;

  -- one run at a time
  if not pg_try_advisory_xact_lock(hashtext('holler.limit_run')) then
    return jsonb_build_object('scope', p_scope, 'on', true, 'busy', true);
  end if;

  -- 1. what is past the limit right now. "newer" is the length of everything newer than this holler in its chat.
  select coalesce(array_agg(r.id), '{}') into past from (
    select po.id,
           coalesce(sum(holler.limit_seconds(po.duration)) over (
             partition by po.chat_id order by po.created_at desc, po.id desc
             rows between unbounded preceding and 1 preceding), 0) as newer
      from holler.polos po
     where po.status = 'ready' and po.kind in ('video', 'audio') and po.game_id is null
       and po.chat_id in (select holler.limit_chats(p_scope))
       and (saved_same or not exists (select 1 from holler.saves s where s.polo_id = po.id))) r
   where r.newer >= keep;
  -- and the clips of saved reels whose game ended a week ago or more (only when Saved follows the same rule)
  if saved_same then
    select coalesce(array_agg(po.id), '{}') into reel
      from holler.polos po join holler.games g on g.id = po.game_id
     where po.status = 'ready' and po.kind in ('video', 'audio')
       and g.status <> 'playing' and g.saved_at is not null and g.ended_at <= now() - interval '7 days'
       and po.chat_id in (select holler.limit_chats(p_scope));
  end if;

  -- 2. a mark on anything that is no longer past the limit comes off
  with u as (
    update holler.polos po set leaves_at = null
     where po.status = 'ready' and po.leaves_at is not null
       and po.chat_id in (select holler.limit_chats(p_scope))
       and po.id <> all(past) and po.id <> all(reel)
    returning 1)
  select count(*) into unmarked from u;

  -- 3. long overdue marks: the run was not happening. A fresh grace and a fresh ping, never a silent removal.
  with hit as (
    update holler.polos po set leaves_at = now() + grace - g_slack
     where po.status = 'ready' and po.leaves_at is not null and po.leaves_at < now() - interval '36 hours'
       and po.chat_id in (select holler.limit_chats(p_scope))
    returning po.chat_id)
  select coalesce(jsonb_object_agg(chat_id, n), '{}') into rewarned
    from (select chat_id, count(*) n from hit group by chat_id) x;

  -- 4. take out what has been leaving for the whole grace (after step 2, everything still marked is still past the limit)
  with gone as (
    update holler.polos po set status = 'deleted', removed_at = now(), purge_after = now() + hold - h_slack
     where po.status = 'ready' and po.kind in ('video', 'audio')
       and po.leaves_at is not null and po.leaves_at <= now()
       and (po.id = any(past) or po.id = any(reel))
       and po.chat_id in (select holler.limit_chats(p_scope))
    returning po.id)
  select coalesce(array_agg(id), '{}') into removed from gone;

  -- 4b. clips of games that are already hidden from everyone
  with gone as (
    update holler.polos po set status = 'deleted', removed_at = now(), purge_after = now() + hold - h_slack
      from holler.games g
     where po.game_id = g.id and po.status = 'ready' and po.kind in ('video', 'audio')
       and holler.game_hidden(g)
       and po.chat_id in (select holler.limit_chats(p_scope))
    returning po.id)
  select coalesce(array_agg(id), '{}') into hidden from gone;

  -- 5. mark what has newly fallen past the limit
  with hit as (
    update holler.polos po set leaves_at = now() + grace - g_slack
     where po.id = any(past) and po.leaves_at is null and po.status = 'ready'
    returning po.chat_id)
  select coalesce(jsonb_object_agg(chat_id, n), '{}') into marked
    from (select chat_id, count(*) n from hit group by chat_id) x;
  with hit as (
    update holler.polos po set leaves_at = now() + grace - g_slack
     where po.id = any(reel) and po.leaves_at is null and po.status = 'ready'
    returning po.chat_id)
  select coalesce(jsonb_object_agg(chat_id, n), '{}') into marked_reels
    from (select chat_id, count(*) n from hit group by chat_id) x;

  -- 6. one ping per chat for this batch, to everyone in it who has notifications on and has not muted it.
  --    The bar inside the chat is the notice everyone gets; the ping is the nudge. A ping that fails is written
  --    down and never stops the run or the other chats' pings.
  select value into psecret from holler.config where key = 'push_secret';
  ndays := greatest(1, round(extract(epoch from grace) / 86400)::int);
  for rec in
    select k.chat_id, sum(k.n)::int n
      from (select key::uuid chat_id, value::int n from jsonb_each_text(marked)
            union all select key::uuid, value::int from jsonb_each_text(marked_reels)
            union all select key::uuid, value::int from jsonb_each_text(rewarned)) k
     group by k.chat_id
  loop
    begin
      if psecret is null then ping_errors := array_append(ping_errors, 'no push_secret'); continue; end if;
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
                                   'url', '#/c/' || rec.chat_id || '/leaving', 'subs', subs));
      pinged := pinged + 1;
    exception when others then
      ping_errors := array_append(ping_errors, sqlerrm::text);
    end;
  end loop;

  -- 7. files of what this limit took out, whose hold is over, and that storage still has: ask storage to delete them.
  --    Only ever files of hollers this function itself removed (purge_after is set). Storage checks each one again
  --    against its own rule (status 'deleted' and the hold over, see holler_delete_ok below) before it lets go.
  select coalesce(array_agg(name), '{}') into files from (
    select o.name
      from storage.objects o
      join holler.polos po on (po.path = o.name or po.thumb_path = o.name)
     where o.bucket_id = 'holler' and po.status = 'deleted'
       and po.removed_at is not null and po.purge_after is not null and po.purge_after <= now()
       and po.chat_id in (select holler.limit_chats(p_scope))
     order by po.purge_after, o.name
     limit 200) f;
  -- files a past run already asked for and that are still there a day later: that ask did not work
  select count(*) into overdue
    from storage.objects o join holler.polos po on (po.path = o.name or po.thumb_path = o.name)
   where o.bucket_id = 'holler' and po.status = 'deleted' and po.purge_after is not null
     and po.purge_after <= now() - interval '26 hours'
     and po.chat_id in (select holler.limit_chats(p_scope));
  select value into skey from holler.config where key = 'storage_key';
  if coalesce(array_length(files, 1), 0) > 0 then
    if skey is null then
      delete_error := 'no storage_key';
    else
      begin
        select net.http_delete(
          url := 'https://swjqlfcqvcrnydpyjyog.supabase.co/storage/v1/object/holler',
          headers := jsonb_build_object('apikey', skey, 'content-type', 'application/json'),
          body := jsonb_build_object('prefixes', to_jsonb(files)),
          timeout_milliseconds := 30000) into req;
      exception when others then
        delete_error := sqlerrm; -- the next run asks again for whatever is still there
      end;
    end if;
  end if;

  rep := jsonb_build_object('scope', p_scope, 'on', true, 'keep_seconds', keep, 'grace', grace::text, 'hold', hold::text,
    'saved_same', saved_same, 'removed', to_jsonb(removed), 'hidden_game_clips', to_jsonb(hidden),
    'marked', marked, 'marked_reels', marked_reels, 'rewarned', rewarned, 'unmarked', unmarked,
    'pinged', pinged, 'ping_errors', to_jsonb(ping_errors),
    'files_due', coalesce(array_length(files, 1), 0), 'files_asked', case when req is not null then coalesce(array_length(files, 1), 0) else 0 end,
    'delete_request', req, 'delete_error', delete_error, 'files_overdue', overdue);
  if coalesce(array_length(removed, 1), 0) + coalesce(array_length(hidden, 1), 0) + coalesce(array_length(files, 1), 0) + unmarked + overdue > 0
     or marked <> '{}'::jsonb or marked_reels <> '{}'::jsonb or rewarned <> '{}'::jsonb then
    insert into holler.limit_log (scope, report) values (p_scope, rep);
  end if;
  return rep;
end $$;

revoke all on function holler.limit_run(text, int, interval, interval), holler.limit_chats(text),
  holler.limit_setting(text, text), holler.limit_int(text, int), holler.limit_int_strict(text, int), holler.limit_seconds(real), holler.limit_is_qa(text)
  from public, anon, authenticated;

-- Storage's own rule for letting go of a file (used by the holler_delete and holler_select_deleted policies in
-- holler.sql). As before: only files of a holler that is marked deleted. New: when the limit removed it, not until
-- its hold is over, so the undo window is real even for someone holding the key and the path. A holler its own
-- author deleted has no hold and goes at once, as it always has.
create or replace function public.holler_delete_ok(p_name text) returns boolean
language sql stable security definer set search_path = holler as $$
  select exists (select 1 from holler.polos po
                  where po.status = 'deleted' and (po.path = p_name or po.thumb_path = p_name)
                    and (po.purge_after is null or po.purge_after <= now()))
$$;

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
-- clips only from games that are over, which is the only time anyone can see them) and how much the chat keeps
-- (keepSeconds is null while the limit is off, so the app says nothing about a limit).
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
    'keepSeconds', case when holler.limit_setting('limit_on', '0') = '1' then holler.limit_int('limit_keep_seconds', 720) end);
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

create or replace function pg_temp.setc(p_key text, p_value text) returns void language plpgsql as $$
begin
  if p_value is null then delete from holler.config where key = p_key;
  else insert into holler.config values (p_key, p_value) on conflict (key) do update set value = excluded.value; end if;
end $$;

do $$
declare
  a uuid; b uuid; real_p uuid; tok text := 'zzt-token-' || gen_random_uuid();
  cq uuid; c_real uuid; c_other uuid; c_auth uuid; c_tie uuid; c_saved uuid;
  v uuid[] := '{}'; aud uuid; note uuid; x uuid; up uuid; t1 uuid; t2 uuid; t3 uuid; t0 uuid; sv uuid[] := '{}';
  g_hidden uuid; g_saved uuid; g_playing uuid; g_fresh uuid; k_hidden uuid; k_saved uuid; k_playing uuid; k_fresh uuid; k_saved2 uuid;
  rep jsonb; n int; q int; t timestamptz; dry text; i int; j jsonb; due timestamptz;
begin
  insert into holler.people (name, token_hash) values ('ZZTest A', encode(extensions.digest(tok, 'sha256'), 'hex')) returning id into a;
  insert into holler.tokens (token_hash, person_id) values (encode(extensions.digest(tok, 'sha256'), 'hex'), a);
  insert into holler.people (name, token_hash) values ('ZZTest B', 'zzt-' || gen_random_uuid()) returning id into b;
  insert into holler.people (name, token_hash) values ('Zed Real', 'zzt-' || gen_random_uuid()) returning id into real_p;
  -- B has notifications on (a made-up subscription; the request it causes is rolled back with everything else)
  insert into holler.push_subs (endpoint, person_id, sub) values ('https://example.invalid/zzt-' || gen_random_uuid(), b, '{"endpoint": "https://example.invalid/zzt"}');
  cq := pg_temp.chat('ZZ limit test', a, b);            -- in the test's reach
  c_real := pg_temp.chat('ZZ limit test', a, real_p);   -- same name, but a real person is in it: out of reach
  c_other := pg_temp.chat('Some other name', a, b);     -- QA people, wrong name: out of reach
  c_auth := pg_temp.chat('ZZ limit test', a, b);        -- right name, QA members, but a real person posted here and left: out of reach
  c_tie := pg_temp.chat('ZZ limit test', a, b);         -- in reach: two hollers at the same instant, and one with no length

  -- the same hollers in four chats: six 3-minute videos an hour apart (v[6] newest)
  for i in 1..6 loop
    v := v || pg_temp.mk(cq, a, 'video', 180, make_interval(hours => 7 - i));
    perform pg_temp.mk(c_real, a, 'video', 180, make_interval(hours => 7 - i));
    perform pg_temp.mk(c_other, a, 'video', 180, make_interval(hours => 7 - i));
    perform pg_temp.mk(c_auth, a, 'video', 180, make_interval(hours => 7 - i));
  end loop;
  perform pg_temp.mk(c_auth, real_p, 'video', 5, interval '10 hours');
  aud := pg_temp.mk(cq, b, 'audio', 60, interval '8 hours');
  note := pg_temp.mk(cq, b, 'text', null, interval '9 hours');
  -- a holler with a nonsense length counts as nothing and so can never push the others out
  x := pg_temp.mk(cq, a, 'video', 999999, interval '30 minutes');
  -- a holler still uploading is nobody's business, however old and long
  up := pg_temp.mk(cq, a, 'video', 500, interval '2 days');
  update holler.polos set status = 'uploading', ready_at = null where id = up;
  -- ties: two 400-second hollers at the very same instant, then a 100-second one, then one with no length at all
  t1 := pg_temp.mk(c_tie, a, 'video', 400, interval '1 hour');
  t2 := pg_temp.mk(c_tie, b, 'video', 400, interval '1 hour');
  update holler.polos set created_at = (select created_at from holler.polos where id = t1) where id = t2;
  t3 := pg_temp.mk(c_tie, a, 'video', 100, interval '2 hours');
  t0 := pg_temp.mk(c_tie, a, 'audio', null, interval '3 hours');

  -- games in the QA chat: hidden (over 8 days, not saved), saved reel over 8 days, still playing, over 2 days
  insert into holler.games (chat_id, kind, status, ended_at) values (cq, 'passiton', 'done', now() - interval '8 days') returning id into g_hidden;
  insert into holler.games (chat_id, kind, status, ended_at, saved_at, saved_by) values (cq, 'passiton', 'done', now() - interval '8 days', now() - interval '7 days', a) returning id into g_saved;
  insert into holler.games (chat_id, kind, status) values (cq, 'passiton', 'playing') returning id into g_playing;
  insert into holler.games (chat_id, kind, status, ended_at) values (cq, 'passiton', 'done', now() - interval '2 days') returning id into g_fresh;
  k_hidden := pg_temp.mk(cq, a, 'video', 10, interval '9 days', g_hidden);
  k_saved := pg_temp.mk(cq, a, 'video', 10, interval '9 days', g_saved);
  k_playing := pg_temp.mk(cq, a, 'video', 10, interval '9 days', g_playing);
  k_fresh := pg_temp.mk(cq, a, 'video', 10, interval '3 days', g_fresh);
  due := now() + interval '3 days' - interval '30 minutes';   -- what a fresh mark is stamped with

  -- ---- 1. switched off: the real run does nothing at all ----
  perform pg_temp.setc(k, null) from unnest(array['limit_on', 'limit_keep_seconds', 'limit_grace_days', 'limit_hold_hours', 'limit_saved_same']) k;
  rep := holler.limit_run('all');
  assert rep = '{"scope": "all", "on": false}'::jsonb, 'off: says off, got ' || rep;
  assert (select count(*) from holler.polos where chat_id in (cq, c_real, c_other, c_auth, c_tie) and (leaves_at is not null or removed_at is not null or status = 'deleted')) = 0, 'off: nothing marked or removed';
  perform pg_temp.setc('limit_on', '0');
  assert (holler.limit_run('all')->>'on')::boolean = false, 'off with 0: still off';
  perform pg_temp.setc('limit_on', null);
  assert pg_temp.err($q$select holler.limit_run('everything')$q$) like '%scope must be all or qa%', 'bad scope refused';
  -- the test's reach
  assert (select array_agg(c order by c) from holler.limit_chats('qa') c where c in (cq, c_real, c_other, c_auth, c_tie))
         = (select array_agg(c order by c) from unnest(array[cq, c_tie]) c), 'qa reach: not a chat with a real member, a real author, or another name';
  -- what the app reads while off: no limit to speak of
  j := public.holler_chat(tok, c_tie);
  assert j->'keepSeconds' = 'null'::jsonb and j->'leaving' = '[]'::jsonb and jsonb_array_length(j->'polos') = 4, 'chat read while off: no keepSeconds, nothing leaving, got ' || (j - 'polos' - 'members');

  -- ---- 2. the QA run marks exactly what is past 12 minutes, and only in the chats in reach ----
  select count(*) into n from holler.limit_log;
  rep := holler.limit_run('qa');
  -- newest first: x counts 0, v6 newer 0, v5 180, v4 360, v3 540, v2 720 (past), v1 900 (past), voice 1080 (past)
  assert (select array_agg(id order by created_at) from holler.polos where chat_id = cq and leaves_at is not null and game_id is null)
         = array[aud, v[1], v[2]], 'marks the voice holler and the two oldest videos, nothing else';
  assert (rep->'marked'->>cq::text)::int = 3, 'reports 3 marked, got ' || rep;
  assert (select leaves_at from holler.polos where id = v[1]) = due, 'leaves in 3 days (stamped half an hour short so the run 3 days on catches it)';
  assert (select leaves_at from holler.polos where id = note) is null and (select status from holler.polos where id = note) = 'ready', 'the note is never touched';
  assert (select status = 'uploading' and leaves_at is null from holler.polos where id = up), 'a holler still uploading is never touched';
  assert (select count(*) from holler.polos where chat_id in (c_real, c_other, c_auth) and (leaves_at is not null or status <> 'ready')) = 0, 'chats out of reach are untouched';
  assert (select count(*) from holler.polos where chat_id = cq and status = 'deleted' and id <> k_hidden) = 0, 'nothing leaves the chat on the day it is marked';
  -- ties and a missing length: t1 and t2 share an instant (one has 0 newer, the other 400), t3 has 800 newer, t0 900
  assert (select array_agg(id order by created_at) from holler.polos where chat_id = c_tie and leaves_at is not null) = array[t0, t3], 'ties break cleanly; a holler with no length can leave but never pushes';
  -- games
  assert (select status = 'deleted' and removed_at is not null and purge_after is not null from holler.polos where id = k_hidden), 'a hidden game''s clip is taken out';
  assert rep->'hidden_game_clips' = to_jsonb(array[k_hidden]), 'and reported';
  assert (select leaves_at = due and status = 'ready' from holler.polos where id = k_saved), 'a saved reel''s clip goes on the leaving list';
  assert (rep->'marked_reels'->>cq::text)::int = 1, 'reel clip reported';
  assert (select leaves_at is null and status = 'ready' from holler.polos where id = k_playing), 'a game in play keeps its clips';
  assert (select leaves_at is null and status = 'ready' from holler.polos where id = k_fresh), 'a game over for 2 days keeps its clips';
  assert (select count(*) from holler.limit_log) = n + 1, 'the run is written down';
  assert (rep->>'pinged')::int = 2 and rep->'ping_errors' = '[]'::jsonb, 'one ping for each chat with something newly leaving, no errors, got ' || rep;
  assert (select count(*) from net.http_request_queue r where r.url like '%/functions/v1/holler-push' and convert_from(r.body, 'UTF8') like '%' || cq || '/leaving%'
            and convert_from(r.body, 'UTF8') like '%4 hollers leave in 3 days. Open the chat to save any you want to your camera roll.%') = 1,
         'the ping for the QA chat is queued once, with the count, the days and the link to the list';

  -- ---- 3. running again changes nothing ----
  rep := holler.limit_run('qa');
  assert rep->'marked' = '{}'::jsonb and rep->'marked_reels' = '{}'::jsonb and rep->'rewarned' = '{}'::jsonb and rep->'removed' = '[]'::jsonb
     and rep->'hidden_game_clips' = '[]'::jsonb and (rep->>'unmarked')::int = 0, 'second run finds nothing new, got ' || rep;
  assert (select leaves_at from holler.polos where id = v[1]) = due, 'the leaving date does not move';

  -- ---- 3b. a mark is never trusted on its own: a newer holler is deleted by its author, so v2 is inside the 12 minutes again ----
  update holler.polos set status = 'deleted' where id = v[5];
  rep := holler.limit_run('qa');
  assert (rep->>'unmarked')::int = 1 and (select leaves_at from holler.polos where id = v[2]) is null, 'v2 is no longer past the limit: its mark comes off, got ' || rep;
  assert (select leaves_at from holler.polos where id = v[1]) = due and rep->'removed' = '[]'::jsonb, 'v1 is still past it and keeps its date';
  update holler.polos set status = 'ready' where id = v[5];
  rep := holler.limit_run('qa');
  assert (rep->'marked'->>cq::text)::int = 1 and (select leaves_at from holler.polos where id = v[2]) = due, 'and back on when it is past the limit again';

  -- ---- 4. a newer holler pushes the next one out, and only that one ----
  x := pg_temp.mk(cq, b, 'video', 180, interval '1 minute');
  rep := holler.limit_run('qa');
  assert (rep->'marked'->>cq::text)::int = 1 and (select leaves_at from holler.polos where id = v[3]) is not null and (select leaves_at from holler.polos where id = v[4]) is null, 'one more in, one more out';

  -- ---- 4b. a long overdue mark means the run was not happening: fresh 3 days, never a silent removal ----
  update holler.polos set leaves_at = now() - interval '5 days' where id = v[1];
  rep := holler.limit_run('qa');
  assert (rep->'rewarned'->>cq::text)::int = 1 and rep->'removed' = '[]'::jsonb, 'overdue by days: warned again, not removed, got ' || rep;
  assert (select status = 'ready' and leaves_at = due from holler.polos where id = v[1]), 'with a fresh date';

  -- ---- 5. after the grace it is taken out of the chat; its file waits out the hold, and storage holds it too ----
  update holler.polos set leaves_at = now() - interval '1 second' where id = v[1];
  rep := holler.limit_run('qa', 720, interval '3 days', interval '1 hour');
  assert rep->'removed' = to_jsonb(array[v[1]]), 'only the one that is due is removed, got ' || rep;
  assert (select status = 'deleted' and removed_at = now() and purge_after = now() + interval '30 minutes' from holler.polos where id = v[1]), 'removed: deleted, timed, and its file is held';
  assert (select status from holler.polos where id = v[2]) = 'ready', 'the one still in its 3 days stays';
  assert (select count(*) from storage.objects where name like cq || '/' || v[1] || '.%') = 2, 'its files are still there during the hold';
  assert (rep->>'files_due')::int = 0 and (rep->>'files_asked')::int = 0, 'no file is asked for inside the hold, got ' || rep;
  assert not public.holler_delete_ok(cq || '/' || v[1] || '.mp4') and not public.holler_delete_ok(cq || '/' || v[1] || '.jpg'), 'storage refuses the removed holler''s files inside the hold';
  assert not public.holler_delete_ok(cq || '/' || v[2] || '.mp4'), 'and of course a holler still in the chat';

  -- ---- 6. after the hold its two files are asked for, and nobody else's ----
  update holler.polos set purge_after = now() - interval '1 minute' where id = v[1];
  assert public.holler_delete_ok(cq || '/' || v[1] || '.mp4'), 'storage lets go once the hold is over';
  perform pg_temp.setc('storage_key', null);
  rep := holler.limit_run('qa');
  assert (rep->>'files_due')::int = 2 and (rep->>'files_asked')::int = 0 and rep->>'delete_error' = 'no storage_key', 'no key: says so, asks for nothing, got ' || rep;
  perform pg_temp.setc('storage_key', 'sb_publishable_not_a_real_key');
  rep := holler.limit_run('qa');
  assert (rep->>'files_due')::int = 2 and (rep->>'files_asked')::int = 2 and rep->'delete_request' <> 'null'::jsonb and rep->'delete_error' = 'null'::jsonb, 'video and thumbnail asked for, got ' || rep;
  assert exists (select 1 from net.http_request_queue r where r.id = (rep->>'delete_request')::bigint and r.method = 'DELETE' and r.url like '%/storage/v1/object/holler'), 'a DELETE to storage is queued (and rolled back with this check)';
  -- a holler its own author deleted has no hold: storage lets it go as it always has, and this function leaves it alone
  update holler.polos set status = 'deleted' where id = v[6];
  assert public.holler_delete_ok(cq || '/' || v[6] || '.mp4'), 'an author''s own delete is not held';
  rep := holler.limit_run('qa');
  assert (rep->>'files_due')::int = 2, 'the author-deleted holler''s files are not this function''s business, got ' || rep;
  update holler.polos set status = 'ready' where id = v[6];
  -- still there two days after it was due: a past ask did not work, and the report says so
  update holler.polos set purge_after = now() - interval '2 days' where id = v[1];
  rep := holler.limit_run('qa');
  assert (rep->>'files_overdue')::int = 2, 'overdue files are counted, got ' || rep;
  perform pg_temp.setc('storage_key', null);

  -- ---- 7. Saved left alone when limit_saved_same is 0, even when saved during the warning ----
  c_saved := pg_temp.chat('ZZ limit test', a, b);
  for i in 1..6 loop sv := sv || pg_temp.mk(c_saved, a, 'video', 180, make_interval(hours => 7 - i)); end loop;
  insert into holler.saves (polo_id, person_id) values (sv[1], b);
  insert into holler.games (chat_id, kind, status, ended_at, saved_at, saved_by) values (c_saved, 'passiton', 'done', now() - interval '8 days', now() - interval '7 days', a) returning id into g_saved;
  k_saved2 := pg_temp.mk(c_saved, a, 'video', 10, interval '9 days', g_saved);
  perform pg_temp.setc('limit_saved_same', '0');
  rep := holler.limit_run('qa');
  assert (select leaves_at from holler.polos where id = sv[1]) is null, 'a saved holler is left alone';
  assert (select leaves_at from holler.polos where id = sv[2]) is not null, 'the unsaved one past the limit still leaves';
  assert (select leaves_at from holler.polos where id = k_saved2) is null, 'a saved reel is left alone';
  assert (select leaves_at from holler.polos where id = k_saved) is null, 'and a reel clip marked earlier under the other setting is unmarked';
  insert into holler.saves (polo_id, person_id) values (sv[2], b);   -- someone saves it during its 3 days
  update holler.polos set leaves_at = now() - interval '1 second' where id = sv[2];   -- and it is even due
  rep := holler.limit_run('qa');
  assert (select status = 'ready' and leaves_at is null from holler.polos where id = sv[2]) and rep->'removed' = '[]'::jsonb, 'saved during the warning: kept, mark off, got ' || rep;
  delete from holler.saves where polo_id = sv[2];
  perform pg_temp.setc('limit_saved_same', null);
  rep := holler.limit_run('qa');
  assert (select leaves_at from holler.polos where id = sv[1]) is not null and (select leaves_at from holler.polos where id = k_saved2) is not null, 'with the same rule for Saved, both leave';

  -- ---- 8. what the app reads ----
  assert (holler.polo_json((select po from holler.polos po where id = v[2]))->>'leavesAt') is not null, 'a leaving holler says when';
  assert (holler.polo_json((select po from holler.polos po where id = v[5]))->>'leavesAt') is null, 'a staying holler says nothing';
  j := public.holler_chat(tok, c_saved);
  assert jsonb_array_length(j->'leaving') = (select count(*) from holler.polos where chat_id = c_saved and status = 'ready' and leaves_at is not null)
     and exists (select 1 from jsonb_array_elements(j->'leaving') e where e->>'id' = k_saved2::text), 'the chat read lists what is leaving, a finished saved reel''s clip included';
  assert not exists (select 1 from jsonb_array_elements(j->'polos') e where e->>'id' = k_saved2::text), 'and game clips still stay out of the thread';
  assert j->'keepSeconds' = 'null'::jsonb, 'keepSeconds stays null while the limit is off';
  perform pg_temp.setc('limit_on', '1');
  assert (public.holler_chat(tok, c_tie)->>'keepSeconds')::int = 720, 'keepSeconds once it is on';
  perform pg_temp.setc('limit_keep_seconds', '720s');
  assert (public.holler_chat(tok, c_tie)->>'keepSeconds')::int = 720, 'a mistyped setting never breaks the chat read';
  assert pg_temp.err($q$select holler.limit_run('all')$q$) like '%is not a plain number%', 'but the real run refuses a mistyped number instead of guessing';
  perform pg_temp.setc('limit_keep_seconds', '1200 ');
  assert pg_temp.err($q$select holler.limit_run('all')$q$) like '%is not a plain number%', 'a trailing space too';

  -- ---- 9. the real run refuses numbers nobody would mean, and overrides ----
  perform pg_temp.setc('limit_keep_seconds', '60');
  assert pg_temp.err($q$select holler.limit_run('all')$q$) like '%limit settings look wrong%', 'keep of 60 s refused';
  perform pg_temp.setc('limit_keep_seconds', null);
  perform pg_temp.setc('limit_grace_days', '0');
  assert pg_temp.err($q$select holler.limit_run('all')$q$) like '%limit settings look wrong%', 'grace of 0 days refused';
  perform pg_temp.setc('limit_grace_days', null);
  assert pg_temp.err($q$select holler.limit_run('all', 10)$q$) like '%holler.config only%', 'the real run takes no overrides';

  -- ---- 10. dry run: what the real run would do today, switched on with the proposed numbers. Always rolled back. ----
  begin
    -- only real people's chats: the made-up ones go first
    delete from holler.chats where id in (cq, c_real, c_other, c_auth, c_tie, c_saved);
    rep := holler.limit_run('all');
    raise exception 'DRY %', jsonb_build_object(
      'would_mark', (select coalesce(jsonb_object_agg(left(key, 8), value), '{}') from jsonb_each(rep->'marked')),
      'would_mark_reel_clips', (select coalesce(jsonb_object_agg(left(key, 8), value), '{}') from jsonb_each(rep->'marked_reels')),
      'would_remove_now', jsonb_array_length(rep->'removed'), 'hidden_game_clips', jsonb_array_length(rep->'hidden_game_clips'),
      'unmarked', rep->'unmarked', 'rewarned', rep->'rewarned', 'files_due', rep->'files_due', 'pinged', rep->'pinged', 'ping_errors', rep->'ping_errors');
  exception when others then
    dry := sqlerrm;
    if dry not like 'DRY %' then raise; end if;
  end;
  assert (select count(*) from holler.polos where chat_id not in (cq, c_real, c_other, c_auth, c_tie, c_saved) and (leaves_at is not null or removed_at is not null)) = 0, 'the dry run left real chats untouched';
  assert (select count(*) from holler.chats where id in (cq, c_real, c_other, c_auth, c_tie, c_saved)) = 6, 'and its block was rolled back';

  raise exception 'LIMITS CHECK PASSED (nothing kept). Real run today: %', dry;
end $$;

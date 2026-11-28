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
    keep := holler.limit_int('limit_keep_seconds', 720);
    grace := make_interval(days => holler.limit_int('limit_grace_days', 3));
    hold := make_interval(hours => holler.limit_int('limit_hold_hours', 24));
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
  holler.limit_setting(text, text), holler.limit_int(text, int), holler.limit_seconds(real), holler.limit_is_qa(text)
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

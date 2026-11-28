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
  assert (rep->>'pinged')::int = 0 and rep->'ping_errors' <> 'null'::jsonb, 'ping outcome is in the report, got ' || rep;

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

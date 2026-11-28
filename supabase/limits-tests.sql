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

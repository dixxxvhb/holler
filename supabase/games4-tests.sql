
-- ================= checks (this whole file aborts at the end, so nothing above is kept) =================
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'no error'; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.clip(p_tok text, p_chat uuid, p_fx jsonb) returns jsonb
language plpgsql as $$
declare p jsonb;
begin
  p := public.holler_start_polo(p_tok, p_chat, 'video', 'mp4', 'video/mp4', null);
  insert into storage.objects (bucket_id, name, metadata) values ('holler', p->>'path', '{"size": 50000}');
  return public.holler_finish_polo(p_tok, (p->>'id')::uuid, 9, 540, 960, null, p_fx, false);
end $$;

do $$
declare a jsonb; b jsonb; c jsonb; ta text; tb text; tc text; ida uuid; idb uuid; idc uuid; chat uuid; code text;
  g jsonb; gid uuid; e text; picks jsonb := '[{"pick": 1, "ms": 900}, {"pick": 0, "ms": 4000}, {"pick": -1, "ms": 10000}]';
begin
  a := public.holler_signup('QA Check A', '#ff7aa2'); ta := a->>'token'; ida := (a->'me'->>'id')::uuid;
  b := public.holler_signup('QA Check B', '#59c9ff'); tb := b->>'token'; idb := (b->'me'->>'id')::uuid;
  c := public.holler_signup('QA Check C', '#8fe3bd'); tc := c->>'token'; idc := (c->'me'->>'id')::uuid;
  chat := (public.holler_create_chat(ta, 'qa check')->>'id')::uuid;
  select invite_code into code from holler.chats where id = chat;
  perform public.holler_join(tb, code); perform public.holler_join(tc, code);

  -- ===== On The Spot =====
  e := pg_temp.err(format('select public.holler_game_start2(%L, %L, ''spot'', array[%L, %L]::uuid[], %L)', ta, chat, ida, idb,
         jsonb_build_object('qids', jsonb_build_object(ida, '["movies-01","tv-02","dance-03"]'::jsonb))));
  assert e = 'Pick the questions.', 'everyone needs questions: ' || e;
  g := public.holler_game_start2(ta, chat, 'spot', array[ida, idb], jsonb_build_object('deck', 'mixed', 'qids',
         jsonb_build_object(ida, '["movies-01","tv-02","dance-03"]'::jsonb, idb, '["pop-04","food-05","science-06"]'::jsonb)));
  gid := (g->>'id')::uuid;
  assert g->'qids' = 'null'::jsonb and jsonb_array_length(g->'todo') = 2, 'questions hidden until you start';
  e := pg_temp.err(format('select pg_temp.clip(%L, %L, %L)', ta, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'picks', picks))));
  assert e = 'Start your go first.', 'no clip before starting: ' || e;
  g := public.holler_game_begin(ta, gid);
  assert g->'qids' = '["movies-01","tv-02","dance-03"]'::jsonb, 'begin shows my three';
  assert public.holler_game(tb, gid)->'qids' = 'null'::jsonb, 'B still sees none';
  e := pg_temp.err(format('select pg_temp.clip(%L, %L, %L)', ta, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'picks', '[{"pick": 1}]'::jsonb))));
  assert e like 'That clip lost its answers%', 'all three answers: ' || e;
  perform pg_temp.clip(ta, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'picks', picks)));
  g := public.holler_game(tb, gid);
  assert jsonb_array_length(g->'takes') = 1 and g->'takes'->0->>'who' = ida::text and g->'takes'->0->'clip'->>'id' is not null
     and g->'takes'->0->'qids' = '["movies-01","tv-02","dance-03"]'::jsonb and (g->'takes'->0->'picks'->2->>'pick')::int = -1, 'B can watch A sweat';
  assert not exists (select 1 from jsonb_array_elements(public.holler_chat(tb, chat)->'polos') x where (x->>'game') is not null), 'spot clips stay out of the strip';
  e := pg_temp.err(format('select pg_temp.clip(%L, %L, %L)', ta, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'picks', picks))));
  assert e = 'You already went in this one.', 'one go each: ' || e;
  perform public.holler_game_begin(tb, gid);
  perform pg_temp.clip(tb, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'picks', picks)));
  g := public.holler_game(ta, gid);
  assert g->>'status' = 'done' and jsonb_array_length(g->'takes') = 2, 'both went: done';

  -- ===== Don't Laugh =====
  g := public.holler_game_start2(tb, chat, 'laugh', array[ida, idb, idc], '{"turnSec": 15}'); gid := (g->>'id')::uuid;
  assert jsonb_array_length(g->'todo') = 3 and (g->>'turnSec')::int = 15, 'laugh starts with everyone to do';
  perform pg_temp.clip(ta, chat, jsonb_build_object('game', jsonb_build_object('id', gid)));
  g := public.holler_game(tb, gid);
  assert g->'acted' = jsonb_build_array(ida) and g->'acts'->0->'clip'->>'id' is not null, 'A''s joke is in';
  e := pg_temp.err(format('select public.holler_game_laughed(%L, %L, %L, null)', ta, gid, ida));
  assert e = 'That one is yours.', 'cannot watch your own: ' || e;
  e := pg_temp.err(format('select public.holler_game_laughed(%L, %L, %L, null)', ta, gid, idc));
  assert e like 'They have not sent%', 'nothing to watch yet: ' || e;
  g := public.holler_game_laughed(tb, gid, ida, 3.24);
  assert (g->'acts'->0->'mine'->>'cracked')::numeric = 3.2 and (g->'acts'->0->'mine'->>'done')::boolean, 'B cracked at 3.2';
  assert public.holler_game(tc, gid)->'acts'->0->'results' = 'null'::jsonb, 'C sees nobody''s face before watching';
  assert public.holler_game(ta, gid)->'acts'->0->'results'->(idb::text)->>'cracked' = '3.2', 'A sees who cracked at theirs';
  perform pg_temp.clip(tb, chat, jsonb_build_object('reactTo', (public.holler_game(tb, gid)->'acts'->0->'clip'->>'id'), 'game', jsonb_build_object('id', gid, 'of', ida)));
  assert public.holler_game(ta, gid)->'acts'->0->'results'->(idb::text)->'clip'->>'id' is not null, 'B''s face clip is attached';
  e := pg_temp.err(format('select public.holler_game_laughed(%L, %L, %L, null)', tb, gid, ida));
  assert e = 'You already watched this one.', 'one watch each: ' || e;
  -- face clip can land before the result
  perform pg_temp.clip(tc, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'of', ida)));
  assert public.holler_game(tc, gid)->'acts'->0->'results' = 'null'::jsonb, 'a face clip alone is not a watch';
  perform public.holler_game_laughed(tc, gid, ida, null);
  perform pg_temp.clip(tb, chat, jsonb_build_object('game', jsonb_build_object('id', gid)));
  perform pg_temp.clip(tc, chat, jsonb_build_object('game', jsonb_build_object('id', gid)));
  assert (public.holler_chat(ta, chat)->>'yourTurn')::int >= 1, 'A owes two watches';
  perform public.holler_game_laughed(ta, gid, idb, null); perform public.holler_game_laughed(ta, gid, idc, 1.5);
  perform public.holler_game_laughed(tb, gid, idc, null);
  g := public.holler_game_laughed(tc, gid, idb, 7);
  assert g->>'status' = 'done' and jsonb_array_length(g->'acts') = 3, 'everyone watched everyone: done';
  -- nobody records for 48 hours: ended
  g := public.holler_game_start2(ta, chat, 'laugh', array[ida, idb], '{"turnSec": 10}');
  update holler.games set updated_at = now() - interval '49 hours' where id = (g->>'id')::uuid;
  assert public.holler_game(ta, (g->>'id')::uuid)->>'status' = 'ended', 'idle laugh ends';

  -- the older games still start through the new start
  g := public.holler_game_start2(ta, chat, 'trivia', array[ida, idb], '{"qids": ["movies-01","movies-02","tv-03","dance-04","pop-05"]}');
  assert g->>'kind' = 'trivia', 'trivia still starts';
  g := public.holler_game_start2(ta, chat, 'checkers', array[ida, idb], '{}');
  assert length(g->>'board') = 64, 'checkers still starts';

  raise exception 'GAMES4 CHECK PASSED (nothing kept)';
end $$;

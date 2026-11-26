
-- ================= checks (this whole file aborts at the end, so nothing above is kept) =================
-- games3-check.sql = begin; + games3.sql + this file. Rebuild it with scripts/build-check.sh after changing either.
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'no error'; exception when others then return sqlerrm; end $$;

do $$
declare a jsonb; b jsonb; c jsonb; ta text; tb text; tc text; ida uuid; idb uuid; idc uuid; chat uuid; code text;
  g jsonb; gid uuid; e text; bd text; i int;
begin
  a := public.holler_signup('QA Check A', '#ff7aa2'); ta := a->>'token'; ida := (a->'me'->>'id')::uuid;
  b := public.holler_signup('QA Check B', '#59c9ff'); tb := b->>'token'; idb := (b->'me'->>'id')::uuid;
  c := public.holler_signup('QA Check C', '#8fe3bd'); tc := c->>'token'; idc := (c->'me'->>'id')::uuid;
  chat := (public.holler_create_chat(ta, 'qa check')->>'id')::uuid;
  select invite_code into code from holler.chats where id = chat;
  perform public.holler_join(tb, code); perform public.holler_join(tc, code);

  -- ===== Tic-Tac-Toe =====
  e := pg_temp.err(format('select public.holler_game_start2(%L, %L, ''ttt'', array[%L, %L, %L]::uuid[], ''{}'')', ta, chat, ida, idb, idc));
  assert e like '%is for 2 people%', 'ttt needs exactly 2: ' || e;
  g := public.holler_game_start2(ta, chat, 'ttt', array[ida, idb], '{}');
  gid := (g->>'id')::uuid;
  assert g->>'board' = '.........' and g->>'turnPerson' = ida::text, 'ttt starts empty, first player up';
  assert (public.holler_chat(ta, chat)->>'yourTurn')::int = 1 and (public.holler_chat(tb, chat)->>'yourTurn')::int = 0, 'your turn counts the duel';
  e := pg_temp.err(format('select public.holler_game_move(%L, %L, %s, ''{"cell": 0}'')', tb, gid, (g->>'version')::int));
  assert e = 'It is not your move.', 'only the player up moves: ' || e;
  e := pg_temp.err(format('select public.holler_game_move(%L, %L, %s, ''{"cell": 0}'')', ta, gid, (g->>'version')::int + 5));
  assert e like 'The board changed%', 'stale version refused: ' || e;
  g := public.holler_game_move(ta, gid, (g->>'version')::int, '{"cell": 0}');
  assert g->>'board' = 'x........' and g->>'turnPerson' = idb::text, 'x placed, o up';
  e := pg_temp.err(format('select public.holler_game_move(%L, %L, %s, ''{"cell": 0}'')', tb, gid, (g->>'version')::int));
  assert e = 'That square is taken.', 'taken square refused: ' || e;
  g := public.holler_game_nudge(ta, gid);
  assert g->>'nudgedAt' is not null, 'duel nudge works';
  g := public.holler_game_move(tb, gid, (g->>'version')::int, '{"cell": 3}');
  g := public.holler_game_move(ta, gid, (g->>'version')::int, '{"cell": 1}');
  g := public.holler_game_move(tb, gid, (g->>'version')::int, '{"cell": 4}');
  g := public.holler_game_move(ta, gid, (g->>'version')::int, '{"cell": 2}');
  assert g->>'status' = 'done' and g->>'winner' = ida::text and g->>'result' = 'win', 'three in a row wins';
  e := pg_temp.err(format('select public.holler_game_move(%L, %L, %s, ''{"cell": 8}'')', tb, gid, (g->>'version')::int));
  assert e = 'This game is over.', 'no moves after the end: ' || e;
  -- a draw (rematch: B goes first)
  g := public.holler_game_start2(ta, chat, 'ttt', array[idb, ida], '{}'); gid := (g->>'id')::uuid;
  assert g->>'turnPerson' = idb::text, 'rematch: the other person goes first';
  foreach i in array array[0, 1, 2, 4, 3, 5, 7, 6, 8] loop
    g := public.holler_game_move(case when g->>'turnPerson' = ida::text then ta else tb end, gid, (g->>'version')::int, jsonb_build_object('cell', i));
  end loop;
  assert g->>'status' = 'done' and g->>'result' = 'draw' and g->>'winner' is null, 'full board, no line: draw';

  -- ===== Checkers =====
  g := public.holler_game_start2(tb, chat, 'checkers', array[ida, idb], '{}'); gid := (g->>'id')::uuid;
  bd := g->>'board';
  assert length(bd) = 64 and length(bd) - length(replace(bd, 'd', '')) = 12 and length(bd) - length(replace(bd, 'l', '')) = 12, 'checkers starts 12 and 12';
  assert g->>'turnPerson' = ida::text, 'first player moves first';
  e := pg_temp.err(format('select public.holler_game_move(%L, %L, %s, ''{"path": [17, 26]}'')', ta, gid, (g->>'version')::int));
  assert e = 'That is not your piece.', 'cannot move their piece: ' || e;
  e := pg_temp.err(format('select public.holler_game_move(%L, %L, %s, ''{"path": [42, 34]}'')', ta, gid, (g->>'version')::int));
  assert e like 'That %', 'straight move refused: ' || e;
  g := public.holler_game_move(ta, gid, (g->>'version')::int, '{"path": [42, 35]}');
  g := public.holler_game_move(tb, gid, (g->>'version')::int, '{"path": [21, 28]}');
  e := pg_temp.err(format('select public.holler_game_move(%L, %L, %s, ''{"path": [44, 37]}'')', ta, gid, (g->>'version')::int));
  assert e like '%jumps are a must%', 'forced capture: ' || e;
  g := public.holler_game_move(ta, gid, (g->>'version')::int, '{"path": [35, 21]}');
  bd := g->>'board';
  assert substr(bd, 29, 1) = '.' and substr(bd, 22, 1) = 'd' and (g->'last'->>'captured')::int = 1, 'jump takes the piece';
  g := public.holler_game_move(tb, gid, (g->>'version')::int, '{"path": [14, 28]}');
  assert length(g->>'board') - length(replace(g->>'board', 'd', '')) = 11, 'they jumped back';
  -- double jump, keep-jumping rule, and a win when the other side has nothing left
  update holler.games set state = state || jsonb_build_object('board',
    overlay(overlay(overlay(repeat('.', 64) placing 'd' from 50 for 1) placing 'l' from 43 for 1) placing 'l' from 29 for 1)), turn_person = ida
   where id = gid;
  g := public.holler_game(ta, gid);
  e := pg_temp.err(format('select public.holler_game_move(%L, %L, %s, ''{"path": [49, 35]}'')', ta, gid, (g->>'version')::int));
  assert e like 'Keep jumping%', 'must finish the jump: ' || e;
  g := public.holler_game_move(ta, gid, (g->>'version')::int, '{"path": [49, 35, 21]}');
  assert g->>'status' = 'done' and g->>'winner' = ida::text and (g->'last'->>'captured')::int = 2, 'double jump wins';
  -- crowning ends the move, and a king moves backwards
  g := public.holler_game_start2(ta, chat, 'checkers', array[ida, idb], '{}'); gid := (g->>'id')::uuid;
  update holler.games set state = state || jsonb_build_object('board',
    overlay(overlay(repeat('.', 64) placing 'd' from 11 for 1) placing 'l' from 40 for 1)) where id = gid;
  g := public.holler_game(ta, gid);
  g := public.holler_game_move(ta, gid, (g->>'version')::int, '{"path": [10, 1]}');
  assert substr(g->>'board', 2, 1) = 'D', 'a man on the far row is crowned';
  g := public.holler_game_move(tb, gid, (g->>'version')::int, '{"path": [39, 46]}');
  g := public.holler_game_move(ta, gid, (g->>'version')::int, '{"path": [1, 10]}');
  assert substr(g->>'board', 11, 1) = 'D', 'kings move back';
  -- giving up
  e := pg_temp.err(format('select public.holler_game_resign(%L, %L)', tc, gid));
  assert e = 'You are not in that game.', 'only players give up: ' || e;
  g := public.holler_game_resign(ta, gid);
  assert g->>'status' = 'done' and g->>'winner' = idb::text and g->>'result' = 'resign', 'giving up hands them the win';
  -- a duel nobody touches for a week ends
  g := public.holler_game_start2(ta, chat, 'checkers', array[ida, idb], '{}'); gid := (g->>'id')::uuid;
  update holler.games set turn_since = now() - interval '8 days' where id = gid;
  g := public.holler_game(tb, gid);
  assert g->>'status' = 'ended' and g->>'result' = 'idle', 'idle duel ends';

  -- ===== Seven Letters =====
  e := pg_temp.err(format('select public.holler_game_start2(%L, %L, ''words'', array[%L, %L]::uuid[], ''{"rack": "abc", "turnSec": 90}'')', ta, chat, ida, idb));
  assert e = 'Pick seven letters.', 'rack must be 7 letters: ' || e;
  g := public.holler_game_start2(ta, chat, 'words', array[ida, idb, idc], '{"rack": "eatrsin", "turnSec": 90}'); gid := (g->>'id')::uuid;
  assert g->'rack' = 'null'::jsonb, 'letters hidden until you start';
  e := pg_temp.err(format('select public.holler_game_play(%L, %L, ''{"words": ["rain"]}'')', tb, gid));
  assert e = 'Start your go first.', 'start before you play: ' || e;
  g := public.holler_game_begin(tb, gid);
  assert g->>'rack' = 'eatrsin' and (g->>'began')::boolean, 'begin shows the letters';
  assert public.holler_game(ta, gid)->'rack' = 'null'::jsonb, 'still hidden from someone who has not started';
  g := public.holler_game_play(tb, gid, '{"words": ["rain", "stain", "xyz", "ra", "rains", "rains", "teeee", "RAIN", "retains"]}');
  assert g->'myPlay'->'words' = '["rain", "rains", "retains", "stain"]'::jsonb, 'only real fits, once each: ' || (g->'myPlay'->'words')::text;
  assert g->'plays' ? idb::text and not (g->'plays' ? ida::text), 'you see plays once you have played';
  assert public.holler_game(ta, gid)->'plays' = 'null'::jsonb, 'nobody sees plays before their own go';
  e := pg_temp.err(format('select public.holler_game_play(%L, %L, ''{"words": ["tea"]}'')', tb, gid));
  assert e = 'You already played this one.', 'one go each: ' || e;
  assert (public.holler_chat(ta, chat)->>'yourTurn')::int >= 1, 'a quick round counts as your turn';
  perform public.holler_game_begin(ta, gid); perform public.holler_game_play(ta, gid, '{"words": ["tea", "eat"]}');
  perform public.holler_leave(tc, chat);
  g := public.holler_game(ta, gid);
  assert g->>'status' = 'done' and jsonb_array_length(g->'played') = 2, 'someone who left is not waited on';
  perform public.holler_join(tc, code);
  -- nobody plays for 48 hours: ended
  g := public.holler_game_start2(ta, chat, 'words', array[ida, idb], '{"rack": "eatrsin", "turnSec": 60}'); gid := (g->>'id')::uuid;
  update holler.games set state = jsonb_set(state, '{since}', to_jsonb(now() - interval '49 hours')) where id = gid;
  assert public.holler_game(ta, gid)->>'status' = 'ended', 'idle words round ends';

  -- ===== Trivia =====
  e := pg_temp.err(format('select public.holler_game_start2(%L, %L, ''trivia'', array[%L, %L]::uuid[], ''{"qids": ["x"]}'')', ta, chat, ida, idb));
  assert e = 'Pick the questions.', 'bad questions refused: ' || e;
  g := public.holler_game_start2(tb, chat, 'trivia', array[ida, idb],
         '{"deck": "mixed", "qids": ["movies-01","movies-02","tv-03","dance-04","pop-05","food-06","science-07","florida-08","words-09","random-10"]}');
  gid := (g->>'id')::uuid;
  assert g->'qids' = 'null'::jsonb, 'questions hidden until you start';
  g := public.holler_game_begin(ta, gid);
  assert jsonb_array_length(g->'qids') = 10, 'begin shows the questions';
  e := pg_temp.err(format('select public.holler_game_play(%L, %L, ''{"answers": [{"pick": 1, "ms": 900}]}'')', ta, gid));
  assert e = 'Answer every question.', 'all ten answers: ' || e;
  g := public.holler_game_play(ta, gid, (select jsonb_build_object('answers', jsonb_agg(jsonb_build_object('pick', k % 4, 'ms', 1000 + k))) from generate_series(1, 10) k));
  assert jsonb_array_length(g->'myPlay'->'answers') = 10 and g->>'status' = 'playing', 'answers kept, waiting on B';
  perform public.holler_game_begin(tb, gid);
  g := public.holler_game_play(tb, gid, (select jsonb_build_object('answers', jsonb_agg(jsonb_build_object('pick', 9, 'ms', 'x'))) from generate_series(1, 10) k));
  assert g->>'status' = 'done' and (g->'plays'->ida::text->'answers'->0->>'pick')::int = 1 and (g->'myPlay'->'answers'->0->>'pick')::int = -1, 'bad picks become no answer; done';

  -- the old games still go through the dispatchers
  g := public.holler_game_start(ta, chat, 'passiton', array[ida, idb, idc], 10, 'a ghost trying on jeans', 'act:1');
  assert g->>'phrase' = 'a ghost trying on jeans' and g->>'kind' = 'passiton', 'pass it on still starts';
  g := public.holler_game_start2(tb, chat, 'charades', array[ida, idb], '{"turnSec": 10}');
  assert g->>'kind' = 'charades' and jsonb_array_length(g->'todo') = 2, 'charades still starts';
  -- six at once is the cap
  for i in 1 .. 6 loop
    begin perform public.holler_game_start2(ta, chat, 'ttt', array[ida, idb], '{}'); exception when others then e := sqlerrm; end;
  end loop;
  assert e like 'This chat already has 6 games%', 'cap at 6: ' || e;

  raise exception 'GAMES3 CHECK PASSED (nothing kept)';
end $$;

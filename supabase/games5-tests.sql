
-- ================= checks (this whole file aborts at the end, so nothing above is kept) =================
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'no error'; exception when others then return sqlerrm; end $$;
-- set the cards by hand so the checks know what is where
create or replace function pg_temp.rig(p_game uuid, p_hands jsonb, p_deck jsonb, p_top text) returns void language sql as $$
  update holler.games set secret = jsonb_build_object('deck', p_deck, 'discard', '[]'::jsonb, 'hands', p_hands),
    state = state || jsonb_build_object('top', p_top, 'color', left(p_top, 1), 'drew', false) where id = p_game
$$;

do $$
declare a jsonb; b jsonb; c jsonb; ta text; tb text; tc text; ida uuid; idb uuid; idc uuid; chat uuid; code text;
  g jsonb; gid uuid; e text; v int; deck jsonb;
begin
  a := public.holler_signup('QA Check A', '#ff7aa2'); ta := a->>'token'; ida := (a->'me'->>'id')::uuid;
  b := public.holler_signup('QA Check B', '#59c9ff'); tb := b->>'token'; idb := (b->'me'->>'id')::uuid;
  c := public.holler_signup('QA Check C', '#8fe3bd'); tc := c->>'token'; idc := (c->'me'->>'id')::uuid;
  chat := (public.holler_create_chat(ta, 'qa check')->>'id')::uuid;
  select invite_code into code from holler.chats where id = chat;
  perform public.holler_join(tb, code); perform public.holler_join(tc, code);

  -- the deck
  deck := holler.lc_deck();
  assert jsonb_array_length(deck) = 108, 'deck has 108';
  assert (select count(*) from jsonb_array_elements_text(deck) x where x = 'xf') = 4, 'four wild draw fours';
  assert (select count(*) from jsonb_array_elements_text(deck) x where x = 'r0') = 1 and
         (select count(*) from jsonb_array_elements_text(deck) x where x = 'b7') = 2, 'one zero, two sevens';
  assert holler.lc_ok('r5', 'b5', 'b') and holler.lc_ok('r2', 'r9', 'r') and holler.lc_ok('xw', 'g3', 'g')
     and not holler.lc_ok('r5', 'b6', 'b') and holler.lc_ok('rs', 'gs', 'g') and not holler.lc_ok('rw', 'xw', 'b')
     and holler.lc_ok('b4', 'xf', 'b') and not holler.lc_ok('r4', 'xf', 'b'), 'matching rules';

  -- start
  e := pg_temp.err(format('select public.holler_card_start(%L, %L, array[%L]::uuid[])', ta, chat, ida));
  assert e = 'Last Card needs 2 to 6 people.', 'needs two: ' || e;
  g := public.holler_card_start(ta, chat, array[ida, idb, idc]);
  gid := (g->>'id')::uuid;
  assert jsonb_array_length(g->'hand') = 7 and (g->'counts'->>idb::text)::int = 7, 'seven each';
  assert (g->>'deckLeft')::int = 108 - 21 - 1, 'deck after the deal';
  assert g->>'top' ~ '^[rygb][0-9]$', 'first card is a number';
  assert g->'hands' = 'null'::jsonb, 'nobody sees other hands while playing';
  assert (select secret->'hands'->>idb::text from holler.games where id = gid) = (public.holler_game(tb, gid)->'hand')::text, 'B sees exactly their own hand';
  assert g->>'turnPerson' = ida::text, 'starter goes first';

  -- rig: A has r5 r2 rs xw b1, B has b9 g9 y1 y2, C has g1 g2 g3
  perform pg_temp.rig(gid, jsonb_build_object(ida, '["r5","r2","rs","xw","b1"]'::jsonb, idb, '["b9","g9","y1","y2"]'::jsonb, idc, '["g1","g2","g3"]'::jsonb),
    '["y5","rd","g7","b2","b3","b4","b5","b6","b7"]'::jsonb, 'r9');
  select version into v from holler.games where id = gid;
  e := pg_temp.err(format('select public.holler_card_move(%L, %L, %s, %L)', tb, gid, v, '{"play": "b9"}'));
  assert e = 'It is not your turn.', 'turn check: ' || e;
  e := pg_temp.err(format('select public.holler_card_move(%L, %L, %s, %L)', ta, gid, v, '{"play": "b1"}'));
  assert e = 'That card does not match.', 'match check: ' || e;
  e := pg_temp.err(format('select public.holler_card_move(%L, %L, %s, %L)', ta, gid, v, '{"play": "g9"}'));
  assert e = 'That card is not in your hand.', 'hand check: ' || e;
  e := pg_temp.err(format('select public.holler_card_move(%L, %L, %s, %L)', ta, gid, v - 1, '{"play": "r5"}'));
  assert e = 'The cards changed. Have another look.', 'version check: ' || e;
  e := pg_temp.err(format('select public.holler_card_move(%L, %L, %s, %L)', ta, gid, v, '{"play": "xw"}'));
  assert e = 'Pick a color.', 'wild needs a color: ' || e;

  -- A plays Skip: B is skipped, C is up
  g := public.holler_card_move(ta, gid, v, '{"play": "rs"}');
  assert g->>'turnPerson' = idc::text and g->'last'->>'skip' = idb::text, 'skip skips B';
  -- C cannot match red: draws y5 (no match on red s... y5 does not fit rs), so the turn passes to A
  g := public.holler_card_move(tc, gid, (g->>'version')::int, '{"draw": true}');
  assert g->>'turnPerson' = ida::text and (g->'counts'->>idc::text)::int = 4, 'a draw that does not fit passes';
  -- A plays Wild, picks blue
  g := public.holler_card_move(ta, gid, (g->>'version')::int, '{"play": "xw", "color": "b"}');
  assert g->>'color' = 'b' and g->>'turnPerson' = idb::text, 'wild sets the color';
  -- B plays b9; C draws rd (does not fit b9)... next in deck is rd: no match, passes to A
  g := public.holler_card_move(tb, gid, (g->>'version')::int, '{"play": "b9"}');
  g := public.holler_card_move(tc, gid, (g->>'version')::int, '{"draw": true}');
  assert g->>'turnPerson' = ida::text, 'C passed again';
  -- A has r5 r2 b1: plays b1 without calling -> has 2 left, no penalty
  g := public.holler_card_move(ta, gid, (g->>'version')::int, '{"play": "b1"}');
  assert jsonb_array_length(g->'hand') = 2, 'A has two';
  -- B: b9 gone, has g9 y1 y2; top b1: y1 matches the 1
  g := public.holler_card_move(tb, gid, (g->>'version')::int, '{"play": "y1"}');
  -- C draws g7: does not fit y1, passes
  g := public.holler_card_move(tc, gid, (g->>'version')::int, '{"draw": true}');
  -- A draws b2: does not fit y1 either, passes to B
  g := public.holler_card_move(ta, gid, (g->>'version')::int, '{"draw": true}');
  assert g->>'turnPerson' = idb::text and jsonb_array_length(g->'hand') = 3, 'A drew one';
  -- B plays y2 down to one card and forgets to call: draws two
  g := public.holler_card_move(tb, gid, (g->>'version')::int, '{"play": "y2"}');
  assert (g->'counts'->>idb::text)::int = 3 and (g->'last'->>'forgot')::int = 2, 'forgetting to call costs two';
  assert g->>'turnPerson' = idc::text, 'then C';

  -- draw that fits: rig so C draws a match, may keep it
  perform pg_temp.rig(gid, jsonb_build_object(ida, '["r5","r2"]'::jsonb, idb, '["g9","b5","b6"]'::jsonb, idc, '["g1","g2","g3","g7"]'::jsonb),
    '["y8","rd","yd"]'::jsonb, 'y2');
  update holler.games set turn_person = idc where id = gid;
  select version into v from holler.games where id = gid;
  g := public.holler_card_move(tc, gid, v, '{"draw": true}');
  assert g->>'turnPerson' = idc::text and g->>'drawn' = 'y8', 'a draw that fits waits';
  assert public.holler_game(ta, gid)->'drawn' = 'null'::jsonb, 'nobody else sees the drawn card';
  e := pg_temp.err(format('select public.holler_card_move(%L, %L, %s, %L)', tc, gid, (g->>'version')::int, '{"draw": true}'));
  assert e = 'You already drew. Play it or keep it.', 'one draw: ' || e;
  e := pg_temp.err(format('select public.holler_card_move(%L, %L, %s, %L)', tc, gid, (g->>'version')::int, '{"play": "g2"}'));
  assert e like 'After a draw%' or e = 'That card does not match.', 'only the drawn card: ' || e;
  g := public.holler_card_move(tc, gid, (g->>'version')::int, '{"pass": true}');
  assert g->>'turnPerson' = ida::text and g->'drawn' = 'null'::jsonb, 'keep passes';

  -- Draw Two hits the next person and skips them; Reverse flips
  perform pg_temp.rig(gid, jsonb_build_object(ida, '["rd","r3","r4"]'::jsonb, idb, '["g9","b5"]'::jsonb, idc, '["rr","g2","g3"]'::jsonb),
    '["y8","y7","y6","y5"]'::jsonb, 'r2');
  select version into v from holler.games where id = gid;
  g := public.holler_card_move(ta, gid, v, '{"play": "rd"}');
  assert (g->'counts'->>idb::text)::int = 4 and g->>'turnPerson' = idc::text and g->'last'->>'hit' = idb::text, 'draw two';
  g := public.holler_card_move(tc, gid, (g->>'version')::int, '{"play": "rr"}');
  assert (g->>'dir')::int = -1 and g->>'turnPerson' = idb::text, 'reverse sends it back to B';

  -- calling Last card, then winning
  perform pg_temp.rig(gid, jsonb_build_object(ida, '["r3","r4"]'::jsonb, idb, '["g9","b5"]'::jsonb, idc, '["g2","g3"]'::jsonb), '["y8"]'::jsonb, 'r2');
  update holler.games set turn_person = ida where id = gid;
  select version into v from holler.games where id = gid;
  g := public.holler_card_move(ta, gid, v, '{"play": "r3", "last": true}');
  assert jsonb_array_length(g->'hand') = 1 and (g->'last'->>'called')::boolean, 'called it';
  update holler.games set turn_person = ida where id = gid;
  select version into v from holler.games where id = gid;
  g := public.holler_card_move(ta, gid, v, '{"play": "r4"}');
  assert g->>'status' = 'done' and g->>'winner' = ida::text and g->'hands' is not null and g->'hands' <> 'null'::jsonb, 'out of cards wins, hands shown';
  e := pg_temp.err(format('select public.holler_card_move(%L, %L, %s, %L)', tb, gid, (g->>'version')::int, '{"play": "g9"}'));
  assert e = 'This game is over.', 'over: ' || e;

  -- an empty deck reshuffles the discard pile
  g := public.holler_card_start(tb, chat, array[idb, ida]); gid := (g->>'id')::uuid;
  update holler.games set secret = jsonb_build_object('deck', '[]'::jsonb, 'discard', '["g4","g5"]'::jsonb,
    'hands', jsonb_build_object(idb, '["r1"]'::jsonb, ida, '["y1"]'::jsonb)), state = state || '{"top": "b9", "color": "b"}' where id = gid;
  select version into v from holler.games where id = gid;
  g := public.holler_card_move(tb, gid, v, '{"draw": true}');
  assert (g->'counts'->>idb::text)::int = 2 and (g->>'deckLeft')::int = 1, 'reshuffled the discard pile';
  -- 2 players: Reverse acts as Skip
  update holler.games set secret = jsonb_set(secret, array['hands', ida::text], '["yr","y2"]'), state = state || '{"top": "y9", "color": "y"}', turn_person = ida where id = gid;
  select version into v from holler.games where id = gid;
  g := public.holler_card_move(ta, gid, v, '{"play": "yr"}');
  assert g->>'turnPerson' = ida::text, 'with two, reverse is a skip';

  -- leaving: down to one player, they win; nudge works for the person up
  update holler.games set nudged_at = null where id = gid;
  g := public.holler_game_nudge(tb, gid);
  assert g->>'nudgedAt' is not null, 'nudge Last Card';
  g := public.holler_card_leave(ta, gid);
  assert g->>'status' = 'done' and g->>'winner' = idb::text and g->>'result' = 'left', 'last one in wins';

  -- three players, the one up leaves: turn moves on
  g := public.holler_card_start(ta, chat, array[ida, idb, idc]); gid := (g->>'id')::uuid;
  g := public.holler_card_leave(ta, gid);
  assert g->>'status' = 'playing' and g->>'turnPerson' = idb::text and jsonb_array_length(g->'order') = 2, 'game goes on without A';
  assert (g->'counts') ? idb::text and not ((g->'counts') ? ida::text), 'A''s cards are gone';
  -- two days idle: B draws one and is passed
  update holler.games set turn_since = now() - interval '49 hours' where id = gid;
  g := public.holler_game(tc, gid);
  assert g->>'turnPerson' = idc::text and (g->'counts'->>idb::text)::int = 8 and g->'last'->>'kind' = 'idle', 'idle skip';
  -- a week idle ends it
  update holler.games set turn_since = now() - interval '8 days' where id = gid;
  g := public.holler_game(tc, gid);
  assert g->>'status' = 'ended' and g->>'result' = 'idle', 'a week ends it';

  -- older games still go through the dispatchers
  g := public.holler_game_start2(ta, chat, 'ttt', array[ida, idb], '{}');
  assert g->>'board' = '.........', 'ttt still starts';
  raise notice 'GAMES5 CHECK PASSED';
end $$;
rollback;


-- ================= checks (this whole file aborts at the end, so nothing above is kept) =================
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'no error'; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.rig(p_game uuid, p_hands jsonb, p_deck jsonb, p_top text) returns void language sql as $$
  update holler.games set secret = jsonb_build_object('deck', p_deck, 'discard', '[]'::jsonb, 'hands', p_hands),
    state = state || jsonb_build_object('top', p_top, 'color', left(p_top, 1), 'drew', false, 'owe', 0) where id = p_game
$$;

do $$
declare a jsonb; b jsonb; c jsonb; ta text; tb text; tc text; ida uuid; idb uuid; idc uuid; chat uuid; code text;
  g jsonb; gid uuid; e text; v int;
  deck jsonb := '["y1","y2","y3","y4","y5","y6","y7","y8","y9","g1","g2","g3"]';
begin
  a := public.holler_signup('QA Check A', '#ff7aa2'); ta := a->>'token'; ida := (a->'me'->>'id')::uuid;
  b := public.holler_signup('QA Check B', '#59c9ff'); tb := b->>'token'; idb := (b->'me'->>'id')::uuid;
  c := public.holler_signup('QA Check C', '#8fe3bd'); tc := c->>'token'; idc := (c->'me'->>'id')::uuid;
  chat := (public.holler_create_chat(ta, 'qa check')->>'id')::uuid;
  select invite_code into code from holler.chats where id = chat;
  perform public.holler_join(tb, code); perform public.holler_join(tc, code);

  -- the old 3-argument start still deals, with stacking off
  g := public.holler_card_start(ta, chat, array[ida, idb, idc]); gid := (g->>'id')::uuid;
  assert g->'stack' = 'false'::jsonb and (g->>'owe')::int = 0, 'old start: stacking off';
  perform pg_temp.rig(gid, jsonb_build_object(ida, '["rd","r3"]'::jsonb, idb, '["gd","b5","b6"]'::jsonb, idc, '["g2","g3"]'::jsonb), deck, 'r2');
  select version into v from holler.games where id = gid;
  g := public.holler_card_move(ta, gid, v, '{"play": "rd"}');
  assert (g->'counts'->>idb::text)::int = 5 and g->>'turnPerson' = idc::text, 'off: draw two still hits straight away';
  perform public.holler_card_leave(ta, gid); perform public.holler_card_leave(tb, gid);

  -- stacking on
  g := public.holler_card_start(ta, chat, array[ida, idb, idc], '{"stack": true}'); gid := (g->>'id')::uuid;
  assert g->'stack' = 'true'::jsonb, 'stacking on';
  perform pg_temp.rig(gid, jsonb_build_object(ida, '["rd","r3","bd"]'::jsonb, idb, '["gd","r5","b6"]'::jsonb, idc, '["xf","g3","g4"]'::jsonb), deck, 'r2');
  select version into v from holler.games where id = gid;
  g := public.holler_card_move(ta, gid, v, '{"play": "rd"}');
  assert (g->'counts'->>idb::text)::int = 3 and (g->>'owe')::int = 2 and g->>'turnPerson' = idb::text, 'on: B is up with 2 waiting';
  assert g->'last'->>'stack' = idb::text, 'the event says who it is stacked on';
  e := pg_temp.err(format('select public.holler_card_move(%L, %L, %s, %L)', tb, gid, (g->>'version')::int, '{"play": "r5"}'));
  assert e = 'Stack a draw card or take 2.', 'only a draw card on a stack: ' || e;
  e := pg_temp.err(format('select public.holler_card_move(%L, %L, %s, %L)', tb, gid, (g->>'version')::int, '{"pass": true}'));
  assert e = 'Draw a card first.', 'no passing out of a stack: ' || e;
  g := public.holler_card_move(tb, gid, (g->>'version')::int, '{"play": "gd"}');
  assert (g->>'owe')::int = 4 and g->>'turnPerson' = idc::text and g->>'color' = 'g', '+2 on +2, any color';
  g := public.holler_card_move(tc, gid, (g->>'version')::int, '{"play": "xf", "color": "b"}');
  assert (g->>'owe')::int = 8 and g->>'turnPerson' = ida::text, '+4 on +2';
  e := pg_temp.err(format('select public.holler_card_move(%L, %L, %s, %L)', ta, gid, (g->>'version')::int, '{"play": "bd"}'));
  assert e = 'Stack a draw card or take 8.', 'no +2 on a +4: ' || e;
  g := public.holler_card_move(ta, gid, (g->>'version')::int, '{"draw": true}');
  assert jsonb_array_length(g->'hand') = 10 and (g->>'owe')::int = 0 and g->>'turnPerson' = idb::text, 'A takes all 8 and is passed';
  assert g->'last'->>'kind' = 'take' and (g->'last'->>'n')::int = 8, 'logged as a take';
  -- after taking, play is normal again
  g := public.holler_card_move(tb, gid, (g->>'version')::int, '{"play": "b6"}');
  assert g->>'turnPerson' = idc::text and (g->>'owe')::int = 0, 'back to normal';

  -- two days idle with a stack on you: you take it
  perform pg_temp.rig(gid, jsonb_build_object(ida, '["rd","r3"]'::jsonb, idb, '["r5","b6"]'::jsonb, idc, '["g3","g4"]'::jsonb), deck, 'r2');
  update holler.games set turn_person = ida where id = gid;
  select version into v from holler.games where id = gid;
  g := public.holler_card_move(ta, gid, v, '{"play": "rd", "last": true}');
  update holler.games set turn_since = now() - interval '49 hours' where id = gid;
  g := public.holler_game(tc, gid);
  assert (g->'counts'->>idb::text)::int = 4 and (g->>'owe')::int = 0 and g->>'turnPerson' = idc::text, 'idle: takes the stack';

  -- 2 players: stack back and forth
  g := public.holler_card_start(ta, chat, array[ida, idb], '{"stack": true}'); gid := (g->>'id')::uuid;
  perform pg_temp.rig(gid, jsonb_build_object(ida, '["rd","yd","r3"]'::jsonb, idb, '["gd","b5","b6"]'::jsonb), deck, 'r2');
  select version into v from holler.games where id = gid;
  g := public.holler_card_move(ta, gid, v, '{"play": "rd"}');
  g := public.holler_card_move(tb, gid, (g->>'version')::int, '{"play": "gd"}');
  assert g->>'turnPerson' = ida::text and (g->>'owe')::int = 4, 'back to A with 4';
  g := public.holler_card_move(ta, gid, (g->>'version')::int, '{"play": "yd"}');
  g := public.holler_card_move(tb, gid, (g->>'version')::int, '{"draw": true}');
  assert (g->'counts'->>idb::text)::int = 8 and g->>'turnPerson' = ida::text, 'B takes 6, A is up';

  raise exception 'GAMES6 CHECK PASSED (nothing kept)';
end $$;

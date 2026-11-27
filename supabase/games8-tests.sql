-- ================= checks (this whole file aborts at the end, so nothing above is kept) =================
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'no error'; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.clip(p_tok text, p_chat uuid, p_fx jsonb) returns jsonb
language plpgsql as $$
declare p jsonb;
begin
  p := public.holler_start_polo(p_tok, p_chat, 'video', 'mp4', 'video/mp4', null);
  insert into storage.objects (bucket_id, name, metadata) values ('holler', p->>'path', '{"size": 50000}');
  return public.holler_finish_polo(p_tok, (p->>'id')::uuid, 5, 540, 960, 'it is a thing', p_fx, true);
end $$;

do $$
declare r record; bad text := '';
begin
  -- ===== the answer check =====
  for r in select * from (values
    ('thriller', 'Thriller dance', true), ('thriler', 'Thriller dance', true), ('the thriller', 'Thriller dance', true),
    ('THRILLER!', 'Thriller dance', true), ('thriller dancing', 'Thriller dance', true),
    ('dancing with stars', 'Dancing with the Stars', true), ('dancing stars', 'Dancing with the Stars', true),
    ('dancing with the starz', 'Dancing with the Stars', true), ('dance with the stars', 'Dancing with the Stars', true),
    ('moon walk', 'Moonwalk', true), ('moonwalking', 'Moonwalk', true), ('flossing', 'Floss', true), ('the floss', 'Floss', true),
    ('penguins', 'Penguin', true), ('penguin', 'Penguin', true), ('pengiun', 'Penguin', true),
    ('brushing my teeth', 'Brushing teeth', true), ('brush teeth', 'Brushing teeth', true), ('teeth brushing', 'Brushing teeth', true),
    ('t rex', 'T. rex', true), ('trex', 'T. rex', true), ('hot air balloons', 'Hot air balloon', true),
    ('rock & roll', 'Rock and roll', true), ('walk a dog', 'Walking a dog', true), ('skates', 'Roller skates', false),
    ('stars', 'Dancing with the Stars', false), ('dance', 'Thriller dance', false), ('dancing', 'Thriller dance', false),
    ('michael jackson', 'Thriller dance', false), ('pizza', 'Penguin', false), ('', 'Penguin', false), ('   ', 'Penguin', false),
    ('the', 'The Robot', false), ('a dance move', 'Robot dance', false), ('cat', 'Bat', false), ('acrobat', 'Bat', false),
    ('bat', 'Bat', true), ('bats', 'Bat', true), ('dog', 'Hot dog', false), ('hot', 'Hot dog', false), ('hotdog', 'Hot dog', true),
    ('song', 'Macarena', false), ('macarena song', 'Macarena', true),
    ('lawn', 'Yawning', false), ('cats', 'Cars', false), ('flamingo', 'Flamenco', false), ('warm up', 'The worm', false),
    ('the lion king', 'King Kong', false), ('mary poppins', 'Mark it', false), ('flamenko', 'Flamenco', true), ('starz', 'Star', true)
  ) t(g, w, want) loop
    if holler.charades_match(r.g, r.w) is distinct from r.want then bad := bad || format(' [%s for %s: want %s]', r.g, r.w, r.want); end if;
  end loop;
  assert bad = '', 'answer check:' || bad;
  assert holler.charades_norm('The Moon-walk!') = 'moonwalk', 'norm runs words together';
  assert holler.ch_stem('dancing') = holler.ch_stem('dance') and holler.ch_stem('dances') = holler.ch_stem('danced'), 'dance stems meet';
  assert holler.ch_stem('running') = 'run' and holler.ch_stem('floss') = 'floss' and holler.ch_stem('flossing') = 'floss', 'stems';
  assert holler.ch_lev('kitten', 'sitting') = 3 and holler.ch_lev('', 'abc') = 3 and holler.ch_lev('same', 'same') = 0 and holler.ch_lev('pengiun', 'penguin') = 1, 'edit distance';
end $$;

do $$
declare a jsonb; b jsonb; c jsonb; ta text; tb text; tc text; ida uuid; idb uuid; idc uuid; chat uuid; code text;
  g jsonb; gid uuid; e text; po jsonb; r jsonb; f jsonb;
begin
  a := public.holler_signup('QA Check A', '#ff7aa2'); ta := a->>'token'; ida := (a->'me'->>'id')::uuid;
  b := public.holler_signup('QA Check B', '#59c9ff'); tb := b->>'token'; idb := (b->'me'->>'id')::uuid;
  c := public.holler_signup('QA Check C', '#8fe3bd'); tc := c->>'token'; idc := (c->'me'->>'id')::uuid;
  chat := (public.holler_create_chat(ta, 'qa check')->>'id')::uuid;
  select invite_code into code from holler.chats where id = chat;
  perform public.holler_join(tb, code); perform public.holler_join(tc, code);

  -- ===== Zoom In: where it starts =====
  assert holler.zoom_focus('{"x": 0.25, "y": 0.75, "z": 6}') = '{"x": 0.25, "y": 0.75, "z": 6}'::jsonb, 'good focus kept';
  assert holler.zoom_focus(null) = '{"x": 0.5, "y": 0.5, "z": 8}'::jsonb, 'missing: the old start';
  assert holler.zoom_focus('{"x": 1.5, "y": 0.5, "z": 6}') = '{"x": 0.5, "y": 0.5, "z": 8}'::jsonb, 'x out of the frame';
  assert holler.zoom_focus('{"x": 0.5, "y": 0.5, "z": 40}') = '{"x": 0.5, "y": 0.5, "z": 8}'::jsonb, 'too far in';
  assert holler.zoom_focus('{"x": 0.5, "y": 0.5, "z": 1}') = '{"x": 0.5, "y": 0.5, "z": 8}'::jsonb, 'not zoomed at all';
  assert holler.zoom_focus('{"x": "0.5", "y": 0.5, "z": 6}') = '{"x": 0.5, "y": 0.5, "z": 8}'::jsonb, 'a string is not a number';
  assert holler.zoom_focus('[1, 2]') = '{"x": 0.5, "y": 0.5, "z": 8}'::jsonb, 'not an object';
  assert holler.zoom_focus('{"x": 0.123456, "y": 0, "z": 12}') = '{"x": 0.123, "y": 0, "z": 12}'::jsonb, 'rounded, edges allowed';
  g := public.holler_game_start2(ta, chat, 'zoom', array[ida, idb, idc], '{}'); gid := (g->>'id')::uuid;
  po := pg_temp.clip(ta, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'word', 'the kettle', 'focus', jsonb_build_object('x', 0.3, 'y', 0.6, 'z', 6.5))));
  assert po->'effects'->'game'->'word' is null, 'answer still stripped';
  assert (select state->'clips'->ida::text->'focus' from holler.games where id = gid) = '{"x": 0.3, "y": 0.6, "z": 6.5}'::jsonb, 'focus kept in state';
  g := public.holler_game(tb, gid);
  assert g->'shots'->0->'focus' = '{"x": 0.3, "y": 0.6, "z": 6.5}'::jsonb and g->'shots'->0->>'answer' is null, 'B sees where it starts, not what it is';
  perform pg_temp.clip(tb, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'word', 'a lamp', 'focus', '{"x": 9, "y": 0.2, "z": 5}'::jsonb)));
  perform pg_temp.clip(tc, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'word', 'a mug')));
  g := public.holler_game(ta, gid);
  assert (select count(*) from jsonb_array_elements(g->'shots') s where s->'focus' = '{"x": 0.5, "y": 0.5, "z": 8}'::jsonb) = 2, 'bad or missing focus: the old start';
  -- an old clip (state with no focus, like the ones from before) still shows, with focus null
  update holler.games set state = jsonb_set(state, array['clips', idc::text], (state->'clips'->idc::text) - 'focus') where id = gid;
  g := public.holler_game(ta, gid);
  assert (select s->'focus' from jsonb_array_elements(g->'shots') s where s->>'who' = idc::text) = 'null'::jsonb, 'old clip: no focus';
  g := public.holler_zoom_move(ta, gid, jsonb_build_object('who', idc, 'at', 0.2, 'guess', 'mug'));
  assert (select s->>'answer' from jsonb_array_elements(g->'shots') s where s->>'who' = idc::text) = 'a mug', 'old clip still guessable';

  -- ===== Charades: the check and Count it =====
  g := public.holler_game_start2(ta, chat, 'charades', array[ida, idb, idc], '{"turnSec": 10, "deck": "mixed"}'); gid := (g->>'id')::uuid;
  perform pg_temp.clip(ta, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'word', 'Thriller dance')));
  r := public.holler_game_guess(tb, gid, ida, 'thriller', 3.2);
  assert (r->>'ok')::boolean and (r->>'done')::boolean and r->>'word' = 'Thriller dance', 'thriller is right';
  r := public.holler_game_guess(tc, gid, ida, 'dance', 2);
  assert not (r->>'ok')::boolean and not (r->>'done')::boolean, 'dance alone is not';
  e := pg_temp.err(format('select public.holler_charades_count(%L, %L, %L)', ta, gid, idc));
  assert e = 'They are still guessing.', 'not while they are still going: ' || e;
  perform public.holler_game_guess(tc, gid, ida, 'michael jackson', 4);
  r := public.holler_game_guess(tc, gid, ida, 'mj', 6);
  assert not (r->>'ok')::boolean and (r->>'done')::boolean, 'C is out of tries';
  e := pg_temp.err(format('select public.holler_charades_count(%L, %L, %L)', tb, gid, idc));
  assert e = 'Only the one who acted it can count a guess.', 'only the actor: ' || e;
  e := pg_temp.err(format('select public.holler_charades_count(%L, %L, %L)', ta, gid, idb));
  assert e = 'That one already counts.', 'already right: ' || e;
  e := pg_temp.err(format('select public.holler_charades_count(%L, %L, %L)', ta, gid, ida));
  assert e = 'They have not guessed yours.', 'not yourself: ' || e;
  g := public.holler_charades_count(ta, gid, idc);
  f := (select x->'results'->idc::text from jsonb_array_elements(g->'acts') x where x->>'who' = ida::text);
  assert (f->>'ok')::boolean and (f->>'done')::boolean and (f->>'counted')::boolean and (f->>'t')::real = 10 and f->>'text' = 'mj' and (f->>'tries')::int = 3,
    'counted: right, slowest time, last guess kept: ' || f::text;
  f := (select x->'mine' from jsonb_array_elements(public.holler_game(tc, gid)->'acts') x where x->>'who' = ida::text);
  assert (f->>'ok')::boolean and (f->>'counted')::boolean, 'C sees it as right, counted';
  -- done games too: finish the game, then count one
  perform pg_temp.clip(tb, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'word', 'Penguin')));
  perform pg_temp.clip(tc, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'word', 'Floss')));
  perform public.holler_game_guess(ta, gid, idb, 'penguins', 1);
  perform public.holler_game_guess(tc, gid, idb, 'pizza', 1); perform public.holler_game_guess(tc, gid, idb, 'bird', 2); perform public.holler_game_guess(tc, gid, idb, 'puffin', 3);
  perform public.holler_game_guess(ta, gid, idc, 'the floss', 1);
  r := public.holler_game_guess(tb, gid, idc, 'flossing', 1);
  assert r->'game'->>'status' = 'done', 'everyone guessed everything: done';
  g := public.holler_charades_count(tb, gid, idc);
  assert g->>'status' = 'done' and (select (x->'results'->idc::text->>'counted')::boolean from jsonb_array_elements(g->'acts') x where x->>'who' = idb::text),
    'counting works once it is done';
  update holler.games set status = 'ended' where id = gid;
  e := pg_temp.err(format('select public.holler_charades_count(%L, %L, %L)', ta, gid, idc));
  assert e = 'This game is over.', 'not on an ended game: ' || e;

  -- ===== every other game still starts =====
  g := public.holler_game_start2(ta, chat, 'laugh', array[ida, idb], '{"turnSec": 10}');
  assert g->>'kind' = 'laugh', 'laugh starts';
  assert holler.game_label('zoom') = 'Zoom In' and holler.game_label('charades') = 'Charades Relay', 'labels';

  raise exception 'GAMES8 CHECK PASSED (nothing kept)';
end $$;

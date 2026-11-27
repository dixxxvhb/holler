
-- ================= checks (this whole file aborts at the end, so nothing above is kept) =================
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'no error'; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.clip(p_tok text, p_chat uuid, p_fx jsonb) returns jsonb
language plpgsql as $$
declare p jsonb;
begin
  p := public.holler_start_polo(p_tok, p_chat, 'video', 'mp4', 'video/mp4', null);
  insert into storage.objects (bucket_id, name, metadata) values ('holler', p->>'path', '{"size": 50000}');
  return public.holler_finish_polo(p_tok, (p->>'id')::uuid, 5, 540, 960, 'it is my cat', p_fx, true);
end $$;

do $$
declare a jsonb; b jsonb; c jsonb; ta text; tb text; tc text; ida uuid; idb uuid; idc uuid; chat uuid; code text;
  g jsonb; gid uuid; e text; po jsonb; s jsonb; bd jsonb; ks text[]; picks jsonb; v int;
begin
  a := public.holler_signup('QA Check A', '#ff7aa2'); ta := a->>'token'; ida := (a->'me'->>'id')::uuid;
  b := public.holler_signup('QA Check B', '#59c9ff'); tb := b->>'token'; idb := (b->'me'->>'id')::uuid;
  c := public.holler_signup('QA Check C', '#8fe3bd'); tc := c->>'token'; idc := (c->'me'->>'id')::uuid;
  chat := (public.holler_create_chat(ta, 'qa check')->>'id')::uuid;
  select invite_code into code from holler.chats where id = chat;
  perform public.holler_join(tb, code); perform public.holler_join(tc, code);

  -- ===== Zoom In =====
  e := pg_temp.err(format('select public.holler_game_start2(%L, %L, ''zoom'', array[%L]::uuid[], ''{}'')', ta, chat, ida));
  assert e = 'Zoom In needs 2 to 6 people.', 'zoom needs 2: ' || e;
  g := public.holler_game_start2(ta, chat, 'zoom', array[ida, idb, idc], '{}'); gid := (g->>'id')::uuid;
  assert g->>'kind' = 'zoom' and (g->>'turnSec')::int = 5 and jsonb_array_length(g->'todo') = 3, 'zoom starts, 5 s, all to do';
  e := pg_temp.err(format('select pg_temp.clip(%L, %L, %L)', ta, chat, jsonb_build_object('game', jsonb_build_object('id', gid))));
  assert e like 'Say what it is first%', 'a clip needs its answer: ' || e;
  po := pg_temp.clip(ta, chat, jsonb_build_object('look', 'none', 'game', jsonb_build_object('id', gid, 'word', '  my  cat''s nose ')));
  assert po->'effects'->'game'->'word' is null and po->'effects'->'game'->>'id' = gid::text, 'answer stripped from the holler';
  assert (select effects::text from holler.polos where id = (po->>'id')::uuid) not like '%nose%', 'answer not stored on the polo';
  assert (select secret->'answers'->>ida::text from holler.games where id = gid) = 'my cat''s nose', 'answer kept in secret, tidied';
  assert not exists (select 1 from jsonb_array_elements(public.holler_chat(tb, chat)->'polos') x where x->>'id' = po->>'id'), 'zoom clip stays out of the strip';
  assert public.holler_chat(tb, chat)::text not like '%nose%', 'B''s whole chat payload has no answer';
  g := public.holler_game(tb, gid);
  assert g->'shots'->0->>'answer' is null and g->'shots'->0->'guesses' = 'null'::jsonb and g->'shots'->0->'clip'->>'path' is not null, 'B gets the clip, not the answer';
  assert g->'shots'->0->'clip'->'thumb' is null and g->'shots'->0->'clip'->'transcript' is null, 'no thumb or captions before guessing';
  assert public.holler_game(ta, gid)->'shots'->0->>'answer' = 'my cat''s nose', 'A sees their own answer';
  e := pg_temp.err(format('select pg_temp.clip(%L, %L, %L)', ta, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'word', 'again'))));
  assert e = 'You already filmed yours.', 'one clip each: ' || e;
  -- C has no camera: just guess
  g := public.holler_zoom_move(tc, gid, '{"skip": true}');
  assert g->'skipped' = jsonb_build_array(idc), 'C is just guessing';
  e := pg_temp.err(format('select public.holler_zoom_move(%L, %L, %L)', tc, gid, jsonb_build_object('who', idc, 'at', 0.1, 'guess', 'x')));
  assert e = 'That clip is gone.', 'C has no clip to guess: ' || e;
  e := pg_temp.err(format('select public.holler_zoom_move(%L, %L, %L)', tc, gid, jsonb_build_object('who', ida, 'got', true)));
  assert e = 'Guess it first.', 'no yes before a guess: ' || e;
  -- C guesses wrong early, says no
  g := public.holler_zoom_move(tc, gid, jsonb_build_object('who', ida, 'at', 0.2, 'guess', 'a dog'));
  assert g->'shots'->0->>'answer' = 'my cat''s nose' and g->'shots'->0->'guesses'->idc::text->>'text' = 'a dog', 'guessed: C sees the answer';
  assert g->'shots'->0->'clip'->>'thumb' is not null, 'and the thumbnail';
  assert g->'todo' ? idc::text, 'C still owes yes or no';
  assert public.holler_game(tb, gid)->'shots'->0->'guesses' = 'null'::jsonb, 'B cannot see C''s guess yet';
  e := pg_temp.err(format('select public.holler_zoom_move(%L, %L, %L)', tc, gid, jsonb_build_object('who', ida, 'at', 0.2, 'guess', 'again')));
  assert e = 'You already guessed this one.', 'one guess: ' || e;
  g := public.holler_zoom_move(tc, gid, jsonb_build_object('who', ida, 'got', false));
  assert not (g->'todo' ? idc::text), 'C is done for now';
  -- B films, then guesses A's late and gets it
  perform pg_temp.clip(tb, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'word', 'a lamp')));
  g := public.holler_zoom_move(tb, gid, jsonb_build_object('who', ida, 'at', 5, 'guess', 'nose'));
  assert (g->'shots'->0->'mine'->>'at')::numeric = 1, 'how far out is clamped to 1';
  assert g->'shots'->0->'guesses'->idc::text->>'text' = 'a dog', 'once B guessed, B sees C''s wrong guess';
  g := public.holler_zoom_move(tb, gid, jsonb_build_object('who', ida, 'got', true));
  e := pg_temp.err(format('select public.holler_zoom_move(%L, %L, %L)', tb, gid, jsonb_build_object('who', ida, 'got', false)));
  assert e = 'You already said.', 'no changing it: ' || e;
  assert (public.holler_chat(ta, chat)->>'yourTurn')::int >= 1, 'A owes B''s clip';
  perform public.holler_zoom_move(ta, gid, jsonb_build_object('who', idb, 'at', 0.1, 'guess', 'lamp'));
  perform public.holler_zoom_move(ta, gid, jsonb_build_object('who', idb, 'got', true));
  perform public.holler_zoom_move(tc, gid, jsonb_build_object('who', idb, 'at', 0.5, 'guess', 'a light'));
  g := public.holler_zoom_move(tc, gid, jsonb_build_object('who', idb, 'got', true));
  assert g->>'status' = 'done' and jsonb_array_length(g->'shots') = 2, 'everyone did everything: done';
  assert (select count(*) from holler.games where id = gid and state->>'todo' = '[]') = 1, 'nobody owes';
  -- nobody can film: the last one cannot skip
  g := public.holler_game_start2(ta, chat, 'zoom', array[ida, idb], '{}'); gid := (g->>'id')::uuid;
  perform public.holler_zoom_move(ta, gid, '{"skip": true}');
  e := pg_temp.err(format('select public.holler_zoom_move(%L, %L, ''{"skip": true}'')', tb, gid));
  assert e like 'Someone has to film one%', 'a game needs a clip: ' || e;
  update holler.games set updated_at = now() - interval '49 hours' where id = gid;
  assert public.holler_game(ta, gid)->>'status' = 'ended', 'idle zoom with no clips ends';

  -- ===== Who Said It =====
  e := pg_temp.err(format('select public.holler_game_start2(%L, %L, ''said'', array[%L, %L]::uuid[], %L)', ta, chat, ida, idb,
         jsonb_build_object('prompts', jsonb_build_object(ida, 'said-01', idb, 'said-02'))));
  assert e = 'Who Said It needs 3 to 6 people.', 'said needs 3: ' || e;
  e := pg_temp.err(format('select public.holler_game_start2(%L, %L, ''said'', array[%L, %L, %L]::uuid[], %L)', ta, chat, ida, idb, idc,
         jsonb_build_object('prompts', jsonb_build_object(ida, 'said-01', idb, 'said-01', idc, 'said-02'))));
  assert e = 'Pick the prompts.', 'prompts all different: ' || e;
  g := public.holler_game_start2(ta, chat, 'said', array[ida, idb, idc], jsonb_build_object('prompts', jsonb_build_object(ida, 'said-01', idb, 'said-02', idc, 'said-03')));
  gid := (g->>'id')::uuid;
  assert g->>'phase' = 'write' and jsonb_array_length(g->'todo') = 3, 'said starts writing';
  assert g->'boards'->0->>'about' = ida::text and g->'boards'->0->'prompt' = 'null'::jsonb and g->'boards'->1->>'prompt' = 'said-02', 'my own prompt hidden';
  e := pg_temp.err(format('select public.holler_said_move(%L, %L, %L)', ta, gid, jsonb_build_object('write', jsonb_build_object(idb, 'only one'))));
  assert e like 'Write one for everyone%', 'one for everyone: ' || e;
  g := public.holler_said_move(ta, gid, jsonb_build_object('write', jsonb_build_object(idb, 'B by A', idc, 'C by A')));
  assert g->'wrote' = jsonb_build_array(ida) and g->'boards'->1->'answers'->0->>'who' = ida::text, 'A wrote, sees their own';
  assert jsonb_array_length(public.holler_game(tb, gid)->'boards'->0->'answers') = 0, 'B sees nobody''s answers yet';
  assert public.holler_chat(tb, chat)::text not like '%B by A%', 'B''s chat payload has no answers';
  e := pg_temp.err(format('select public.holler_said_move(%L, %L, %L)', ta, gid, jsonb_build_object('about', ida, 'picks', '{}'::jsonb)));
  assert e = 'Everyone has to write first.', 'no guessing yet: ' || e;
  perform public.holler_said_move(tb, gid, jsonb_build_object('write', jsonb_build_object(ida, 'A by B', idc, 'C by B')));
  g := public.holler_said_move(tc, gid, jsonb_build_object('write', jsonb_build_object(ida, 'A by C', idb, 'B by C')));
  assert g->>'phase' = 'guess' and jsonb_array_length(g->'todo') = 3, 'all wrote: guessing, everyone owes their own';
  -- C's view: board about C has 2 to match, the others are open (one answer left)
  bd := g->'boards'->2;
  assert bd->>'prompt' = 'said-03' and (bd->>'n')::int = 2 and not (bd->>'open')::boolean, 'C matches their own';
  assert (select count(*) from jsonb_array_elements(bd->'answers') x where x->>'who' is null) = 2, 'writers hidden on C''s board';
  assert (g->'boards'->0->>'open')::boolean and (g->'boards'->0->>'n')::int = 1, 'the prompt about A is skipped for C';
  e := pg_temp.err(format('select public.holler_said_move(%L, %L, %L)', tc, gid, jsonb_build_object('about', ida, 'picks', '{}'::jsonb)));
  assert e = 'Nothing to match there.', 'skip at 3: ' || e;
  -- C swaps them (both wrong): A and B each fooled C once
  select array_agg(x->>'k' order by x->>'text') into ks from jsonb_array_elements(bd->'answers') x;   -- [A's, B's]
  e := pg_temp.err(format('select public.holler_said_move(%L, %L, %L)', tc, gid, jsonb_build_object('about', idc, 'picks', jsonb_build_object(ks[1], ida, ks[2], ida))));
  assert e = 'Match every answer to one person.', 'each face once: ' || e;
  g := public.holler_said_move(tc, gid, jsonb_build_object('about', idc, 'picks', jsonb_build_object(ks[1], idb, ks[2], ida)));
  assert (g->'boards'->2->>'open')::boolean and g->'boards'->2->'answers'->0->>'who' is not null, 'C''s board opens after matching';
  assert (public.holler_game(ta, gid)->'boards'->2->>'open')::boolean and public.holler_game(ta, gid)->'boards'->2->'guesses'->idc::text is not null, 'C''s board is skipped for A, so A sees how C did';
  -- A gets theirs right
  bd := public.holler_game(ta, gid)->'boards'->0;
  select jsonb_object_agg(x->>'k', case when x->>'text' = 'A by B' then idb::text else idc::text end) into picks from jsonb_array_elements(bd->'answers') x;
  perform public.holler_said_move(ta, gid, jsonb_build_object('about', ida, 'picks', picks));
  -- B gets theirs right
  bd := public.holler_game(tb, gid)->'boards'->1;
  select jsonb_object_agg(x->>'k', case when x->>'text' = 'B by A' then ida::text else idc::text end) into picks from jsonb_array_elements(bd->'answers') x;
  g := public.holler_said_move(tb, gid, jsonb_build_object('about', idb, 'picks', picks));
  assert g->>'status' = 'done', 'everyone matched: done';
  s := g->'scores';
  assert (s->ida::text->>'right')::int = 2 and (s->idb::text->>'right')::int = 2 and (s->idc::text->>'right')::int = 0, 'right: A 2, B 2, C 0 ' || s::text;
  assert (s->ida::text->>'fooled')::int = 1 and (s->idb::text->>'fooled')::int = 1 and (s->idc::text->>'fooled')::int = 0, 'fooled: A 1, B 1, C 0 ' || s::text;
  assert (select count(*) from jsonb_array_elements(g->'boards') x, jsonb_array_elements(x->'answers') y where y->>'who' is not null) = 6
     and g->'boards'->0->>'prompt' = 'said-01', 'the end shows every answer with its writer';
  -- write phase left idle: two wrote, so guessing starts with what's there
  g := public.holler_game_start2(ta, chat, 'said', array[ida, idb, idc], jsonb_build_object('prompts', jsonb_build_object(ida, 'said-04', idb, 'said-05', idc, 'said-06')));
  gid := (g->>'id')::uuid;
  perform public.holler_said_move(ta, gid, jsonb_build_object('write', jsonb_build_object(idb, 'x', idc, 'y')));
  perform public.holler_said_move(tb, gid, jsonb_build_object('write', jsonb_build_object(ida, 'z', idc, 'w')));
  update holler.games set state = jsonb_set(state, '{since}', to_jsonb(now() - interval '49 hours')) where id = gid;
  g := public.holler_game(tc, gid);
  assert g->>'phase' = 'guess' and g->'todo' = jsonb_build_array(idc), 'idle writing: on to guessing, only C has 2 to match';
  update holler.games set state = jsonb_set(state, '{since}', to_jsonb(now() - interval '49 hours')) where id = gid;
  assert public.holler_game(tc, gid)->>'status' = 'done', 'idle guessing: done';
  -- one writer only: ended
  g := public.holler_game_start2(ta, chat, 'said', array[ida, idb, idc], jsonb_build_object('prompts', jsonb_build_object(ida, 'said-07', idb, 'said-08', idc, 'said-09')));
  perform public.holler_said_move(ta, (g->>'id')::uuid, jsonb_build_object('write', jsonb_build_object(idb, 'x', idc, 'y')));
  update holler.games set state = jsonb_set(state, '{since}', to_jsonb(now() - interval '49 hours')) where id = (g->>'id')::uuid;
  assert public.holler_game(ta, (g->>'id')::uuid)->>'status' = 'ended', 'one writer: ended';

  -- the older games still start and dispatch through the new code
  g := public.holler_game_start2(ta, chat, 'laugh', array[ida, idb], '{"turnSec": 10}');
  assert g->>'kind' = 'laugh' and g->'acts' = '[]'::jsonb, 'laugh still starts';
  g := public.holler_game_start2(ta, chat, 'checkers', array[ida, idb], '{}');
  assert length(g->>'board') = 64, 'checkers still starts';
  e := pg_temp.err(format('select public.holler_game_start2(%L, %L, ''charades'', array[%L, %L, %L, %L, %L, %L]::uuid[], ''{}'')', ta, chat, ida, idb, idc, ida, idb, idc));
  assert e = 'Charades Relay needs 2 to 5 people.', 'old limits kept: ' || e;
  assert holler.game_label('zoom') = 'Zoom In' and holler.game_label('said') = 'Who Said It' and holler.game_label('lastcard') = 'Last Card', 'labels';

  raise exception 'GAMES7 CHECK PASSED (nothing kept)';
end $$;

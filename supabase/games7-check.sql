-- Dry run: games7.sql + games7-tests.sql. Built by scripts/build-check.sh 7; aborts at the end on purpose.
-- Run: ssh pc "pwsh -NoProfile -File C:/Users/bowle/bin/pc-run.ps1 holler-sql games7-check.sql". Expect "GAMES7 CHECK PASSED".
begin;
-- Holler Play, round six (2026-11-27): Zoom In and Who Said It.
-- Additive: widens games.kind, adds the two games' rules and their own move RPCs, then replaces the dispatchers
-- (game_label, game_json, game_tick, game_take_turn) and holler_game_start2, keeping every older game the same.
-- No rows are rewritten and nothing is dropped except the old kind check. Safe to run twice.
-- holler_game_begin and holler_game_nudge are not touched: neither new game uses begin, and nudge already reads state.todo.
--
-- Zoom In (2 to 6): everyone at once. You type what your thing is (secret), then film it for 5 seconds. Its clip comes
--   in through finish_polo with the answer in effects.game.word, which finish_polo already strips (like Charades), so
--   the answer only lives in games.secret. A phone with no camera, or anyone who taps Just guess, skips filming and only
--   guesses. Guessing: the clip pulls out from 8x to 1x; "I know it" records how far out it was (0 to 1); type a guess;
--   then the answer shows and you say whether you got it (honour system). The answer and everyone else's guesses for a
--   clip show to you only once you've guessed it yourself.
--   state:  { order, turnSec: 5, clips: {who: {polo, at}}, skips: {who: at}, guesses: {filmer: {guesser: {at, text, got, ts}}}, todo }
--   secret: { answers: {who: text} }
-- Who Said It (3 to 6): everyone gets a prompt about them (template ids dealt by the app, the words live in
--   src/games/content/said.ts). Write phase: you answer everyone else's prompt (you never see your own yet). Guess phase:
--   for each prompt you match the answers to their writers (each face once), skipping any prompt where fewer than two
--   answers would be left once yours is out. 1 per right match; a writer gets 1 "fooled" each time someone pins their
--   answer on someone else.
--   state:  { order, phase: write|guess, since, prompts: {who: id}, wrote: {who: at}, guesses: {guesser: {about: {picks: {k: writer}, at}}}, todo }
--   secret: { answers: {about: {writer: {k, text}}} }   (k is random, so answers sort into a shuffle that gives nothing away)

alter table holler.games drop constraint if exists games_kind_check;
alter table holler.games add constraint games_kind_check
  check (kind in ('passiton', 'poker', 'charades', 'ttt', 'checkers', 'words', 'trivia', 'spot', 'laugh', 'lastcard', 'zoom', 'said'));

create or replace function holler.game_label(p_kind text) returns text
language sql immutable as $$
  select case p_kind when 'poker' then 'Poker Face' when 'charades' then 'Charades Relay' when 'ttt' then 'Tic-Tac-Toe'
    when 'checkers' then 'Checkers' when 'words' then 'Seven Letters' when 'trivia' then 'Trivia'
    when 'spot' then 'On The Spot' when 'laugh' then 'Don''t Laugh' when 'lastcard' then 'Last Card'
    when 'zoom' then 'Zoom In' when 'said' then 'Who Said It' else 'Pass It On' end
$$;

-- ---------- Zoom In ----------
-- Still owes something: hasn't filmed (and didn't pick Just guess), or hasn't finished guessing someone else's clip.
create or replace function holler.zoom_todo(g holler.games) returns jsonb
language sql stable security definer set search_path = holler as $$
  select coalesce(jsonb_agg(p), '[]') from jsonb_array_elements_text(g.state->'order') p
   where holler.is_member(g.chat_id, p::uuid)
     and ((not coalesce((g.state->'clips') ? p, false) and not coalesce((g.state->'skips') ? p, false))
          or exists (select 1 from jsonb_object_keys(coalesce(g.state->'clips', '{}'::jsonb)) a
                      where a <> p and jsonb_typeof(g.state->'guesses'->a->p->'got') is distinct from 'boolean'))
$$;

create or replace function holler.zoom_json(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select holler.game_base(g, p_me) || jsonb_build_object(
    'filmed', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(coalesce(g.state->'clips', '{}'::jsonb)) k),
    'skipped', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(coalesce(g.state->'skips', '{}'::jsonb)) k),
    'shots', (select coalesce(jsonb_agg(jsonb_build_object(
        'who', c.key, 'at', c.value->'at',
        -- before you've guessed it: the clip to play, but no thumbnail (it's the whole thing) and no captions
        'clip', (select case when o.open then holler.polo_json(po) else holler.polo_json(po) - 'thumb' - 'transcript' end
                   from holler.polos po where po.id = (c.value->>'polo')::uuid and po.status = 'ready' and not holler.game_hidden(g)),
        'mine', g.state->'guesses'->c.key->(p_me::text),
        'answer', case when o.open then g.secret->'answers'->c.key end,
        'guesses', case when o.open then coalesce(g.state->'guesses'->c.key, '{}'::jsonb) end
      ) order by c.value->>'at'), '[]')
      from jsonb_each(coalesce(g.state->'clips', '{}'::jsonb)) c,
           lateral (select g.status <> 'playing' or c.key = p_me::text
                           or coalesce((g.state->'guesses'->c.key->(p_me::text)) ? 'text', false) as open) o)
  )
$$;

create or replace function holler.zoom_advance(p_game uuid) returns void
language plpgsql security definer set search_path = holler, public as $$
declare g holler.games; todo jsonb;
begin
  select * into g from holler.games where id = p_game for update;
  if g.id is null or g.status <> 'playing' then return; end if;
  todo := holler.zoom_todo(g);
  if jsonb_array_length(todo) > 0 and g.updated_at > now() - interval '48 hours' then
    if todo is distinct from g.state->'todo' then
      update holler.games set state = jsonb_set(state, '{todo}', todo), version = version + 1 where id = g.id;
    end if;
    return;
  end if;
  if coalesce(g.state->'clips', '{}'::jsonb) = '{}'::jsonb then
    update holler.games set state = jsonb_set(state, '{todo}', '[]'), status = 'ended', ended_at = now(),
      version = version + 1, updated_at = now() where id = g.id;
    return;
  end if;
  update holler.games set state = jsonb_set(state, '{todo}', '[]'), status = 'done', ended_at = now(),
    version = version + 1, updated_at = now() where id = g.id;
  perform holler.push_to(g.chat_id, array(select jsonb_array_elements_text(g.state->'order')::uuid), 'Zoom In: see what everything was');
end $$;

-- Your clip, with what it is (effects.game.word; finish_polo strips it from the holler's effects).
create or replace function holler.zoom_take_turn(p_polo uuid, p_me uuid, p_game uuid, p_word text) returns void
language plpgsql security definer set search_path = holler, public as $$
declare g holler.games; st jsonb; w text := btrim(regexp_replace(coalesce(p_word, ''), '\s+', ' ', 'g')); nm text;
begin
  perform holler.zoom_advance(p_game);
  select * into g from holler.games where id = p_game for update;
  if not coalesce((g.state->'order') ? p_me::text, false) then raise exception 'You are not in that game.'; end if;
  if g.status <> 'playing' then raise exception 'That game is over, so this one was not sent.'; end if;
  if coalesce((g.state->'clips') ? p_me::text, false) then raise exception 'You already filmed yours.'; end if;
  if length(w) not between 1 and 40 then raise exception 'Say what it is first, in up to 40 letters.'; end if;
  update holler.polos set game_id = g.id, game_turn = holler.order_idx(g.state->'order', p_me) where id = p_polo;
  st := jsonb_set(g.state, '{clips}', coalesce(g.state->'clips', '{}'::jsonb) || jsonb_build_object(p_me::text, jsonb_build_object('polo', p_polo, 'at', now())));
  st := jsonb_set(st, '{skips}', coalesce(st->'skips', '{}'::jsonb) - p_me::text);
  update holler.games set state = st,
    secret = jsonb_set(coalesce(secret, '{}'::jsonb), '{answers}', coalesce(secret->'answers', '{}'::jsonb) || jsonb_build_object(p_me::text, w)),
    version = version + 1, updated_at = now() where id = g.id;
  select split_part(name, ' ', 1) into nm from holler.people where id = p_me;
  perform holler.push_to(g.chat_id, array(select x::uuid from jsonb_array_elements_text(g.state->'order') x where x <> p_me::text),
    coalesce(nm, 'Someone') || ' filmed something for Zoom In. What is it?');
  perform holler.zoom_advance(p_game);
end $$;

-- A move: { skip: true } (just guess) | { who, at, guess } | { who, got: true|false }
create or replace function public.holler_zoom_move(p_token text, p_game uuid, p_move jsonb) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; who text := p_move->>'who'; e jsonb; gs jsonb; t text; pos numeric; left_n int; nm text;
begin
  perform holler.game_tick(p_game);
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) or g.kind <> 'zoom' then raise exception 'That game is gone.'; end if;
  if g.status <> 'playing' then raise exception 'This game is over.'; end if;
  if not coalesce((g.state->'order') ? me::text, false) then raise exception 'You are not in that game.'; end if;
  gs := coalesce(g.state->'guesses', '{}'::jsonb);
  if coalesce((p_move->>'skip')::boolean, false) then
    if coalesce((g.state->'clips') ? me::text, false) then raise exception 'You already filmed yours.'; end if;
    if not coalesce((g.state->'skips') ? me::text, false) then
      select count(*) into left_n from jsonb_array_elements_text(g.state->'order') p
       where p <> me::text and holler.is_member(g.chat_id, p::uuid)
         and not coalesce((g.state->'clips') ? p, false) and not coalesce((g.state->'skips') ? p, false);
      if coalesce(g.state->'clips', '{}'::jsonb) = '{}'::jsonb and left_n = 0 then
        raise exception 'Someone has to film one, and everyone else is just guessing.';
      end if;
      update holler.games set state = jsonb_set(state, '{skips}', coalesce(state->'skips', '{}'::jsonb) || jsonb_build_object(me::text, now())),
        version = version + 1, updated_at = now() where id = g.id;
    end if;
  elsif who is null or who = me::text or not coalesce((g.state->'clips') ? who, false) then
    raise exception 'That clip is gone.';
  elsif p_move ? 'guess' then
    if gs->who->(me::text) is not null then raise exception 'You already guessed this one.'; end if;
    t := btrim(regexp_replace(coalesce(p_move->>'guess', ''), '\s+', ' ', 'g'));
    if length(t) not between 1 and 40 then raise exception 'Type a guess, up to 40 letters.'; end if;
    begin pos := (p_move->>'at')::numeric; exception when others then pos := 1; end;
    pos := round(greatest(0, least(coalesce(pos, 1), 1)), 3);
    gs := gs || jsonb_build_object(who, coalesce(gs->who, '{}'::jsonb) || jsonb_build_object(me::text,
            jsonb_build_object('at', pos, 'text', t, 'got', null, 'ts', now())));
    update holler.games set state = jsonb_set(state, '{guesses}', gs), version = version + 1, updated_at = now() where id = g.id;
    select split_part(name, ' ', 1) into nm from holler.people where id = me;
    perform holler.push_to(g.chat_id, array[who::uuid], coalesce(nm, 'Someone') || ' guessed "' || t || '" for your Zoom In');
  elsif p_move ? 'got' then
    e := gs->who->(me::text);
    if e is null then raise exception 'Guess it first.'; end if;
    if jsonb_typeof(e->'got') = 'boolean' then raise exception 'You already said.'; end if;
    if jsonb_typeof(p_move->'got') is distinct from 'boolean' then raise exception 'Did you get it? Yes or no.'; end if;
    gs := gs || jsonb_build_object(who, gs->who || jsonb_build_object(me::text, e || jsonb_build_object('got', p_move->'got')));
    update holler.games set state = jsonb_set(state, '{guesses}', gs), version = version + 1, updated_at = now() where id = g.id;
  else
    raise exception 'That is not a move.';
  end if;
  perform holler.zoom_advance(p_game);
  select * into g from holler.games where id = p_game;
  return holler.game_json(g, me);
end $$;

-- ---------- Who Said It ----------
-- How many answers about p_about someone other than p_me wrote (two or more: p_me has something to match).
create or replace function holler.said_n(g holler.games, p_about text, p_me text) returns int
language sql stable as $$
  select count(*)::int from jsonb_object_keys(coalesce(g.secret->'answers'->p_about, '{}'::jsonb)) w where w <> p_me
$$;

create or replace function holler.said_todo(g holler.games) returns jsonb
language sql stable security definer set search_path = holler as $$
  select coalesce(jsonb_agg(p), '[]') from jsonb_array_elements_text(g.state->'order') p
   where holler.is_member(g.chat_id, p::uuid)
     and case when g.state->>'phase' = 'write' then not coalesce((g.state->'wrote') ? p, false)
              else exists (select 1 from jsonb_array_elements_text(g.state->'order') a
                            where holler.said_n(g, a, p) >= 2 and not coalesce((g.state->'guesses'->p) ? a, false)) end
$$;

-- { who: {right, fooled} }
create or replace function holler.said_scores(g holler.games) returns jsonb
language sql stable security definer set search_path = holler as $$
  with pk as (
    select gu.key guesser, b.key about, p.key k, p.value picked
      from jsonb_each(coalesce(g.state->'guesses', '{}'::jsonb)) gu, jsonb_each(gu.value) b,
           jsonb_each_text(coalesce(b.value->'picks', '{}'::jsonb)) p),
  tr as (
    select a.key about, w.key writer, w.value->>'k' k
      from jsonb_each(coalesce(g.secret->'answers', '{}'::jsonb)) a, jsonb_each(a.value) w),
  j as (select pk.guesser, pk.picked, tr.writer from pk join tr on tr.about = pk.about and tr.k = pk.k)
  select coalesce(jsonb_object_agg(o, jsonb_build_object(
    'right', (select count(*) from j where j.guesser = o and j.picked = j.writer),
    'fooled', (select count(*) from j where j.writer = o and j.picked <> j.writer))), '{}'::jsonb)
  from jsonb_array_elements_text(g.state->'order') o
$$;

create or replace function holler.said_json(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select holler.game_base(g, p_me) || jsonb_build_object(
    'phase', g.state->'phase', 'since', g.state->'since',
    'wrote', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(coalesce(g.state->'wrote', '{}'::jsonb)) k),
    'scores', holler.said_scores(g),
    'boards', (select coalesce(jsonb_agg(jsonb_build_object(
        'about', x.p,
        -- the prompt about you stays hidden while everyone writes
        'prompt', case when x.p <> p_me::text or g.state->>'phase' = 'guess' or g.status <> 'playing' then g.state->'prompts'->x.p end,
        'n', holler.said_n(g, x.p, p_me::text),
        'open', o.open,
        'mine', g.state->'guesses'->(p_me::text)->x.p,
        'guesses', case when o.open then (select coalesce(jsonb_object_agg(gu.key, gu.value->x.p), '{}'::jsonb)
                                            from jsonb_each(coalesce(g.state->'guesses', '{}'::jsonb)) gu where gu.value ? x.p) end,
        -- your own answers always; everyone's once guessing starts; who wrote which only once it's open to you
        'answers', (select coalesce(jsonb_agg(jsonb_build_object('k', w.value->>'k', 'text', w.value->>'text',
                       'who', case when o.open or w.key = p_me::text then w.key end) order by w.value->>'k'), '[]')
                     from jsonb_each(coalesce(g.secret->'answers'->x.p, '{}'::jsonb)) w
                    where w.key = p_me::text or g.state->>'phase' = 'guess' or g.status <> 'playing')
      ) order by x.k), '[]')
      from jsonb_array_elements_text(g.state->'order') with ordinality x(p, k),
           lateral (select g.status <> 'playing'
                           or (g.state->>'phase' = 'guess' and (coalesce((g.state->'guesses'->(p_me::text)) ? x.p, false)
                                                                 or holler.said_n(g, x.p, p_me::text) < 2)) as open) o)
  )
$$;

create or replace function holler.said_advance(p_game uuid) returns void
language plpgsql security definer set search_path = holler, public as $$
declare g holler.games; todo jsonb; n int;
begin
  select * into g from holler.games where id = p_game for update;
  if g.id is null or g.status <> 'playing' then return; end if;
  todo := holler.said_todo(g);
  if g.state->>'phase' = 'write' then
    if jsonb_array_length(todo) > 0 and (g.state->>'since')::timestamptz > now() - interval '48 hours' then
      if todo is distinct from g.state->'todo' then
        update holler.games set state = jsonb_set(state, '{todo}', todo), version = version + 1 where id = g.id;
      end if;
      return;
    end if;
    select count(*) into n from jsonb_object_keys(coalesce(g.state->'wrote', '{}'::jsonb));
    if n < 2 then
      update holler.games set state = jsonb_set(state, '{todo}', '[]'), status = 'ended', ended_at = now(),
        version = version + 1, updated_at = now() where id = g.id;
      return;
    end if;
    update holler.games set state = state || jsonb_build_object('phase', 'guess', 'since', now()),
      version = version + 1, updated_at = now() where id = g.id returning * into g;
    todo := holler.said_todo(g);
    update holler.games set state = jsonb_set(state, '{todo}', todo) where id = g.id returning * into g;
    if jsonb_array_length(todo) > 0 then
      perform holler.push_to(g.chat_id, array(select x::uuid from jsonb_array_elements_text(todo) x),
        'Who Said It: everyone wrote. Now guess who said what about you.');
      return;
    end if;
  end if;
  if jsonb_array_length(todo) > 0 and (g.state->>'since')::timestamptz > now() - interval '48 hours' then
    if todo is distinct from g.state->'todo' then
      update holler.games set state = jsonb_set(state, '{todo}', todo), version = version + 1 where id = g.id;
    end if;
    return;
  end if;
  update holler.games set state = jsonb_set(state, '{todo}', '[]'), status = 'done', ended_at = now(),
    version = version + 1, updated_at = now() where id = g.id;
  perform holler.push_to(g.chat_id, array(select jsonb_array_elements_text(g.state->'order')::uuid), 'Who Said It: see who said what');
end $$;

-- A move: { write: {about: text, ...} } (one for everyone else) | { about, picks: {k: writer} } (each writer once)
create or replace function public.holler_said_move(p_token text, p_game uuid, p_move jsonb) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; sec jsonb; p text; t text; about text := p_move->>'about'; picks jsonb;
begin
  perform holler.game_tick(p_game);
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) or g.kind <> 'said' then raise exception 'That game is gone.'; end if;
  if g.status <> 'playing' then raise exception 'This game is over.'; end if;
  if not coalesce((g.state->'order') ? me::text, false) then raise exception 'You are not in that game.'; end if;
  if p_move ? 'write' then
    if g.state->>'phase' <> 'write' then raise exception 'The writing is over. Time to guess.'; end if;
    if coalesce((g.state->'wrote') ? me::text, false) then raise exception 'You already sent yours.'; end if;
    if jsonb_typeof(p_move->'write') is distinct from 'object' then raise exception 'Write one for everyone.'; end if;
    sec := coalesce(g.secret, '{}'::jsonb);
    for p in select x from jsonb_array_elements_text(g.state->'order') x where x <> me::text loop
      t := btrim(regexp_replace(coalesce(p_move->'write'->>p, ''), '\s+', ' ', 'g'));
      if length(t) not between 1 and 80 then raise exception 'Write one for everyone, up to 80 letters each.'; end if;
      sec := jsonb_set(sec, '{answers}', coalesce(sec->'answers', '{}'::jsonb) || jsonb_build_object(p,
               coalesce(sec->'answers'->p, '{}'::jsonb) || jsonb_build_object(me::text,
                 jsonb_build_object('k', substr(md5(random()::text || clock_timestamp()::text || p), 1, 10), 'text', t))));
    end loop;
    update holler.games set secret = sec, state = jsonb_set(state, '{wrote}', coalesce(state->'wrote', '{}'::jsonb) || jsonb_build_object(me::text, now())),
      version = version + 1, updated_at = now() where id = g.id;
  elsif about is not null and p_move ? 'picks' then
    if g.state->>'phase' <> 'guess' then raise exception 'Everyone has to write first.'; end if;
    if not coalesce((g.state->'order') ? about, false) then raise exception 'That one is gone.'; end if;
    if coalesce((g.state->'guesses'->(me::text)) ? about, false) then raise exception 'You already matched this one.'; end if;
    if holler.said_n(g, about, me::text) < 2 then raise exception 'Nothing to match there.'; end if;
    if jsonb_typeof(p_move->'picks') is distinct from 'object' then raise exception 'Match every answer to one person.'; end if;
    select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into picks from jsonb_each_text(p_move->'picks') e(k, v);
    -- every answer that isn't yours gets a pick, and every one of their writers is picked once
    if (select coalesce(jsonb_agg(w.value->>'k' order by w.value->>'k'), '[]') from jsonb_each(g.secret->'answers'->about) w where w.key <> me::text)
         is distinct from (select coalesce(jsonb_agg(k order by k), '[]') from jsonb_object_keys(picks) k)
       or (select coalesce(jsonb_agg(w.key order by w.key), '[]') from jsonb_each(g.secret->'answers'->about) w where w.key <> me::text)
         is distinct from (select coalesce(jsonb_agg(v order by v), '[]') from jsonb_each_text(picks) e(k, v)) then
      raise exception 'Match every answer to one person.';
    end if;
    update holler.games set state = jsonb_set(state, '{guesses}', coalesce(state->'guesses', '{}'::jsonb) || jsonb_build_object(me::text,
        coalesce(state->'guesses'->(me::text), '{}'::jsonb) || jsonb_build_object(about, jsonb_build_object('picks', picks, 'at', now())))),
      version = version + 1, updated_at = now() where id = g.id;
  else
    raise exception 'That is not a move.';
  end if;
  perform holler.said_advance(p_game);
  select * into g from holler.games where id = p_game;
  return holler.game_json(g, me);
end $$;

-- ---------- the dispatchers and start, now knowing both new games ----------
create or replace function holler.game_json(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select case g.kind when 'poker' then holler.poker_json(g, p_me) when 'charades' then holler.charades_json(g, p_me)
         when 'ttt' then holler.duel_json(g, p_me) when 'checkers' then holler.duel_json(g, p_me)
         when 'words' then holler.quick_json(g, p_me) when 'trivia' then holler.quick_json(g, p_me)
         when 'spot' then holler.spot_json(g, p_me) when 'laugh' then holler.laugh_json(g, p_me)
         when 'lastcard' then holler.lc_json(g, p_me)
         when 'zoom' then holler.zoom_json(g, p_me) when 'said' then holler.said_json(g, p_me)
         else holler.pass_json(g, p_me) end
$$;

create or replace function holler.game_tick(p_game uuid) returns void
language plpgsql security definer set search_path = holler, public as $$
declare k text;
begin
  select kind into k from holler.games where id = p_game;
  if k = 'poker' then perform holler.poker_advance(p_game);
  elsif k = 'charades' then perform holler.charades_advance(p_game);
  elsif k in ('ttt', 'checkers') then perform holler.duel_tick(p_game);
  elsif k = 'laugh' then perform holler.laugh_advance(p_game);
  elsif k in ('words', 'trivia', 'spot') then perform holler.quick_advance(p_game);
  elsif k = 'lastcard' then perform holler.lc_tick(p_game);
  elsif k = 'zoom' then perform holler.zoom_advance(p_game);
  elsif k = 'said' then perform holler.said_advance(p_game);
  elsif k is not null then perform holler.pass_tick(p_game);
  end if;
end $$;

create or replace function holler.game_take_turn(p_polo uuid, p_me uuid, p_effects jsonb) returns void
language plpgsql security definer set search_path = holler, public as $$
declare gid uuid; k text;
begin
  begin gid := (p_effects->'game'->>'id')::uuid; exception when others then raise exception 'That game is gone.'; end;
  select g.kind into k from holler.games g join holler.polos po on po.chat_id = g.chat_id where g.id = gid and po.id = p_polo;
  if k is null then raise exception 'That game is gone.'; end if;
  if k = 'poker' then perform holler.poker_take_turn(p_polo, p_me, gid);
  elsif k = 'charades' then perform holler.charades_take_turn(p_polo, p_me, gid, p_effects->'game'->>'word');
  elsif k = 'spot' then perform holler.spot_take_turn(p_polo, p_me, gid, p_effects->'game'->'picks');
  elsif k = 'laugh' then perform holler.laugh_take_turn(p_polo, p_me, gid, p_effects->'game');
  elsif k = 'zoom' then perform holler.zoom_take_turn(p_polo, p_me, gid, p_effects->'game'->>'word');
  elsif k = 'passiton' then perform holler.pass_take_turn(p_polo, p_me, p_effects);
  else raise exception 'That game does not take a holler.';
  end if;
end $$;

create or replace function public.holler_game_start2(p_token text, p_chat uuid, p_kind text, p_order uuid[], p_opts jsonb)
returns jsonb language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; n int; x uuid; q text; ans text; sec int; nm text; rack text; qids jsonb;
begin
  if not holler.is_member(p_chat, me) then raise exception 'not in this chat'; end if;
  if p_kind not in ('poker', 'charades', 'ttt', 'checkers', 'words', 'trivia', 'spot', 'laugh', 'zoom', 'said') then raise exception 'Unknown game'; end if;
  n := coalesce(array_length(p_order, 1), 0);
  if p_kind = 'poker' and (n < 3 or n > 5) then raise exception 'Poker Face needs 3 to 5 people.'; end if;
  if p_kind in ('charades', 'words', 'trivia', 'spot', 'laugh') and (n < 2 or n > 5) then raise exception '% needs 2 to 5 people.', holler.game_label(p_kind); end if;
  if p_kind = 'zoom' and (n < 2 or n > 6) then raise exception 'Zoom In needs 2 to 6 people.'; end if;
  if p_kind = 'said' and (n < 3 or n > 6) then raise exception 'Who Said It needs 3 to 6 people.'; end if;
  if p_kind in ('ttt', 'checkers') and n <> 2 then raise exception '% is for 2 people.', holler.game_label(p_kind); end if;
  if not (me = any(p_order)) then raise exception 'You have to be in a game you start.'; end if;
  if (select count(distinct y) from unnest(p_order) y) <> n then raise exception 'Someone is in the game twice.'; end if;
  foreach x in array p_order loop
    if not holler.is_member(p_chat, x) then raise exception 'Everyone in the game has to be in this chat.'; end if;
  end loop;
  if (select count(*) from holler.games where chat_id = p_chat and status = 'playing') >= 6 then
    raise exception 'This chat already has 6 games going. Finish one first.';
  end if;
  if p_kind = 'poker' then
    q := trim(coalesce(p_opts->>'question', '')); ans := trim(coalesce(p_opts->>'answer', ''));
    if length(q) not between 1 and 300 or length(ans) not between 1 and 200 then raise exception 'Pick a card.'; end if;
    insert into holler.games (chat_id, kind, state, secret, created_by)
    values (p_chat, 'poker',
      jsonb_build_object('order', to_jsonb(p_order), 'deck', left(coalesce(p_opts->>'deck', ''), 20), 'cardId', left(coalesce(p_opts->>'cardId', ''), 80),
                         'question', q, 'phase', 'record', 'since', now(), 'clips', '{}'::jsonb, 'votes', '{}'::jsonb, 'todo', to_jsonb(p_order)),
      jsonb_build_object('truth', p_order[1 + floor(random() * n)::int], 'answer', ans), me)
    returning * into g;
  elsif p_kind = 'charades' then
    sec := coalesce((p_opts->>'turnSec')::int, 15);
    if sec not in (10, 15, 20) then raise exception 'Turns are 10, 15 or 20 seconds.'; end if;
    insert into holler.games (chat_id, kind, state, secret, created_by)
    values (p_chat, 'charades',
      jsonb_build_object('order', to_jsonb(p_order), 'turnSec', sec, 'deck', left(coalesce(p_opts->>'deck', 'mixed'), 20),
                         'acts', '{}'::jsonb, 'guesses', '{}'::jsonb, 'todo', to_jsonb(p_order)),
      jsonb_build_object('words', '{}'::jsonb), me)
    returning * into g;
  elsif p_kind in ('ttt', 'checkers') then
    insert into holler.games (chat_id, kind, state, secret, turn_person, turn_since, created_by)
    values (p_chat, p_kind,
      jsonb_build_object('order', to_jsonb(p_order), 'board', case p_kind when 'ttt' then '.........' else holler.ck_start() end,
                         'moves', 0, 'quiet', 0, 'last', null, 'winner', null, 'result', null),
      '{}'::jsonb, p_order[1], now(), me)
    returning * into g;
  elsif p_kind = 'words' then
    rack := lower(coalesce(p_opts->>'rack', ''));
    if rack !~ '^[a-z]{7}$' then raise exception 'Pick seven letters.'; end if;
    sec := coalesce((p_opts->>'turnSec')::int, 90);
    if sec not in (60, 90, 120) then raise exception 'A go is 60, 90 or 120 seconds.'; end if;
    insert into holler.games (chat_id, kind, state, secret, created_by)
    values (p_chat, 'words',
      jsonb_build_object('order', to_jsonb(p_order), 'turnSec', sec, 'deck', 'letters', 'since', now(),
                         'began', '{}'::jsonb, 'plays', '{}'::jsonb, 'todo', to_jsonb(p_order)),
      jsonb_build_object('rack', rack), me)
    returning * into g;
  elsif p_kind = 'spot' then
    -- three questions each, different for everyone: { who: [id, id, id] }
    qids := coalesce(p_opts->'qids', '{}');
    if jsonb_typeof(qids) <> 'object' or exists (select 1 from unnest(p_order) u where not (qids ? u::text))
       or exists (select 1 from jsonb_each(qids) e where jsonb_typeof(e.value) <> 'array' or jsonb_array_length(e.value) <> 3
                    or exists (select 1 from jsonb_array_elements(e.value) z where jsonb_typeof(z) <> 'string' or (z #>> '{}') !~ '^[a-z]{2,12}-[0-9]{1,3}$')) then
      raise exception 'Pick the questions.';
    end if;
    insert into holler.games (chat_id, kind, state, secret, created_by)
    values (p_chat, 'spot',
      jsonb_build_object('order', to_jsonb(p_order), 'turnSec', 10, 'deck', left(coalesce(p_opts->>'deck', 'mixed'), 20), 'since', now(),
                         'began', '{}'::jsonb, 'plays', '{}'::jsonb, 'todo', to_jsonb(p_order)),
      jsonb_build_object('qids', (select jsonb_object_agg(u::text, qids->(u::text)) from unnest(p_order) u)), me)
    returning * into g;
  elsif p_kind = 'laugh' then
    sec := coalesce((p_opts->>'turnSec')::int, 15);
    if sec not in (10, 15, 20) then raise exception 'Clips are 10, 15 or 20 seconds.'; end if;
    insert into holler.games (chat_id, kind, state, secret, created_by)
    values (p_chat, 'laugh',
      jsonb_build_object('order', to_jsonb(p_order), 'turnSec', sec, 'acts', '{}'::jsonb, 'watches', '{}'::jsonb, 'todo', to_jsonb(p_order)),
      '{}'::jsonb, me)
    returning * into g;
  elsif p_kind = 'zoom' then
    insert into holler.games (chat_id, kind, state, secret, created_by)
    values (p_chat, 'zoom',
      jsonb_build_object('order', to_jsonb(p_order), 'turnSec', 5, 'clips', '{}'::jsonb, 'skips', '{}'::jsonb,
                         'guesses', '{}'::jsonb, 'todo', to_jsonb(p_order)),
      jsonb_build_object('answers', '{}'::jsonb), me)
    returning * into g;
  elsif p_kind = 'said' then
    -- one prompt about each person, all different: { who: 'said-07' }
    qids := coalesce(p_opts->'prompts', '{}');
    if jsonb_typeof(qids) <> 'object' or exists (select 1 from unnest(p_order) u where not (qids ? u::text))
       or exists (select 1 from unnest(p_order) u where jsonb_typeof(qids->(u::text)) <> 'string' or (qids->>(u::text)) !~ '^said-[0-9]{1,3}$')
       or (select count(distinct qids->>(u::text)) from unnest(p_order) u) <> n then
      raise exception 'Pick the prompts.';
    end if;
    insert into holler.games (chat_id, kind, state, secret, created_by)
    values (p_chat, 'said',
      jsonb_build_object('order', to_jsonb(p_order), 'phase', 'write', 'since', now(),
                         'prompts', (select jsonb_object_agg(u::text, qids->(u::text)) from unnest(p_order) u),
                         'wrote', '{}'::jsonb, 'guesses', '{}'::jsonb, 'todo', to_jsonb(p_order)),
      jsonb_build_object('answers', '{}'::jsonb), me)
    returning * into g;
  else
    qids := coalesce(p_opts->'qids', '[]');
    if jsonb_typeof(qids) <> 'array' or jsonb_array_length(qids) not between 5 and 15
       or exists (select 1 from jsonb_array_elements(qids) y where jsonb_typeof(y) <> 'string' or (y #>> '{}') !~ '^[a-z]{2,12}-[0-9]{1,3}$') then
      raise exception 'Pick the questions.';
    end if;
    insert into holler.games (chat_id, kind, state, secret, created_by)
    values (p_chat, 'trivia',
      jsonb_build_object('order', to_jsonb(p_order), 'turnSec', 15, 'deck', left(coalesce(p_opts->>'deck', 'mixed'), 20), 'since', now(),
                         'began', '{}'::jsonb, 'plays', '{}'::jsonb, 'todo', to_jsonb(p_order)),
      jsonb_build_object('qids', qids), me)
    returning * into g;
  end if;
  select split_part(name, ' ', 1) into nm from holler.people where id = me;
  perform holler.push_to(p_chat, array(select y from unnest(p_order) y where y <> me),
    coalesce(nm, 'Someone') || ' started ' || holler.game_label(p_kind) || case when p_kind in ('ttt', 'checkers') then ' with you.' else '. You''re in.' end);
  return holler.game_json(g, me);
end $$;

revoke all on function holler.zoom_todo(holler.games), holler.zoom_json(holler.games, uuid), holler.zoom_advance(uuid),
  holler.zoom_take_turn(uuid, uuid, uuid, text), holler.said_n(holler.games, text, text), holler.said_todo(holler.games),
  holler.said_scores(holler.games), holler.said_json(holler.games, uuid), holler.said_advance(uuid),
  holler.game_json(holler.games, uuid), holler.game_tick(uuid), holler.game_take_turn(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.holler_zoom_move(text, uuid, jsonb), public.holler_said_move(text, uuid, jsonb),
  public.holler_game_start2(text, uuid, text, uuid[], jsonb)
to anon, authenticated;

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

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

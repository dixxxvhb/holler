-- Holler Play, round seven (2026-11-27): Zoom In lets the filmer pick where it starts; Charades knows a close answer.
-- Additive. Replaces holler.charades_norm, holler.charades_match, holler.zoom_json and holler.game_take_turn (the
-- last two are the games7 versions with one change each, so every other kind behaves exactly as before), and adds
-- small helpers, a 5-argument holler.zoom_take_turn, and public.holler_charades_count. No rows are rewritten and
-- nothing is dropped. Safe to run twice.
--
-- Zoom In: after the take the filmer pinches to where it should start. The clip comes in with
--   effects.game = {id, word, focus: {x, y, z}}: x and y are 0 to 1 in the video frame (the middle of the zoomed
--   view), z is how far in it starts. It is kept in state.clips[who].focus (checked: numbers, x and y 0 to 1,
--   z 1.5 to 12; anything missing or wrong becomes {0.5, 0.5, 8}, the old start) and shown to everyone: it is not
--   secret. A clip from before this (no focus) has none and plays exactly as before.
-- Charades: a guess is right when it is basically right (see charades_match). And the actor can count a near miss
--   by someone who finished without getting it (holler_charades_count): it then counts as right, at the slowest
--   time, so it scores the fewest points, and shows as counted.

-- ---------- Charades: a smarter answer check ----------
-- Edit distance for short words (no fuzzystrmatch here). Two letters swapped counts as one slip (pengiun).
create or replace function holler.ch_lev(a text, b text) returns int
language plpgsql immutable as $$
declare la int := length(a); lb int := length(b); w int := length(b) + 1; d int[]; i int; j int; cost int; v int;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  d := array_fill(0, array[(la + 1) * w]);
  for i in 0..la loop d[i * w + 1] := i; end loop;
  for j in 0..lb loop d[j + 1] := j; end loop;
  for i in 1..la loop
    for j in 1..lb loop
      cost := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
      v := least(d[(i - 1) * w + j + 1] + 1, d[i * w + j] + 1, d[(i - 1) * w + j] + cost);
      if i > 1 and j > 1 and substr(a, i, 1) = substr(b, j - 1, 1) and substr(a, i - 1, 1) = substr(b, j, 1) then
        v := least(v, d[(i - 2) * w + j - 1] + 1);
      end if;
      d[i * w + j + 1] := v;
    end loop;
  end loop;
  return d[la * w + lb + 1];
end $$;

-- The words of a guess or an answer: lowercase, & is and, apostrophes gone, other punctuation splits words,
-- little words dropped.
create or replace function holler.ch_words(s text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(w order by n), '{}') from regexp_split_to_table(
    regexp_replace(regexp_replace(replace(lower(coalesce(s, '')), '&', ' and '), '[''’`]', '', 'g'), '[^a-z0-9]+', ' ', 'g'), ' ')
    with ordinality as t(w, n)
  where w <> '' and w not in ('the', 'a', 'an', 'of', 'with', 'and', 'in', 'on', 'to', 'at', 'for', 'my', 'your', 'is', 'it', 'doing', 'playing')
$$;

-- So dance, dancing, dances and danced all meet: ing (over 5 letters), es after s/x/z/ch/sh or a plain s (over 3,
-- never a double s), ed (over 4), then a trailing e (over 4). A doubled last letter left by ing or ed loses one
-- (running is run, hopped is hop).
create or replace function holler.ch_stem(w text) returns text
language plpgsql immutable as $$
declare s text := coalesce(w, ''); cut boolean := false;
begin
  if length(s) > 5 and right(s, 3) = 'ing' then s := left(s, -3); cut := true;
  elsif length(s) > 3 and s ~ '(s|x|z|ch|sh)es$' then s := left(s, -2);
  elsif length(s) > 3 and right(s, 1) = 's' and right(s, 2) <> 'ss' then s := left(s, -1);
  elsif length(s) > 4 and right(s, 2) = 'ed' then s := left(s, -2); cut := true;
  end if;
  if cut and s ~ '([bdgmnpt])\1$' then s := left(s, -1); end if;
  if length(s) > 4 and right(s, 1) = 'e' then s := left(s, -1); end if;
  return s;
end $$;

-- Words that say what kind of thing it is, not which one: they don't have to be guessed.
create or replace function holler.ch_generic(stem text) returns boolean
language sql immutable as $$
  select stem in ('danc', 'move', 'step', 'song', 'movi', 'show', 'game', 'thing', 'person', 'doing')
$$;

-- Two words match: same stem; one letter off when both have 5 to 8 letters, two when both have 9 or more; or one
-- starts the other, sharing at least 5 letters. A 4-letter word only takes one extra letter on the end (star, starz):
-- one letter off at 4 letters let lawn pass for yawn and king for kong. Words under 4 letters must be exact.
create or replace function holler.ch_word_eq(a text, b text) returns boolean
language plpgsql immutable as $$
declare n int := least(length(a), length(b)); mx int := greatest(length(a), length(b));
begin
  if a = b then return true; end if;
  if n = 4 and mx = 5 and (left(a, 4) = b or left(b, 4) = a) then return true; end if;
  if n between 5 and 8 and holler.ch_lev(a, b) <= 1 then return true; end if;
  if n >= 9 and holler.ch_lev(a, b) <= 2 then return true; end if;
  if n >= 5 and left(a, n) = left(b, n) then return true; end if;
  return false;
end $$;

-- The whole thing run together, little words out: "moon walk" and "Moonwalk" are both moonwalk.
create or replace function holler.charades_norm(s text) returns text
language sql immutable as $$
  select array_to_string(holler.ch_words(s), '')
$$;

-- Right when the guess is basically right:
--   every answer word that matters is matched by some guess word (a kind-of word like dance, song or movie does not
--   have to be guessed when it comes after the real word: "Thriller dance" needs only thriller, but "Dancing with
--   the Stars" needs both dancing and stars); or the answer has 3 or more words that matter and two thirds are
--   matched; or, when the spacing differs, the whole thing run together is within a letter or so ("moon walk"); or the guess has the whole
--   answer in it, word for word. A guess of only little or kind-of words is never right.
create or replace function holler.charades_match(p_guess text, p_word text) returns boolean
language plpgsql immutable as $$
declare gw text[] := holler.ch_words(p_guess); aw text[] := holler.ch_words(p_word);
  gs text[]; ast text[]; am text[] := '{}'; ar text[] := '{}'; real_seen boolean := false; i int; n int; m int; gj text; aj text;
begin
  if cardinality(gw) = 0 then return false; end if;
  if cardinality(aw) = 0 then
    return lower(btrim(coalesce(p_guess, ''))) = lower(btrim(coalesce(p_word, ''))) and btrim(coalesce(p_word, '')) <> '';
  end if;
  gs := array(select holler.ch_stem(x) from unnest(gw) x);
  ast := array(select holler.ch_stem(x) from unnest(aw) x);
  for i in 1..cardinality(ast) loop
    if holler.ch_generic(ast[i]) and real_seen then continue; end if;
    am := am || ast[i]; ar := ar || aw[i];
    if not holler.ch_generic(ast[i]) then real_seen := true; end if;
  end loop;
  -- only kind-of words in the guess: never right (unless the answer is nothing but those)
  if real_seen and not exists (select 1 from unnest(gs) x where not holler.ch_generic(x)) then return false; end if;
  n := cardinality(am);
  -- a word matches on its stem, or as typed (a slip inside a short stem, like surqing for surfing, shows as typed)
  select count(*) into m from unnest(am, ar) a(st, raw)
   where exists (select 1 from unnest(gs, gw) g(st, raw) where holler.ch_word_eq(a.st, g.st) or holler.ch_word_eq(a.raw, g.raw));
  if m = n then return true; end if;
  if n >= 3 and m * 3 >= n * 2 then return true; end if;
  gj := array_to_string(gw, ''); aj := array_to_string(aw, '');
  -- run together only when the spacing differs (moon walk, hot dog); one word against one word is the word check's job
  if cardinality(gw) <> cardinality(aw) and length(aj) >= 4 and holler.ch_lev(gj, aj) <= greatest(1, length(aj) / 6) then return true; end if;
  if position(' ' || array_to_string(aw, ' ') || ' ' in ' ' || array_to_string(gw, ' ') || ' ') > 0 then return true; end if;
  return false;
end $$;

-- The actor counts a near miss: someone who finished without getting it now counts as right, at the clip's full
-- length (the fewest points), marked counted. Only that clip's actor, while the game is going or done.
create or replace function public.holler_charades_count(p_token text, p_game uuid, p_guesser uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; e jsonb; nm text;
begin
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) or g.kind <> 'charades' then raise exception 'That game is gone.'; end if;
  if g.status not in ('playing', 'done') then raise exception 'This game is over.'; end if;
  if not coalesce((g.state->'acts') ? me::text, false) then raise exception 'Only the one who acted it can count a guess.'; end if;
  e := g.state->'guesses'->me::text->p_guesser::text;
  if p_guesser = me or e is null then raise exception 'They have not guessed yours.'; end if;
  if coalesce((e->>'ok')::boolean, false) then raise exception 'That one already counts.'; end if;
  if not coalesce((e->>'done')::boolean, false) then raise exception 'They are still guessing.'; end if;
  e := e || jsonb_build_object('ok', true, 'done', true, 't', coalesce((g.state->>'turnSec')::real, 15), 'counted', true);
  update holler.games set state = jsonb_set(state, array['guesses', me::text, p_guesser::text], e), version = version + 1,
    updated_at = case when status = 'playing' then now() else updated_at end
   where id = g.id;
  select split_part(name, ' ', 1) into nm from holler.people where id = me;
  perform holler.push_to(g.chat_id, array[p_guesser], coalesce(nm, 'Someone') || ' counted your Charades guess. Close enough.');
  select * into g from holler.games where id = p_game;
  return holler.game_json(g, me);
end $$;

-- ---------- Zoom In: where it starts ----------
create or replace function holler.zoom_focus(f jsonb) returns jsonb
language plpgsql immutable as $$
declare x numeric; y numeric; z numeric;
begin
  if f is null or jsonb_typeof(f) <> 'object' or jsonb_typeof(f->'x') <> 'number' or jsonb_typeof(f->'y') <> 'number'
     or jsonb_typeof(f->'z') <> 'number' then
    return '{"x": 0.5, "y": 0.5, "z": 8}'::jsonb;
  end if;
  x := (f->>'x')::numeric; y := (f->>'y')::numeric; z := (f->>'z')::numeric;
  if x < 0 or x > 1 or y < 0 or y > 1 or z < 1.5 or z > 12 then return '{"x": 0.5, "y": 0.5, "z": 8}'::jsonb; end if;
  return jsonb_build_object('x', round(x, 3), 'y', round(y, 3), 'z', round(z, 2));
end $$;

create or replace function holler.zoom_take_turn(p_polo uuid, p_me uuid, p_game uuid, p_word text, p_focus jsonb) returns void
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
  st := jsonb_set(g.state, '{clips}', coalesce(g.state->'clips', '{}'::jsonb) || jsonb_build_object(p_me::text,
          jsonb_build_object('polo', p_polo, 'at', now(), 'focus', holler.zoom_focus(p_focus))));
  st := jsonb_set(st, '{skips}', coalesce(st->'skips', '{}'::jsonb) - p_me::text);
  update holler.games set state = st,
    secret = jsonb_set(coalesce(secret, '{}'::jsonb), '{answers}', coalesce(secret->'answers', '{}'::jsonb) || jsonb_build_object(p_me::text, w)),
    version = version + 1, updated_at = now() where id = g.id;
  select split_part(name, ' ', 1) into nm from holler.people where id = p_me;
  perform holler.push_to(g.chat_id, array(select x::uuid from jsonb_array_elements_text(g.state->'order') x where x <> p_me::text),
    coalesce(nm, 'Someone') || ' filmed something for Zoom In. What is it?');
  perform holler.zoom_advance(p_game);
end $$;

-- games7's zoom_json plus 'focus' (null for a clip from before)
create or replace function holler.zoom_json(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select holler.game_base(g, p_me) || jsonb_build_object(
    'filmed', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(coalesce(g.state->'clips', '{}'::jsonb)) k),
    'skipped', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(coalesce(g.state->'skips', '{}'::jsonb)) k),
    'shots', (select coalesce(jsonb_agg(jsonb_build_object(
        'who', c.key, 'at', c.value->'at', 'focus', c.value->'focus',
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

-- games7's game_take_turn; only the zoom line changes (it passes the focus along)
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
  elsif k = 'zoom' then perform holler.zoom_take_turn(p_polo, p_me, gid, p_effects->'game'->>'word', p_effects->'game'->'focus');
  elsif k = 'passiton' then perform holler.pass_take_turn(p_polo, p_me, p_effects);
  else raise exception 'That game does not take a holler.';
  end if;
end $$;

revoke all on function holler.ch_lev(text, text), holler.ch_words(text), holler.ch_stem(text), holler.ch_generic(text),
  holler.ch_word_eq(text, text), holler.zoom_focus(jsonb), holler.zoom_take_turn(uuid, uuid, uuid, text, jsonb),
  holler.zoom_json(holler.games, uuid), holler.game_take_turn(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.holler_charades_count(text, uuid, uuid) to anon, authenticated;

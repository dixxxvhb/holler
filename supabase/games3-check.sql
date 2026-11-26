-- Dry run: games3.sql + games3-tests.sql. Built by scripts/build-check.sh; aborts at the end on purpose.
-- Run: ssh pc "pwsh -NoProfile -File C:/Users/bowle/bin/pc-run.ps1 holler-sql games3-check.sql". Expect "GAMES3 CHECK PASSED".
begin;
-- Holler Play, round three (2026-11-26): Tic-Tac-Toe, Checkers, Seven Letters and Trivia.
-- Additive: widens games.kind, adds the new games' rules, and replaces the dispatchers, start and nudge
-- (same behaviour for the old games). No rows are rewritten and nothing is dropped except the old kind check.
-- Tic-Tac-Toe and Checkers are "duels": two people, turn_person is whose move it is, and the server checks
-- every move. Seven Letters and Trivia are "quick rounds" like Poker Face: everyone plays the same letters or
-- questions on their own time (state.todo), and the letters or questions stay hidden until you start your go.
-- Safe to run twice.

alter table holler.games drop constraint if exists games_kind_check;
alter table holler.games add constraint games_kind_check
  check (kind in ('passiton', 'poker', 'charades', 'ttt', 'checkers', 'words', 'trivia'));

create or replace function holler.game_label(p_kind text) returns text
language sql immutable as $$
  select case p_kind when 'poker' then 'Poker Face' when 'charades' then 'Charades Relay' when 'ttt' then 'Tic-Tac-Toe'
    when 'checkers' then 'Checkers' when 'words' then 'Seven Letters' when 'trivia' then 'Trivia' else 'Pass It On' end
$$;

-- ---------- checkers rules ----------
-- The board is 64 characters, row by row from the top: '.' empty, 'd'/'D' the first player's men/kings
-- (they start on the bottom three rows and move up), 'l'/'L' the second player's (top rows, moving down).
-- American rules: captures are compulsory, a jump must keep going while it can, and a man that reaches the far
-- row is crowned and its move ends there. Kings move one square in any diagonal direction.
create or replace function holler.ck_at(b text, r int, c int) returns text
language sql immutable as $$
  select case when r between 0 and 7 and c between 0 and 7 then substr(b, r * 8 + c + 1, 1) end
$$;

create or replace function holler.ck_dirs(ch text) returns int[]
language sql immutable as $$
  select case ch when 'd' then array[-1] when 'l' then array[1] when 'D' then array[-1, 1] when 'L' then array[-1, 1] else array[]::int[] end
$$;

create or replace function holler.ck_jumps(b text, i int) returns int[]
language plpgsql immutable as $$
declare ch text := substr(b, i + 1, 1); opp text; r int := i / 8; c int := i % 8; dr int; dc int; outv int[] := '{}';
begin
  opp := case lower(ch) when 'd' then 'l' when 'l' then 'd' end;
  if opp is null then return outv; end if;
  foreach dr in array holler.ck_dirs(ch) loop
    foreach dc in array array[-1, 1] loop
      if lower(holler.ck_at(b, r + dr, c + dc)) = opp and holler.ck_at(b, r + 2 * dr, c + 2 * dc) = '.' then
        outv := outv || ((r + 2 * dr) * 8 + c + 2 * dc);
      end if;
    end loop;
  end loop;
  return outv;
end $$;

create or replace function holler.ck_steps(b text, i int) returns int[]
language plpgsql immutable as $$
declare ch text := substr(b, i + 1, 1); r int := i / 8; c int := i % 8; dr int; dc int; outv int[] := '{}';
begin
  foreach dr in array holler.ck_dirs(ch) loop
    foreach dc in array array[-1, 1] loop
      if holler.ck_at(b, r + dr, c + dc) = '.' then outv := outv || ((r + dr) * 8 + c + dc); end if;
    end loop;
  end loop;
  return outv;
end $$;

create or replace function holler.ck_can_jump(b text, side text) returns boolean
language sql immutable as $$
  select exists (select 1 from generate_series(0, 63) i
                  where lower(substr(b, i + 1, 1)) = side and cardinality(holler.ck_jumps(b, i)) > 0)
$$;

create or replace function holler.ck_can_move(b text, side text) returns boolean
language sql immutable as $$
  select exists (select 1 from generate_series(0, 63) i
                  where lower(substr(b, i + 1, 1)) = side
                    and (cardinality(holler.ck_jumps(b, i)) > 0 or cardinality(holler.ck_steps(b, i)) > 0))
$$;

-- Plays one move (a path of squares) for side 'd' or 'l'. Raises in plain words when it is not allowed.
create or replace function holler.ck_play(b text, side text, path int[]) returns jsonb
language plpgsql immutable as $$
declare n int := coalesce(cardinality(path), 0); ch text; cur int; nxt int; k int; caps int := 0; crowned boolean := false; far int;
begin
  if n < 2 or n > 13 then raise exception 'That is not a move.'; end if;
  foreach cur in array path loop
    if cur is null or cur < 0 or cur > 63 then raise exception 'That is not a move.'; end if;
  end loop;
  ch := substr(b, path[1] + 1, 1);
  if lower(ch) is distinct from side then raise exception 'That is not your piece.'; end if;
  far := case side when 'd' then 0 else 7 end;
  if abs(path[2] / 8 - path[1] / 8) = 1 then
    if n <> 2 then raise exception 'That is not a move.'; end if;
    if holler.ck_can_jump(b, side) then raise exception 'You have a jump, and jumps are a must.'; end if;
    if not (path[2] = any(holler.ck_steps(b, path[1]))) then raise exception 'That piece cannot go there.'; end if;
    b := overlay(overlay(b placing '.' from path[1] + 1 for 1) placing ch from path[2] + 1 for 1);
    if ch = side and path[2] / 8 = far then
      ch := upper(ch); crowned := true; b := overlay(b placing ch from path[2] + 1 for 1);
    end if;
  else
    for k in 1 .. n - 1 loop
      cur := path[k]; nxt := path[k + 1];
      if crowned then raise exception 'A new king stops there.'; end if;
      if not (nxt = any(holler.ck_jumps(b, cur))) then raise exception 'That jump is not open.'; end if;
      b := overlay(b placing '.' from cur + 1 for 1);
      b := overlay(b placing '.' from (cur + nxt) / 2 + 1 for 1);
      b := overlay(b placing ch from nxt + 1 for 1);
      caps := caps + 1;
      if ch = side and nxt / 8 = far then
        ch := upper(ch); crowned := true; b := overlay(b placing ch from nxt + 1 for 1);
      end if;
    end loop;
    if not crowned and cardinality(holler.ck_jumps(b, path[n])) > 0 then raise exception 'Keep jumping. That piece has another jump.'; end if;
  end if;
  return jsonb_build_object('board', b, 'captured', caps, 'crowned', crowned);
end $$;

create or replace function holler.ck_start() returns text
language sql immutable as $$
  select string_agg(case when (r + c) % 2 = 1 and r <= 2 then 'l' when (r + c) % 2 = 1 and r >= 5 then 'd' else '.' end, '' order by r, c)
    from generate_series(0, 7) r, generate_series(0, 7) c
$$;

create or replace function holler.ttt_winner(b text) returns text
language sql immutable as $$
  select substr(b, l[1] + 1, 1) from (values (array[0,1,2]), (array[3,4,5]), (array[6,7,8]), (array[0,3,6]), (array[1,4,7]),
                                             (array[2,5,8]), (array[0,4,8]), (array[2,4,6])) v(l)
   where substr(b, l[1] + 1, 1) <> '.' and substr(b, l[1] + 1, 1) = substr(b, l[2] + 1, 1) and substr(b, l[1] + 1, 1) = substr(b, l[3] + 1, 1)
   limit 1
$$;

-- ---------- duels: Tic-Tac-Toe and Checkers ----------
-- state: { order: [first, second], board, moves, last, quiet, winner, result: win|draw|resign|idle }
create or replace function holler.duel_json(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select holler.game_base(g, p_me) || jsonb_build_object(
    'board', g.state->'board', 'moves', coalesce(g.state->'moves', '0'::jsonb), 'last', g.state->'last',
    'quiet', coalesce(g.state->'quiet', '0'::jsonb), 'winner', g.state->'winner', 'result', g.state->'result',
    'turnSince', g.turn_since)
$$;

-- A duel nobody has moved in for 7 days, or that lost a player, ends with no winner.
create or replace function holler.duel_tick(p_game uuid) returns void
language plpgsql security definer set search_path = holler, public as $$
declare g holler.games;
begin
  select * into g from holler.games where id = p_game for update;
  if g.id is null or g.status <> 'playing' then return; end if;
  if g.turn_since < now() - interval '7 days'
     or exists (select 1 from jsonb_array_elements_text(g.state->'order') x where not holler.is_member(g.chat_id, x::uuid)) then
    update holler.games set state = g.state || '{"result": "idle"}', status = 'ended', ended_at = now(), turn_person = null,
      turn_since = null, version = version + 1, updated_at = now() where id = g.id;
  end if;
end $$;

create or replace function public.holler_game_move(p_token text, p_game uuid, p_version int, p_move jsonb) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; st jsonb; b text; side text; other uuid; cell int; res jsonb;
  path int[]; win text; fin text; quiet int; nm text; lbl text;
begin
  perform holler.duel_tick(p_game);
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) then raise exception 'That game is gone.'; end if;
  if g.kind not in ('ttt', 'checkers') then raise exception 'Unknown game'; end if;
  if g.status <> 'playing' then raise exception 'This game is over.'; end if;
  if g.turn_person is distinct from me then raise exception 'It is not your move.'; end if;
  if p_version is distinct from g.version then raise exception 'The board changed. Have another look.'; end if;
  st := g.state; b := st->>'board';
  side := case when st->'order'->>0 = me::text then 'first' else 'second' end;
  other := (case side when 'first' then st->'order'->>1 else st->'order'->>0 end)::uuid;
  quiet := coalesce((st->>'quiet')::int, 0);

  if g.kind = 'ttt' then
    begin cell := (p_move->>'cell')::int; exception when others then cell := null; end;
    if cell is null or cell < 0 or cell > 8 then raise exception 'That is not a square.'; end if;
    if substr(b, cell + 1, 1) <> '.' then raise exception 'That square is taken.'; end if;
    b := overlay(b placing case side when 'first' then 'x' else 'o' end from cell + 1 for 1);
    if holler.ttt_winner(b) is not null then fin := 'win';
    elsif position('.' in b) = 0 then fin := 'draw';
    end if;
    st := st || jsonb_build_object('last', jsonb_build_object('cell', cell));
  else
    begin
      select array_agg(x::int order by k) into path from jsonb_array_elements_text(p_move->'path') with ordinality a(x, k);
    exception when others then raise exception 'That is not a move.';
    end;
    res := holler.ck_play(b, case side when 'first' then 'd' else 'l' end, path);
    b := res->>'board';
    quiet := case when (res->>'captured')::int > 0 then 0 else quiet + 1 end;
    if not holler.ck_can_move(b, case side when 'first' then 'l' else 'd' end) then fin := 'win';
    elsif quiet >= 80 then fin := 'draw';
    end if;
    st := st || jsonb_build_object('last', jsonb_build_object('path', to_jsonb(path), 'captured', (res->>'captured')::int));
  end if;

  st := st || jsonb_build_object('board', b, 'moves', coalesce((st->>'moves')::int, 0) + 1, 'quiet', quiet);
  select split_part(name, ' ', 1) into nm from holler.people where id = me;
  nm := coalesce(nm, 'Someone'); lbl := holler.game_label(g.kind);
  if fin is null then
    update holler.games set state = st, turn_person = other, turn_since = now(), version = version + 1, updated_at = now()
     where id = g.id returning * into g;
    perform holler.push_to(g.chat_id, array[other], nm || ' moved. Your turn in ' || lbl);
  else
    st := st || jsonb_build_object('result', fin, 'winner', case when fin = 'win' then to_jsonb(me) end);
    update holler.games set state = st, status = 'done', ended_at = now(), turn_person = null, turn_since = null,
      version = version + 1, updated_at = now() where id = g.id returning * into g;
    perform holler.push_to(g.chat_id, array[other], case when fin = 'win' then nm || ' won ' || lbl else lbl || ' ended in a draw' end);
  end if;
  return holler.game_json(g, me);
end $$;

create or replace function public.holler_game_resign(p_token text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; other uuid; nm text;
begin
  perform holler.duel_tick(p_game);
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) then raise exception 'That game is gone.'; end if;
  if g.kind not in ('ttt', 'checkers') then raise exception 'Only board games can be given up.'; end if;
  if not coalesce((g.state->'order') ? me::text, false) then raise exception 'You are not in that game.'; end if;
  if g.status = 'playing' then
    other := (select x::uuid from jsonb_array_elements_text(g.state->'order') x where x <> me::text limit 1);
    update holler.games set state = g.state || jsonb_build_object('result', 'resign', 'winner', other), status = 'done',
      ended_at = now(), turn_person = null, turn_since = null, version = version + 1, updated_at = now()
     where id = g.id returning * into g;
    select split_part(name, ' ', 1) into nm from holler.people where id = me;
    perform holler.push_to(g.chat_id, array[other], coalesce(nm, 'Someone') || ' gave up. You won ' || holler.game_label(g.kind));
  end if;
  return holler.game_json(g, me);
end $$;

-- ---------- quick rounds: Seven Letters and Trivia ----------
-- state: { order, todo, since, deck, turnSec, began: {who: at}, plays: {who: play} }
-- secret: { rack: 'seven letters' } or { qids: [question ids] }. Yours to see once you start your go.
create or replace function holler.quick_json(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select holler.game_base(g, p_me) || jsonb_build_object(
    'since', g.state->'since',
    'began', coalesce((g.state->'began') ? p_me::text, false),
    'beganAt', g.state->'began'->(p_me::text),
    'played', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(coalesce(g.state->'plays', '{}'::jsonb)) k),
    'rack', case when coalesce((g.state->'began') ? p_me::text, false) or g.status <> 'playing' then g.secret->'rack' end,
    'qids', case when coalesce((g.state->'began') ? p_me::text, false) or g.status <> 'playing' then g.secret->'qids' end,
    'myPlay', g.state->'plays'->(p_me::text),
    'plays', case when coalesce((g.state->'plays') ? p_me::text, false) or g.status <> 'playing' then g.state->'plays' end)
$$;

create or replace function holler.quick_advance(p_game uuid) returns void
language plpgsql security definer set search_path = holler, public as $$
declare g holler.games; st jsonb; todo jsonb; n int;
begin
  select * into g from holler.games where id = p_game for update;
  if g.id is null or g.status <> 'playing' then return; end if;
  st := g.state;
  select coalesce(jsonb_agg(x), '[]') into todo from jsonb_array_elements_text(coalesce(st->'todo', '[]')) x
   where holler.is_member(g.chat_id, x::uuid);
  if jsonb_array_length(todo) > 0 and (st->>'since')::timestamptz > now() - interval '48 hours' then
    if todo is distinct from st->'todo' then
      update holler.games set state = jsonb_set(st, '{todo}', todo), version = version + 1, updated_at = now() where id = g.id;
    end if;
    return;
  end if;
  select count(*) into n from jsonb_object_keys(coalesce(st->'plays', '{}'::jsonb));
  if n = 0 then
    update holler.games set state = jsonb_set(st, '{todo}', '[]'), status = 'ended', ended_at = now(),
      version = version + 1, updated_at = now() where id = g.id;
    return;
  end if;
  update holler.games set state = jsonb_set(st, '{todo}', '[]'), status = 'done', ended_at = now(),
    version = version + 1, updated_at = now() where id = g.id;
  perform holler.push_to(g.chat_id, array(select jsonb_array_elements_text(st->'order')::uuid), holler.game_label(g.kind) || ': the scores are in');
end $$;

-- Start your go: the clock starts now and the letters (or questions) are yours to see.
create or replace function public.holler_game_begin(p_token text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games;
begin
  perform holler.quick_advance(p_game);
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) then raise exception 'That game is gone.'; end if;
  if g.kind not in ('words', 'trivia') then raise exception 'Unknown game'; end if;
  if not coalesce((g.state->'order') ? me::text, false) then raise exception 'You are not in that game.'; end if;
  if g.status <> 'playing' then raise exception 'This game is over.'; end if;
  if not coalesce((g.state->'began') ? me::text, false) then
    update holler.games set state = jsonb_set(state, '{began}', coalesce(state->'began', '{}'::jsonb) || jsonb_build_object(me::text, now())),
      version = version + 1, updated_at = now() where id = g.id returning * into g;
  end if;
  return holler.game_json(g, me);
end $$;

-- Hand in your go. Seven Letters: { words: [...] }. Trivia: { answers: [{ pick: 0-3 or -1, ms }] }.
create or replace function public.holler_game_play(p_token text, p_game uuid, p_play jsonb) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; st jsonb; rack text; words jsonb; answers jsonb; n int; play jsonb;
begin
  perform holler.quick_advance(p_game);
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) then raise exception 'That game is gone.'; end if;
  if g.kind not in ('words', 'trivia') then raise exception 'Unknown game'; end if;
  if not coalesce((g.state->'order') ? me::text, false) then raise exception 'You are not in that game.'; end if;
  if g.status <> 'playing' then raise exception 'Time ran out on this game, so this one was not counted.'; end if;
  if not coalesce((g.state->'began') ? me::text, false) then raise exception 'Start your go first.'; end if;
  if coalesce((g.state->'plays') ? me::text, false) then raise exception 'You already played this one.'; end if;

  if g.kind = 'words' then
    rack := g.secret->>'rack';
    -- keep real-looking words that fit the letters, each once
    select coalesce(jsonb_agg(w order by w), '[]') into words from (
      select distinct w from jsonb_array_elements_text(coalesce(p_play->'words', '[]')) w
       where w ~ '^[a-z]{3,7}$'
         and not exists (select 1 from regexp_split_to_table(w, '') ch
                          group by ch having count(*) > length(rack) - length(replace(rack, ch, '')))
       limit 300) q;
    play := jsonb_build_object('words', words, 'at', now());
  else
    n := jsonb_array_length(coalesce(g.secret->'qids', '[]'));
    if jsonb_typeof(p_play->'answers') <> 'array' or jsonb_array_length(p_play->'answers') <> n then raise exception 'Answer every question.'; end if;
    select jsonb_agg(jsonb_build_object(
             'pick', case when (a->>'pick') ~ '^-?[0-9]$' and (a->>'pick')::int between -1 and 3 then (a->>'pick')::int else -1 end,
             'ms', case when (a->>'ms') ~ '^[0-9]{1,6}$' then least((a->>'ms')::int, 60000) else 60000 end) order by k)
      into answers from jsonb_array_elements(p_play->'answers') with ordinality x(a, k);
    play := jsonb_build_object('answers', answers, 'at', now());
  end if;

  st := jsonb_set(g.state, '{plays}', coalesce(g.state->'plays', '{}'::jsonb) || jsonb_build_object(me::text, play));
  st := jsonb_set(st, '{todo}', (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements_text(coalesce(st->'todo', '[]')) x where x <> me::text));
  update holler.games set state = st, version = version + 1, updated_at = now() where id = g.id;
  perform holler.quick_advance(p_game);
  select * into g from holler.games where id = p_game;
  return holler.game_json(g, me);
end $$;

-- ---------- dispatchers: every game goes through these ----------
create or replace function holler.game_json(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select case g.kind when 'poker' then holler.poker_json(g, p_me) when 'charades' then holler.charades_json(g, p_me)
         when 'ttt' then holler.duel_json(g, p_me) when 'checkers' then holler.duel_json(g, p_me)
         when 'words' then holler.quick_json(g, p_me) when 'trivia' then holler.quick_json(g, p_me)
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
  elsif k in ('words', 'trivia') then perform holler.quick_advance(p_game);
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
  elsif k = 'passiton' then perform holler.pass_take_turn(p_polo, p_me, p_effects);
  else raise exception 'That game does not take a holler.';
  end if;
end $$;

-- ---------- starting a game (all but Pass It On) ----------
create or replace function public.holler_game_start2(p_token text, p_chat uuid, p_kind text, p_order uuid[], p_opts jsonb)
returns jsonb language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; n int; x uuid; q text; ans text; sec int; nm text; rack text; qids jsonb;
begin
  if not holler.is_member(p_chat, me) then raise exception 'not in this chat'; end if;
  if p_kind not in ('poker', 'charades', 'ttt', 'checkers', 'words', 'trivia') then raise exception 'Unknown game'; end if;
  n := coalesce(array_length(p_order, 1), 0);
  if p_kind = 'poker' and (n < 3 or n > 5) then raise exception 'Poker Face needs 3 to 5 people.'; end if;
  if p_kind in ('charades', 'words', 'trivia') and (n < 2 or n > 5) then raise exception '% needs 2 to 5 people.', holler.game_label(p_kind); end if;
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

-- ---------- nudge: Pass It On and the duels nudge whoever is up; round games nudge everyone who still owes a move ----------
create or replace function public.holler_game_nudge(p_token text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; nm text; who uuid[];
begin
  perform holler.game_tick(p_game);
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) then raise exception 'That game is gone.'; end if;
  if g.status <> 'playing' then return holler.game_json(g, me); end if;
  if g.kind in ('passiton', 'ttt', 'checkers') then
    if g.turn_person is null or g.turn_person = me then return holler.game_json(g, me); end if;
    who := array[g.turn_person];
  else
    who := array(select x::uuid from jsonb_array_elements_text(coalesce(g.state->'todo', '[]')) x where x <> me::text);
    if coalesce(cardinality(who), 0) = 0 then return holler.game_json(g, me); end if;
  end if;
  if g.nudged_at > now() - interval '6 hours' then raise exception 'They were nudged in the last 6 hours.'; end if;
  select split_part(name, ' ', 1) into nm from holler.people where id = me;
  update holler.games set nudged_at = now() where id = g.id returning * into g;
  perform holler.push_to(g.chat_id, who, coalesce(nm, 'Someone') || ' is waiting on you in ' || holler.game_label(g.kind));
  return holler.game_json(g, me);
end $$;

revoke all on function holler.duel_json(holler.games, uuid), holler.duel_tick(uuid), holler.quick_json(holler.games, uuid),
  holler.quick_advance(uuid), holler.game_json(holler.games, uuid), holler.game_tick(uuid), holler.game_take_turn(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function
  public.holler_game_start2(text, uuid, text, uuid[], jsonb), public.holler_game_nudge(text, uuid),
  public.holler_game_move(text, uuid, int, jsonb), public.holler_game_resign(text, uuid),
  public.holler_game_begin(text, uuid), public.holler_game_play(text, uuid, jsonb)
to anon, authenticated;

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

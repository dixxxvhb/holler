-- Dry run: games5.sql + games5-tests.sql. Built by scripts/build-check.sh 5; aborts at the end on purpose.
-- Run: ssh pc "pwsh -NoProfile -File C:/Users/bowle/bin/pc-run.ps1 holler-sql games5-check.sql". Expect "GAMES5 CHECK PASSED".
begin;
-- Holler Play, round five (2026-11-26): Last Card, a shedding card game for 2 to 6 people.
-- Additive: widens games.kind, adds Last Card's rules and its own start/move/leave RPCs, then replaces the
-- dispatchers (game_json, game_tick), game_label and nudge (same behaviour for every older game).
-- No rows are rewritten and nothing is dropped except the old kind check. Safe to run twice.
--
-- The deck is 108 cards: four colors (r y g b), each with one 0, two of 1-9, two Skip (s), two Reverse (r) and
-- two Draw Two (d); plus four Wild (xw) and four Wild Draw Four (xf). Codes are color + value, two characters.
-- Everyone gets 7. Match the top card by color or by number/symbol, or play a wild and pick the color.
-- Can't or won't play: draw one. If the drawn card fits you may play it or keep it; if not, your turn passes.
-- Skip skips the next person, Reverse flips the direction (with 2 people it works as a Skip), Draw Two and
-- Wild Draw Four make the next person draw and lose their turn. Going down to one card without calling
-- "Last card" costs you two cards. First one out of cards wins.
-- Turns are async like the duels: whoever is up gets a push. Nobody moves for 2 days: that person draws one and
-- is passed. Nobody moves for 7 days: the game ends. Someone leaves the game or the chat: their cards go to the
-- discard pile and play goes on; down to one player, that player wins.
--
-- state:  { order, dir, top, color, drew, moves, last, log, winner, result }   (everyone sees this)
-- secret: { deck: [...], discard: [...], hands: {who: [...]}, drawn }           (only your own hand is ever sent)

alter table holler.games drop constraint if exists games_kind_check;
alter table holler.games add constraint games_kind_check
  check (kind in ('passiton', 'poker', 'charades', 'ttt', 'checkers', 'words', 'trivia', 'spot', 'laugh', 'lastcard'));

create or replace function holler.game_label(p_kind text) returns text
language sql immutable as $$
  select case p_kind when 'poker' then 'Poker Face' when 'charades' then 'Charades Relay' when 'ttt' then 'Tic-Tac-Toe'
    when 'checkers' then 'Checkers' when 'words' then 'Seven Letters' when 'trivia' then 'Trivia'
    when 'spot' then 'On The Spot' when 'laugh' then 'Don''t Laugh' when 'lastcard' then 'Last Card' else 'Pass It On' end
$$;

-- ---------- cards ----------
create or replace function holler.lc_deck() returns jsonb
language sql volatile as $$
  select jsonb_agg(c order by random()) from (
    select col || v as c
      from unnest(array['r', 'y', 'g', 'b']) col,
           (select '0' as v union all
            select v from unnest(array['1', '2', '3', '4', '5', '6', '7', '8', '9', 's', 'r', 'd']) v, generate_series(1, 2)) q
    union all select 'xw' from generate_series(1, 4)
    union all select 'xf' from generate_series(1, 4)) d
$$;

-- Does this card go on that top card, with the color in play?
create or replace function holler.lc_ok(p_card text, p_top text, p_color text) returns boolean
language sql immutable as $$
  select left(p_card, 1) = 'x' or left(p_card, 1) = p_color or (left(p_top, 1) <> 'x' and substr(p_card, 2, 1) = substr(p_top, 2, 1))
$$;

-- Move n cards from the deck into someone's hand, shuffling the discard pile back in when the deck runs out.
-- Returns { sec, got: [cards drawn] } (fewer than n only if every card is already in someone's hand).
create or replace function holler.lc_take(p_sec jsonb, p_who text, p_n int) returns jsonb
language plpgsql volatile as $$
declare dk jsonb := coalesce(p_sec->'deck', '[]'); hd jsonb := coalesce(p_sec->'hands'->p_who, '[]'); got jsonb := '[]'; c jsonb; i int;
begin
  for i in 1 .. greatest(p_n, 0) loop
    if jsonb_array_length(dk) = 0 then
      select coalesce(jsonb_agg(z order by random()), '[]') into dk from jsonb_array_elements(coalesce(p_sec->'discard', '[]')) z;
      p_sec := jsonb_set(p_sec, '{discard}', '[]');
      exit when jsonb_array_length(dk) = 0;
    end if;
    c := dk->0; dk := dk - 0;
    hd := hd || jsonb_build_array(c); got := got || jsonb_build_array(c);
  end loop;
  p_sec := jsonb_set(jsonb_set(p_sec, '{deck}', dk), array['hands', p_who], hd);
  return jsonb_build_object('sec', p_sec, 'got', got);
end $$;

-- Who is `steps` seats away from p_who, going in direction p_dir (1 or -1).
create or replace function holler.lc_next(p_order jsonb, p_who text, p_dir int, p_steps int) returns text
language sql immutable as $$
  select p_order->>((((holler.order_idx(p_order, p_who::uuid) + p_dir * p_steps) % n) + n) % n)
    from (select jsonb_array_length(p_order) as n) q
$$;

-- Keep the last 12 things that happened.
create or replace function holler.lc_log(p_log jsonb, p_ev jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(e order by k), '[]') from (
    select e, k from jsonb_array_elements(coalesce(p_log, '[]') || jsonb_build_array(p_ev)) with ordinality x(e, k)
     order by k desc limit 12) q
$$;

create or replace function holler.lc_json(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select holler.game_base(g, p_me) || jsonb_build_object(
    'top', g.state->'top', 'color', g.state->'color', 'dir', coalesce(g.state->'dir', '1'::jsonb),
    'last', g.state->'last', 'log', coalesce(g.state->'log', '[]'::jsonb), 'moves', coalesce(g.state->'moves', '0'::jsonb),
    'winner', g.state->'winner', 'result', g.state->'result', 'turnSince', g.turn_since,
    'counts', (select coalesce(jsonb_object_agg(k, jsonb_array_length(v)), '{}'::jsonb) from jsonb_each(coalesce(g.secret->'hands', '{}'::jsonb)) e(k, v)),
    'hand', g.secret->'hands'->(p_me::text),
    'drawn', case when g.status = 'playing' and g.turn_person = p_me and coalesce((g.state->>'drew')::boolean, false) then g.secret->'drawn' end,
    'deckLeft', jsonb_array_length(coalesce(g.secret->'deck', '[]'::jsonb)),
    'hands', case when g.status <> 'playing' then g.secret->'hands' end)
$$;

-- Take someone out of a game (they left it, or left the chat). Their cards go under the discard pile.
-- Leaves the row locked by the caller; returns the new row.
create or replace function holler.lc_drop(p_game uuid, p_who text) returns holler.games
language plpgsql security definer set search_path = holler, public as $$
declare g holler.games; st jsonb; sec jsonb; nxt text; od jsonb; ev jsonb;
begin
  select * into g from holler.games where id = p_game for update;
  if g.id is null or g.status <> 'playing' or not coalesce((g.state->'order') ? p_who, false) then return g; end if;
  st := g.state; sec := g.secret;
  nxt := case when g.turn_person::text = p_who then holler.lc_next(st->'order', p_who, coalesce((st->>'dir')::int, 1), 1) end;
  od := (select coalesce(jsonb_agg(z order by k), '[]') from jsonb_array_elements_text(st->'order') with ordinality a(z, k) where z <> p_who);
  sec := jsonb_set(sec, '{discard}', coalesce(sec->'hands'->p_who, '[]') || coalesce(sec->'discard', '[]'));
  sec := jsonb_set(sec, '{hands}', coalesce(sec->'hands', '{}') - p_who);
  ev := jsonb_build_object('who', p_who, 'kind', 'left', 'at', now());
  st := st || jsonb_build_object('order', od, 'last', ev, 'log', holler.lc_log(st->'log', ev));
  if nxt is not null then st := st || '{"drew": false}'; sec := sec - 'drawn'; end if;
  if jsonb_array_length(od) < 2 then
    st := st || jsonb_build_object('result', 'left', 'winner', od->0);
    update holler.games set state = st, secret = sec, status = 'done', ended_at = now(), turn_person = null, turn_since = null,
      version = version + 1, updated_at = now() where id = g.id returning * into g;
    if od->>0 is not null then perform holler.push_to(g.chat_id, array[(od->>0)::uuid], 'Everyone else left. You won Last Card'); end if;
  else
    update holler.games set state = st, secret = sec,
      turn_person = coalesce(nxt::uuid, turn_person), turn_since = case when nxt is not null then now() else turn_since end,
      version = version + 1, updated_at = now() where id = g.id returning * into g;
    if nxt is not null then perform holler.push_to(g.chat_id, array[nxt::uuid], 'Your turn in Last Card'); end if;
  end if;
  return g;
end $$;

-- Anyone who left the chat is taken out; a week with no move ends it; two days with no move passes the person up.
create or replace function holler.lc_tick(p_game uuid) returns void
language plpgsql security definer set search_path = holler, public as $$
declare g holler.games; x text; st jsonb; sec jsonb; r jsonb; nxt text; ev jsonb;
begin
  select * into g from holler.games where id = p_game for update;
  if g.id is null or g.status <> 'playing' then return; end if;
  for x in select z from jsonb_array_elements_text(g.state->'order') z where not holler.is_member(g.chat_id, z::uuid) loop
    g := holler.lc_drop(p_game, x);
  end loop;
  if g.status <> 'playing' then return; end if;
  if g.turn_since < now() - interval '7 days' then
    update holler.games set state = g.state || '{"result": "idle"}', status = 'ended', ended_at = now(), turn_person = null,
      turn_since = null, version = version + 1, updated_at = now() where id = g.id;
  elsif g.turn_since < now() - interval '48 hours' then
    st := g.state; sec := g.secret - 'drawn';
    if not coalesce((st->>'drew')::boolean, false) then
      r := holler.lc_take(sec, g.turn_person::text, 1); sec := r->'sec';
    end if;
    nxt := holler.lc_next(st->'order', g.turn_person::text, coalesce((st->>'dir')::int, 1), 1);
    ev := jsonb_build_object('who', g.turn_person, 'kind', 'idle', 'at', now());
    st := st || jsonb_build_object('drew', false, 'last', ev, 'log', holler.lc_log(st->'log', ev));
    update holler.games set state = st, secret = sec, turn_person = nxt::uuid, turn_since = now(),
      version = version + 1, updated_at = now() where id = g.id;
    perform holler.push_to(g.chat_id, array[nxt::uuid], 'Your turn in Last Card');
  end if;
end $$;

-- ---------- start ----------
create or replace function public.holler_card_start(p_token text, p_chat uuid, p_order uuid[]) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; n int; x uuid; dk jsonb; hands jsonb := '{}'; pos int; top text; nm text;
begin
  if not holler.is_member(p_chat, me) then raise exception 'not in this chat'; end if;
  n := coalesce(array_length(p_order, 1), 0);
  if n < 2 or n > 6 then raise exception 'Last Card needs 2 to 6 people.'; end if;
  if not (me = any(p_order)) then raise exception 'You have to be in a game you start.'; end if;
  if (select count(distinct y) from unnest(p_order) y) <> n then raise exception 'Someone is in the game twice.'; end if;
  foreach x in array p_order loop
    if not holler.is_member(p_chat, x) then raise exception 'Everyone in the game has to be in this chat.'; end if;
  end loop;
  if (select count(*) from holler.games where chat_id = p_chat and status = 'playing') >= 6 then
    raise exception 'This chat already has 6 games going. Finish one first.';
  end if;
  dk := holler.lc_deck();
  foreach x in array p_order loop
    hands := hands || jsonb_build_object(x::text, (select jsonb_agg(c order by k) from jsonb_array_elements(dk) with ordinality a(c, k) where k <= 7));
    dk := (select jsonb_agg(c order by k) from jsonb_array_elements(dk) with ordinality a(c, k) where k > 7);
  end loop;
  -- the first face-up card is always a plain number
  select (k - 1)::int into pos from jsonb_array_elements_text(dk) with ordinality a(c, k) where c ~ '^[rygb][0-9]$' order by k limit 1;
  top := dk->>pos; dk := dk - pos;
  insert into holler.games (chat_id, kind, state, secret, turn_person, turn_since, created_by)
  values (p_chat, 'lastcard',
    jsonb_build_object('order', to_jsonb(p_order), 'dir', 1, 'top', top, 'color', left(top, 1), 'drew', false, 'moves', 0,
                       'last', null, 'log', '[]'::jsonb, 'winner', null, 'result', null),
    jsonb_build_object('deck', dk, 'discard', '[]'::jsonb, 'hands', hands),
    p_order[1], now(), me)
  returning * into g;
  select split_part(name, ' ', 1) into nm from holler.people where id = me;
  perform holler.push_to(p_chat, array(select y from unnest(p_order) y where y <> me), coalesce(nm, 'Someone') || ' dealt you into Last Card.');
  return holler.game_json(g, me);
end $$;

-- ---------- a move: { play: card, color?: r|y|g|b, last?: true } | { draw: true } | { pass: true } ----------
create or replace function public.holler_card_move(p_token text, p_game uuid, p_version int, p_move jsonb) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; st jsonb; sec jsonb; hd jsonb; card text; col text; top text; v text;
  dir int; n int; nxt text; steps int := 1; hit int; victim text; r jsonb; pos int; ev jsonb; nm text; drew boolean; mv int;
begin
  perform holler.lc_tick(p_game);
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) then raise exception 'That game is gone.'; end if;
  if g.kind <> 'lastcard' then raise exception 'Unknown game'; end if;
  if g.status <> 'playing' then raise exception 'This game is over.'; end if;
  if g.turn_person is distinct from me then raise exception 'It is not your turn.'; end if;
  if p_version is distinct from g.version then raise exception 'The cards changed. Have another look.'; end if;
  st := g.state; sec := g.secret; dir := coalesce((st->>'dir')::int, 1); n := jsonb_array_length(st->'order');
  hd := coalesce(sec->'hands'->(me::text), '[]'); top := st->>'top'; col := st->>'color';
  drew := coalesce((st->>'drew')::boolean, false); mv := coalesce((st->>'moves')::int, 0) + 1;
  select split_part(name, ' ', 1) into nm from holler.people where id = me; nm := coalesce(nm, 'Someone');

  if p_move ? 'play' then
    card := p_move->>'play';
    if card is null or card !~ '^([rygb][0-9srd]|x[wf])$' then raise exception 'That is not a card.'; end if;
    select (k - 1)::int into pos from jsonb_array_elements_text(hd) with ordinality a(c, k) where c = card order by k limit 1;
    if pos is null then raise exception 'That card is not in your hand.'; end if;
    if drew and card is distinct from sec->>'drawn' then raise exception 'After a draw you can only play the card you drew.'; end if;
    if not holler.lc_ok(card, top, col) then raise exception 'That card does not match.'; end if;
    if left(card, 1) = 'x' then
      col := p_move->>'color';
      if col is null or col not in ('r', 'y', 'g', 'b') then raise exception 'Pick a color.'; end if;
    else
      col := left(card, 1);
    end if;
    v := substr(card, 2, 1);
    hd := hd - pos;
    sec := jsonb_set(sec, array['hands', me::text], hd) - 'drawn';
    sec := jsonb_set(sec, '{discard}', coalesce(sec->'discard', '[]') || jsonb_build_array(top));
    st := st || jsonb_build_object('top', card, 'color', col, 'drew', false);
    ev := jsonb_build_object('who', me, 'kind', 'play', 'card', card, 'color', col, 'at', now());

    if jsonb_array_length(hd) = 0 then
      st := st || jsonb_build_object('result', 'win', 'winner', me, 'moves', mv, 'last', ev, 'log', holler.lc_log(st->'log', ev));
      update holler.games set state = st, secret = sec, status = 'done', ended_at = now(), turn_person = null, turn_since = null,
        version = version + 1, updated_at = now() where id = g.id returning * into g;
      perform holler.push_to(g.chat_id, array(select z::uuid from jsonb_array_elements_text(st->'order') z where z <> me::text), nm || ' won Last Card');
      return holler.game_json(g, me);
    end if;

    if v = 'r' then
      dir := -dir; st := st || jsonb_build_object('dir', dir);
      if n = 2 then steps := 2; end if;
    elsif v = 's' then
      steps := 2; ev := ev || jsonb_build_object('skip', holler.lc_next(st->'order', me::text, dir, 1));
    end if;
    hit := case v when 'd' then 2 when 'f' then 4 else 0 end;
    if hit > 0 then
      victim := holler.lc_next(st->'order', me::text, dir, 1);
      r := holler.lc_take(sec, victim, hit); sec := r->'sec'; steps := 2;
      ev := ev || jsonb_build_object('hit', victim, 'n', jsonb_array_length(r->'got'));
    end if;
    if jsonb_array_length(hd) = 1 then
      if coalesce((p_move->>'last')::boolean, false) then
        ev := ev || '{"called": true}';
      else
        r := holler.lc_take(sec, me::text, 2); sec := r->'sec';
        ev := ev || jsonb_build_object('forgot', jsonb_array_length(r->'got'));
      end if;
    end if;
    nxt := holler.lc_next(st->'order', me::text, dir, steps);

  elsif p_move ? 'draw' then
    if drew then raise exception 'You already drew. Play it or keep it.'; end if;
    r := holler.lc_take(sec, me::text, 1); sec := r->'sec'; card := r->'got'->>0;
    ev := jsonb_build_object('who', me, 'kind', 'draw', 'at', now());
    if card is not null and holler.lc_ok(card, top, col) then
      -- it fits: your turn stays open to play it or keep it
      sec := sec || jsonb_build_object('drawn', card);
      st := st || jsonb_build_object('drew', true, 'moves', mv, 'last', ev, 'log', holler.lc_log(st->'log', ev));
      update holler.games set state = st, secret = sec, version = version + 1, updated_at = now() where id = g.id returning * into g;
      return holler.game_json(g, me);
    end if;
    nxt := holler.lc_next(st->'order', me::text, dir, 1);

  elsif p_move ? 'pass' then
    if not drew then raise exception 'Draw a card first.'; end if;
    sec := sec - 'drawn';
    ev := jsonb_build_object('who', me, 'kind', 'keep', 'at', now());
    nxt := holler.lc_next(st->'order', me::text, dir, 1);

  else
    raise exception 'That is not a move.';
  end if;

  st := st || jsonb_build_object('drew', false, 'moves', mv, 'last', ev, 'log', holler.lc_log(st->'log', ev));
  update holler.games set state = st, secret = sec, turn_person = nxt::uuid, turn_since = now(),
    version = version + 1, updated_at = now() where id = g.id returning * into g;
  if nxt <> me::text then perform holler.push_to(g.chat_id, array[nxt::uuid], nm || ' went. Your turn in Last Card'); end if;
  return holler.game_json(g, me);
end $$;

create or replace function public.holler_card_leave(p_token text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games;
begin
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) then raise exception 'That game is gone.'; end if;
  if g.kind <> 'lastcard' then raise exception 'Unknown game'; end if;
  if not coalesce((g.state->'order') ? me::text, false) then raise exception 'You are not in that game.'; end if;
  g := holler.lc_drop(p_game, me::text);
  return holler.game_json(g, me);
end $$;

-- ---------- dispatchers and nudge, now knowing Last Card ----------
create or replace function holler.game_json(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select case g.kind when 'poker' then holler.poker_json(g, p_me) when 'charades' then holler.charades_json(g, p_me)
         when 'ttt' then holler.duel_json(g, p_me) when 'checkers' then holler.duel_json(g, p_me)
         when 'words' then holler.quick_json(g, p_me) when 'trivia' then holler.quick_json(g, p_me)
         when 'spot' then holler.spot_json(g, p_me) when 'laugh' then holler.laugh_json(g, p_me)
         when 'lastcard' then holler.lc_json(g, p_me)
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
  elsif k is not null then perform holler.pass_tick(p_game);
  end if;
end $$;

create or replace function public.holler_game_nudge(p_token text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; nm text; who uuid[];
begin
  perform holler.game_tick(p_game);
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) then raise exception 'That game is gone.'; end if;
  if g.status <> 'playing' then return holler.game_json(g, me); end if;
  if g.kind in ('passiton', 'ttt', 'checkers', 'lastcard') then
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

revoke all on function holler.lc_deck(), holler.lc_ok(text, text, text), holler.lc_take(jsonb, text, int),
  holler.lc_next(jsonb, text, int, int), holler.lc_log(jsonb, jsonb), holler.lc_json(holler.games, uuid),
  holler.lc_drop(uuid, text), holler.lc_tick(uuid), holler.game_json(holler.games, uuid), holler.game_tick(uuid)
from public, anon, authenticated;
grant execute on function public.holler_card_start(text, uuid, uuid[]), public.holler_card_move(text, uuid, int, jsonb),
  public.holler_card_leave(text, uuid), public.holler_game_nudge(text, uuid)
to anon, authenticated;

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

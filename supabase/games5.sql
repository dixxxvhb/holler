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

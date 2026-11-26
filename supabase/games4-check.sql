-- Dry run: games4.sql + games4-tests.sql. Built by scripts/build-check.sh 4; aborts at the end on purpose.
-- Run: ssh pc "pwsh -NoProfile -File C:/Users/bowle/bin/pc-run.ps1 holler-sql games4-check.sql". Expect "GAMES4 CHECK PASSED".
begin;
-- Holler Play, round four (2026-11-26): On The Spot and Don't Laugh.
-- Additive: widens games.kind and adds the two games' rules, then replaces start, begin and the dispatchers
-- (same behaviour for every older game). No rows are rewritten and nothing is dropped except the old kind check.
-- On The Spot: everyone gets three questions of their own. They show only once you start recording, and you
--   answer on camera against a 10 second clock. Your clip and your picks go in together.
-- Don't Laugh: everyone records a clip trying to crack the others up. Then everyone watches everyone else's
--   with the front camera on; the phone spots a smile. Crack and your reaction clip is the proof.
-- Safe to run twice.

alter table holler.games drop constraint if exists games_kind_check;
alter table holler.games add constraint games_kind_check
  check (kind in ('passiton', 'poker', 'charades', 'ttt', 'checkers', 'words', 'trivia', 'spot', 'laugh'));

create or replace function holler.game_label(p_kind text) returns text
language sql immutable as $$
  select case p_kind when 'poker' then 'Poker Face' when 'charades' then 'Charades Relay' when 'ttt' then 'Tic-Tac-Toe'
    when 'checkers' then 'Checkers' when 'words' then 'Seven Letters' when 'trivia' then 'Trivia'
    when 'spot' then 'On The Spot' when 'laugh' then 'Don''t Laugh' else 'Pass It On' end
$$;

-- ---------- On The Spot ----------
-- state: { order, todo, since, deck, turnSec, began: {who: at}, plays: {who: {polo, picks, at}} }
-- secret: { qids: {who: [3 ids]} }. Yours show once you begin; someone else's show once their clip is in.
create or replace function holler.spot_json(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select holler.game_base(g, p_me) || jsonb_build_object(
    'since', g.state->'since',
    'began', coalesce((g.state->'began') ? p_me::text, false),
    'played', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(coalesce(g.state->'plays', '{}'::jsonb)) k),
    'qids', case when coalesce((g.state->'began') ? p_me::text, false) or g.status <> 'playing' then g.secret->'qids'->(p_me::text) end,
    'takes', (select coalesce(jsonb_agg(jsonb_build_object(
        'who', p.key, 'at', p.value->'at', 'qids', g.secret->'qids'->p.key, 'picks', p.value->'picks',
        'clip', case when not holler.game_hidden(g) then
                  (select holler.polo_json(po) from holler.polos po where po.id = (p.value->>'polo')::uuid and po.status = 'ready') end
      ) order by p.value->>'at'), '[]') from jsonb_each(coalesce(g.state->'plays', '{}'::jsonb)) p)
  )
$$;

create or replace function holler.spot_take_turn(p_polo uuid, p_me uuid, p_game uuid, p_picks jsonb) returns void
language plpgsql security definer set search_path = holler, public as $$
declare g holler.games; st jsonb; n int; picks jsonb; nm text;
begin
  perform holler.quick_advance(p_game);
  select * into g from holler.games where id = p_game for update;
  if not coalesce((g.state->'order') ? p_me::text, false) then raise exception 'You are not in that game.'; end if;
  if g.status <> 'playing' then raise exception 'That game is over, so this one was not sent.'; end if;
  if not coalesce((g.state->'began') ? p_me::text, false) then raise exception 'Start your go first.'; end if;
  if coalesce((g.state->'plays') ? p_me::text, false) then raise exception 'You already went in this one.'; end if;
  n := jsonb_array_length(coalesce(g.secret->'qids'->(p_me::text), '[]'));
  if jsonb_typeof(p_picks) <> 'array' or jsonb_array_length(p_picks) <> n then raise exception 'That clip lost its answers. Please go again.'; end if;
  select jsonb_agg(jsonb_build_object(
           'pick', case when (a->>'pick') ~ '^-?[0-9]$' and (a->>'pick')::int between -1 and 3 then (a->>'pick')::int else -1 end,
           'ms', case when (a->>'ms') ~ '^[0-9]{1,6}$' then least((a->>'ms')::int, 60000) else 60000 end) order by k)
    into picks from jsonb_array_elements(p_picks) with ordinality x(a, k);
  update holler.polos set game_id = g.id, game_turn = holler.order_idx(g.state->'order', p_me) where id = p_polo;
  st := jsonb_set(g.state, '{plays}', coalesce(g.state->'plays', '{}'::jsonb)
          || jsonb_build_object(p_me::text, jsonb_build_object('polo', p_polo, 'picks', picks, 'at', now())));
  st := jsonb_set(st, '{todo}', (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements_text(coalesce(st->'todo', '[]')) x where x <> p_me::text));
  update holler.games set state = st, version = version + 1, updated_at = now() where id = g.id;
  select split_part(name, ' ', 1) into nm from holler.people where id = p_me;
  perform holler.push_to(g.chat_id, array(select x::uuid from jsonb_array_elements_text(g.state->'order') x where x <> p_me::text),
    coalesce(nm, 'Someone') || ' went On The Spot. Watch them sweat.');
  perform holler.quick_advance(p_game);
end $$;

-- ---------- Don't Laugh ----------
-- state: { order, turnSec, acts: {who: {polo, at}}, watches: {actor: {watcher: {cracked: sec|null, done, polo, at}}}, todo }
create or replace function holler.laugh_todo(g holler.games) returns jsonb
language sql stable security definer set search_path = holler as $$
  select coalesce(jsonb_agg(p), '[]') from jsonb_array_elements_text(g.state->'order') p
   where holler.is_member(g.chat_id, p::uuid)
     and (not coalesce((g.state->'acts') ? p, false)
          or exists (select 1 from jsonb_object_keys(coalesce(g.state->'acts', '{}'::jsonb)) a
                      where a <> p and not coalesce((g.state->'watches'->a->p->>'done')::boolean, false)))
$$;

create or replace function holler.laugh_json(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select holler.game_base(g, p_me) || jsonb_build_object(
    'acted', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(coalesce(g.state->'acts', '{}'::jsonb)) k),
    'acts', (select coalesce(jsonb_agg(jsonb_build_object(
        'who', a.key, 'at', a.value->'at',
        'clip', case when not holler.game_hidden(g) then
                  (select holler.polo_json(po) from holler.polos po where po.id = (a.value->>'polo')::uuid and po.status = 'ready') end,
        'mine', g.state->'watches'->a.key->(p_me::text),
        -- everyone else's faces stay hidden until you've watched it yourself (no spoilers)
        'results', case when g.status <> 'playing' or a.key = p_me::text
                          or coalesce((g.state->'watches'->a.key->(p_me::text)->>'done')::boolean, false) then
                     (select coalesce(jsonb_object_agg(r.key, r.value || jsonb_build_object('clip',
                        case when not holler.game_hidden(g) and r.value ? 'polo' then
                          (select holler.polo_json(po) from holler.polos po where po.id = (r.value->>'polo')::uuid and po.status = 'ready') end)), '{}'::jsonb)
                        from jsonb_each(coalesce(g.state->'watches'->a.key, '{}'::jsonb)) r)
                   end
      ) order by a.value->>'at'), '[]') from jsonb_each(coalesce(g.state->'acts', '{}'::jsonb)) a)
  )
$$;

create or replace function holler.laugh_advance(p_game uuid) returns void
language plpgsql security definer set search_path = holler, public as $$
declare g holler.games; todo jsonb;
begin
  select * into g from holler.games where id = p_game for update;
  if g.id is null or g.status <> 'playing' then return; end if;
  todo := holler.laugh_todo(g);
  if jsonb_array_length(todo) > 0 and g.updated_at > now() - interval '48 hours' then
    if todo is distinct from g.state->'todo' then
      update holler.games set state = jsonb_set(state, '{todo}', todo), version = version + 1 where id = g.id;
    end if;
    return;
  end if;
  if coalesce(g.state->'acts', '{}'::jsonb) = '{}'::jsonb then
    update holler.games set state = jsonb_set(state, '{todo}', '[]'), status = 'ended', ended_at = now(),
      version = version + 1, updated_at = now() where id = g.id;
    return;
  end if;
  update holler.games set state = jsonb_set(state, '{todo}', '[]'), status = 'done', ended_at = now(),
    version = version + 1, updated_at = now() where id = g.id;
  perform holler.push_to(g.chat_id, array(select jsonb_array_elements_text(g.state->'order')::uuid), 'Don''t Laugh: see who cracked');
end $$;

-- A clip for Don't Laugh: your joke (no "of"), or your face watching someone's joke ({ of: actor }).
create or replace function holler.laugh_take_turn(p_polo uuid, p_me uuid, p_game uuid, p_fx jsonb) returns void
language plpgsql security definer set search_path = holler, public as $$
declare g holler.games; st jsonb; actor text := p_fx->>'of'; nm text; e jsonb;
begin
  perform holler.laugh_advance(p_game);
  select * into g from holler.games where id = p_game for update;
  if not coalesce((g.state->'order') ? p_me::text, false) then raise exception 'You are not in that game.'; end if;
  if g.status <> 'playing' then raise exception 'That game is over, so this one was not sent.'; end if;
  if actor is null then
    if coalesce((g.state->'acts') ? p_me::text, false) then raise exception 'You already recorded yours.'; end if;
    update holler.polos set game_id = g.id, game_turn = holler.order_idx(g.state->'order', p_me) where id = p_polo;
    st := jsonb_set(g.state, '{acts}', coalesce(g.state->'acts', '{}'::jsonb) || jsonb_build_object(p_me::text, jsonb_build_object('polo', p_polo, 'at', now())));
    st := jsonb_set(st, '{watches}', coalesce(st->'watches', '{}'::jsonb) || jsonb_build_object(p_me::text, coalesce(st->'watches'->(p_me::text), '{}'::jsonb)));
    update holler.games set state = st, version = version + 1, updated_at = now() where id = g.id;
    select split_part(name, ' ', 1) into nm from holler.people where id = p_me;
    perform holler.push_to(g.chat_id, array(select x::uuid from jsonb_array_elements_text(g.state->'order') x where x <> p_me::text),
      coalesce(nm, 'Someone') || ' sent a Don''t Laugh clip. Keep a straight face.');
  else
    if actor = p_me::text or not coalesce((g.state->'acts') ? actor, false) then raise exception 'That clip is gone.'; end if;
    e := coalesce(g.state->'watches'->actor->(p_me::text), '{}'::jsonb);
    if e ? 'polo' then raise exception 'You already sent your face for this one.'; end if;
    update holler.polos set game_id = g.id, game_turn = 100 + holler.order_idx(g.state->'order', p_me) where id = p_polo;
    update holler.games set state = jsonb_set(state, array['watches', actor, p_me::text], e || jsonb_build_object('polo', p_polo)),
      version = version + 1, updated_at = now() where id = g.id;
  end if;
  perform holler.laugh_advance(p_game);
end $$;

-- How you did watching someone's clip: cracked at a second (or null for a straight face the whole way).
create or replace function public.holler_game_laughed(p_token text, p_game uuid, p_actor uuid, p_cracked real) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; e jsonb; nm text; an text;
begin
  perform holler.game_tick(p_game);
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) or g.kind <> 'laugh' then raise exception 'That game is gone.'; end if;
  if g.status <> 'playing' then raise exception 'This game is over.'; end if;
  if not coalesce((g.state->'order') ? me::text, false) then raise exception 'You are not in that game.'; end if;
  if p_actor = me then raise exception 'That one is yours.'; end if;
  if not coalesce((g.state->'acts') ? p_actor::text, false) then raise exception 'They have not sent theirs yet.'; end if;
  e := coalesce(g.state->'watches'->p_actor::text->me::text, '{}'::jsonb);
  if coalesce((e->>'done')::boolean, false) then raise exception 'You already watched this one.'; end if;
  e := e || jsonb_build_object('done', true, 'cracked', case when p_cracked is null then null else to_jsonb(round(greatest(0, least(p_cracked, 60))::numeric, 1)) end, 'at', now());
  update holler.games set state = jsonb_set(state, array['watches', p_actor::text, me::text], e),
    version = version + 1, updated_at = now() where id = g.id;
  if p_cracked is not null then
    select split_part(name, ' ', 1) into nm from holler.people where id = me;
    perform holler.push_to(g.chat_id, array[p_actor], coalesce(nm, 'Someone') || ' cracked at your Don''t Laugh clip');
  end if;
  perform holler.laugh_advance(p_game);
  select * into g from holler.games where id = p_game;
  return holler.game_json(g, me);
end $$;

-- ---------- start, begin and the dispatchers, now knowing both new games ----------
create or replace function holler.game_json(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select case g.kind when 'poker' then holler.poker_json(g, p_me) when 'charades' then holler.charades_json(g, p_me)
         when 'ttt' then holler.duel_json(g, p_me) when 'checkers' then holler.duel_json(g, p_me)
         when 'words' then holler.quick_json(g, p_me) when 'trivia' then holler.quick_json(g, p_me)
         when 'spot' then holler.spot_json(g, p_me) when 'laugh' then holler.laugh_json(g, p_me)
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
  elsif k = 'passiton' then perform holler.pass_take_turn(p_polo, p_me, p_effects);
  else raise exception 'That game does not take a holler.';
  end if;
end $$;

create or replace function public.holler_game_begin(p_token text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games;
begin
  perform holler.game_tick(p_game);
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) then raise exception 'That game is gone.'; end if;
  if g.kind not in ('words', 'trivia', 'spot') then raise exception 'Unknown game'; end if;
  if not coalesce((g.state->'order') ? me::text, false) then raise exception 'You are not in that game.'; end if;
  if g.status <> 'playing' then raise exception 'This game is over.'; end if;
  if not coalesce((g.state->'began') ? me::text, false) then
    update holler.games set state = jsonb_set(state, '{began}', coalesce(state->'began', '{}'::jsonb) || jsonb_build_object(me::text, now())),
      version = version + 1, updated_at = now() where id = g.id returning * into g;
  end if;
  return holler.game_json(g, me);
end $$;

create or replace function public.holler_game_start2(p_token text, p_chat uuid, p_kind text, p_order uuid[], p_opts jsonb)
returns jsonb language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; n int; x uuid; q text; ans text; sec int; nm text; rack text; qids jsonb;
begin
  if not holler.is_member(p_chat, me) then raise exception 'not in this chat'; end if;
  if p_kind not in ('poker', 'charades', 'ttt', 'checkers', 'words', 'trivia', 'spot', 'laugh') then raise exception 'Unknown game'; end if;
  n := coalesce(array_length(p_order, 1), 0);
  if p_kind = 'poker' and (n < 3 or n > 5) then raise exception 'Poker Face needs 3 to 5 people.'; end if;
  if p_kind in ('charades', 'words', 'trivia', 'spot', 'laugh') and (n < 2 or n > 5) then raise exception '% needs 2 to 5 people.', holler.game_label(p_kind); end if;
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

revoke all on function holler.spot_json(holler.games, uuid), holler.spot_take_turn(uuid, uuid, uuid, jsonb),
  holler.laugh_todo(holler.games), holler.laugh_json(holler.games, uuid), holler.laugh_advance(uuid), holler.laugh_take_turn(uuid, uuid, uuid, jsonb),
  holler.game_json(holler.games, uuid), holler.game_tick(uuid), holler.game_take_turn(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.holler_game_laughed(text, uuid, uuid, real), public.holler_game_begin(text, uuid),
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
  return public.holler_finish_polo(p_tok, (p->>'id')::uuid, 9, 540, 960, null, p_fx, false);
end $$;

do $$
declare a jsonb; b jsonb; c jsonb; ta text; tb text; tc text; ida uuid; idb uuid; idc uuid; chat uuid; code text;
  g jsonb; gid uuid; e text; picks jsonb := '[{"pick": 1, "ms": 900}, {"pick": 0, "ms": 4000}, {"pick": -1, "ms": 10000}]';
begin
  a := public.holler_signup('QA Check A', '#ff7aa2'); ta := a->>'token'; ida := (a->'me'->>'id')::uuid;
  b := public.holler_signup('QA Check B', '#59c9ff'); tb := b->>'token'; idb := (b->'me'->>'id')::uuid;
  c := public.holler_signup('QA Check C', '#8fe3bd'); tc := c->>'token'; idc := (c->'me'->>'id')::uuid;
  chat := (public.holler_create_chat(ta, 'qa check')->>'id')::uuid;
  select invite_code into code from holler.chats where id = chat;
  perform public.holler_join(tb, code); perform public.holler_join(tc, code);

  -- ===== On The Spot =====
  e := pg_temp.err(format('select public.holler_game_start2(%L, %L, ''spot'', array[%L, %L]::uuid[], %L)', ta, chat, ida, idb,
         jsonb_build_object('qids', jsonb_build_object(ida, '["movies-01","tv-02","dance-03"]'::jsonb))));
  assert e = 'Pick the questions.', 'everyone needs questions: ' || e;
  g := public.holler_game_start2(ta, chat, 'spot', array[ida, idb], jsonb_build_object('deck', 'mixed', 'qids',
         jsonb_build_object(ida, '["movies-01","tv-02","dance-03"]'::jsonb, idb, '["pop-04","food-05","science-06"]'::jsonb)));
  gid := (g->>'id')::uuid;
  assert g->'qids' = 'null'::jsonb and jsonb_array_length(g->'todo') = 2, 'questions hidden until you start';
  e := pg_temp.err(format('select pg_temp.clip(%L, %L, %L)', ta, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'picks', picks))));
  assert e = 'Start your go first.', 'no clip before starting: ' || e;
  g := public.holler_game_begin(ta, gid);
  assert g->'qids' = '["movies-01","tv-02","dance-03"]'::jsonb, 'begin shows my three';
  assert public.holler_game(tb, gid)->'qids' = 'null'::jsonb, 'B still sees none';
  e := pg_temp.err(format('select pg_temp.clip(%L, %L, %L)', ta, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'picks', '[{"pick": 1}]'::jsonb))));
  assert e like 'That clip lost its answers%', 'all three answers: ' || e;
  perform pg_temp.clip(ta, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'picks', picks)));
  g := public.holler_game(tb, gid);
  assert jsonb_array_length(g->'takes') = 1 and g->'takes'->0->>'who' = ida::text and g->'takes'->0->'clip'->>'id' is not null
     and g->'takes'->0->'qids' = '["movies-01","tv-02","dance-03"]'::jsonb and (g->'takes'->0->'picks'->2->>'pick')::int = -1, 'B can watch A sweat';
  assert not exists (select 1 from jsonb_array_elements(public.holler_chat(tb, chat)->'polos') x where (x->>'game') is not null), 'spot clips stay out of the strip';
  e := pg_temp.err(format('select pg_temp.clip(%L, %L, %L)', ta, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'picks', picks))));
  assert e = 'You already went in this one.', 'one go each: ' || e;
  perform public.holler_game_begin(tb, gid);
  perform pg_temp.clip(tb, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'picks', picks)));
  g := public.holler_game(ta, gid);
  assert g->>'status' = 'done' and jsonb_array_length(g->'takes') = 2, 'both went: done';

  -- ===== Don't Laugh =====
  g := public.holler_game_start2(tb, chat, 'laugh', array[ida, idb, idc], '{"turnSec": 15}'); gid := (g->>'id')::uuid;
  assert jsonb_array_length(g->'todo') = 3 and (g->>'turnSec')::int = 15, 'laugh starts with everyone to do';
  perform pg_temp.clip(ta, chat, jsonb_build_object('game', jsonb_build_object('id', gid)));
  g := public.holler_game(tb, gid);
  assert g->'acted' = jsonb_build_array(ida) and g->'acts'->0->'clip'->>'id' is not null, 'A''s joke is in';
  e := pg_temp.err(format('select public.holler_game_laughed(%L, %L, %L, null)', ta, gid, ida));
  assert e = 'That one is yours.', 'cannot watch your own: ' || e;
  e := pg_temp.err(format('select public.holler_game_laughed(%L, %L, %L, null)', ta, gid, idc));
  assert e like 'They have not sent%', 'nothing to watch yet: ' || e;
  g := public.holler_game_laughed(tb, gid, ida, 3.24);
  assert (g->'acts'->0->'mine'->>'cracked')::numeric = 3.2 and (g->'acts'->0->'mine'->>'done')::boolean, 'B cracked at 3.2';
  assert public.holler_game(tc, gid)->'acts'->0->'results' = 'null'::jsonb, 'C sees nobody''s face before watching';
  assert public.holler_game(ta, gid)->'acts'->0->'results'->(idb::text)->>'cracked' = '3.2', 'A sees who cracked at theirs';
  perform pg_temp.clip(tb, chat, jsonb_build_object('reactTo', (public.holler_game(tb, gid)->'acts'->0->'clip'->>'id'), 'game', jsonb_build_object('id', gid, 'of', ida)));
  assert public.holler_game(ta, gid)->'acts'->0->'results'->(idb::text)->'clip'->>'id' is not null, 'B''s face clip is attached';
  e := pg_temp.err(format('select public.holler_game_laughed(%L, %L, %L, null)', tb, gid, ida));
  assert e = 'You already watched this one.', 'one watch each: ' || e;
  -- face clip can land before the result
  perform pg_temp.clip(tc, chat, jsonb_build_object('game', jsonb_build_object('id', gid, 'of', ida)));
  assert public.holler_game(tc, gid)->'acts'->0->'results' = 'null'::jsonb, 'a face clip alone is not a watch';
  perform public.holler_game_laughed(tc, gid, ida, null);
  perform pg_temp.clip(tb, chat, jsonb_build_object('game', jsonb_build_object('id', gid)));
  perform pg_temp.clip(tc, chat, jsonb_build_object('game', jsonb_build_object('id', gid)));
  assert (public.holler_chat(ta, chat)->>'yourTurn')::int >= 1, 'A owes two watches';
  perform public.holler_game_laughed(ta, gid, idb, null); perform public.holler_game_laughed(ta, gid, idc, 1.5);
  perform public.holler_game_laughed(tb, gid, idc, null);
  g := public.holler_game_laughed(tc, gid, idb, 7);
  assert g->>'status' = 'done' and jsonb_array_length(g->'acts') = 3, 'everyone watched everyone: done';
  -- nobody records for 48 hours: ended
  g := public.holler_game_start2(ta, chat, 'laugh', array[ida, idb], '{"turnSec": 10}');
  update holler.games set updated_at = now() - interval '49 hours' where id = (g->>'id')::uuid;
  assert public.holler_game(ta, (g->>'id')::uuid)->>'status' = 'ended', 'idle laugh ends';

  -- the older games still start through the new start
  g := public.holler_game_start2(ta, chat, 'trivia', array[ida, idb], '{"qids": ["movies-01","movies-02","tv-03","dance-04","pop-05"]}');
  assert g->>'kind' = 'trivia', 'trivia still starts';
  g := public.holler_game_start2(ta, chat, 'checkers', array[ida, idb], '{}');
  assert length(g->>'board') = 64, 'checkers still starts';

  raise exception 'GAMES4 CHECK PASSED (nothing kept)';
end $$;

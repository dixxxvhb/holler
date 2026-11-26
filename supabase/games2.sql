-- Holler Play, round two (2026-11-26): Poker Face and Charades Relay.
-- Additive: widens games.kind, renames Pass It On's helpers to pass_* behind dispatchers, and adds the two
-- new games' rules. No rows are rewritten and nothing is dropped except the old kind check (replaced wider).
-- Both new games are "everyone at once": nobody waits on a turn order. state.todo lists who still owes a move.
-- Safe to run twice.

alter table holler.games drop constraint if exists games_kind_check;
alter table holler.games add constraint games_kind_check check (kind in ('passiton', 'poker', 'charades'));

create or replace function holler.game_label(p_kind text) returns text
language sql immutable as $$
  select case p_kind when 'poker' then 'Poker Face' when 'charades' then 'Charades Relay' else 'Pass It On' end
$$;

-- ---------- Pass It On, unchanged, under its own names ----------
create or replace function holler.pass_json(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select jsonb_build_object(
    'id', g.id, 'chat', g.chat_id, 'kind', g.kind, 'status', g.status, 'version', g.version,
    'order', g.state->'order', 'turnSec', g.state->'turnSec', 'idx', g.state->'idx',
    'turns', (select coalesce(jsonb_agg(jsonb_build_object('who', t->'who', 'turn', t->'turn', 'at', t->'at', 'skipped', coalesce(t->'skipped', 'false'::jsonb))), '[]')
                from jsonb_array_elements(coalesce(g.state->'turns', '[]')) t),
    'turnPerson', g.turn_person, 'turnSince', g.turn_since, 'nudgedAt', g.nudged_at,
    'createdBy', g.created_by, 'createdAt', g.created_at, 'endedAt', g.ended_at,
    'savedAt', g.saved_at, 'savedBy', g.saved_by,
    'looked', coalesce(g.state->'looked' ? p_me::text, false),
    'phrase', case when g.status <> 'playing' or g.state->'order'->>0 = p_me::text then g.secret->>'phrase' end,
    'guess', case when g.status <> 'playing' then g.state->>'guess' end,
    'hidden', g.status <> 'playing' and g.saved_at is null and g.ended_at <= now() - interval '7 days',
    'hidesAt', case when g.status <> 'playing' and g.saved_at is null then g.ended_at + interval '7 days' end,
    'clips', case when g.status <> 'playing' and (g.saved_at is not null or g.ended_at > now() - interval '7 days') then
               (select coalesce(jsonb_agg(holler.polo_json(po) order by po.game_turn nulls last, po.created_at), '[]')
                  from holler.polos po where po.game_id = g.id and po.status = 'ready') end
  )
$$;

-- Lazy skip: a turn that waited 48 hours (or whose person left the chat) is passed by.
-- Runs inside every read and write of a game, so no scheduled job is needed.
create or replace function holler.pass_tick(p_game uuid) returns void
language plpgsql security definer set search_path = holler, public as $$
declare g holler.games; st jsonb; i int; n int; who uuid; guard int := 0;
begin
  select * into g from holler.games where id = p_game for update;
  if g.id is null or g.status <> 'playing' then return; end if;
  loop
    guard := guard + 1; exit when guard > 8;
    st := g.state; i := (st->>'idx')::int; n := jsonb_array_length(st->'order');
    who := (st->'order'->>i)::uuid;
    exit when holler.is_member(g.chat_id, who) and g.turn_since > now() - interval '48 hours';
    st := jsonb_set(st, '{turns}', coalesce(st->'turns', '[]'::jsonb)
            || jsonb_build_array(jsonb_build_object('who', who, 'turn', i, 'at', now(), 'skipped', true)));
    if i = 0 then
      update holler.games set state = st, status = 'ended', ended_at = now(), turn_person = null, turn_since = null,
        version = version + 1, updated_at = now() where id = g.id;
      return;
    elsif i + 1 >= n then
      update holler.games set state = st, status = 'done', ended_at = now(), turn_person = null, turn_since = null,
        version = version + 1, updated_at = now() where id = g.id returning * into g;
      perform holler.push_to(g.chat_id, array(select jsonb_array_elements_text(g.state->'order')::uuid), 'Pass It On is ready to watch');
      return;
    end if;
    st := jsonb_set(st, '{idx}', to_jsonb(i + 1));
    update holler.games set state = st, turn_person = (st->'order'->>(i + 1))::uuid, turn_since = now(), nudged_at = null,
      version = version + 1, updated_at = now() where id = g.id returning * into g;
    perform holler.push_to(g.chat_id, array[g.turn_person], 'Your turn in Pass It On');
  end loop;
end $$;

-- A finished upload that belongs to a game: check it's this person's turn, attach it, move the game on.
-- Called from holler_finish_polo BEFORE the polo is marked ready, so notify_polo sees game_id.
create or replace function holler.pass_take_turn(p_polo uuid, p_me uuid, p_effects jsonb) returns void
language plpgsql security definer set search_path = holler, public as $$
declare g holler.games; po holler.polos; st jsonb; i int; n int; gid uuid; reveal boolean;
begin
  begin gid := (p_effects->'game'->>'id')::uuid; exception when others then raise exception 'That game is gone.'; end;
  reveal := coalesce((p_effects->'game'->>'reveal')::boolean, false);
  perform holler.game_tick(gid);
  select * into g from holler.games where id = gid for update;
  select * into po from holler.polos where id = p_polo;
  if g.id is null or po.id is null or g.chat_id <> po.chat_id then raise exception 'That game is gone.'; end if;
  if not coalesce((g.state->'order') ? p_me::text, false) then raise exception 'You are not in that game.'; end if;

  if reveal then
    if g.status = 'playing' then raise exception 'That game is still going.'; end if;
    update holler.polos set game_id = g.id, game_turn = null where id = p_polo;
    return;
  end if;

  if g.status <> 'playing' or g.turn_person is distinct from p_me then
    raise exception 'Your turn already passed, so this one was not sent.';
  end if;
  st := g.state; i := (st->>'idx')::int; n := jsonb_array_length(st->'order');
  if i >= 1 and not coalesce(st->'looked' ? p_me::text, false) then raise exception 'Watch the clip before you copy it.'; end if;

  update holler.polos set game_id = g.id, game_turn = i where id = p_polo;
  st := jsonb_set(st, '{turns}', coalesce(st->'turns', '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object('who', p_me, 'turn', i, 'at', now(), 'polo', p_polo)));
  if i + 1 >= n then
    st := jsonb_set(st, '{guess}', coalesce(to_jsonb(nullif(left(trim(coalesce(p_effects->'game'->>'guess', '')), 200), '')), 'null'::jsonb));
    update holler.games set state = st, status = 'done', ended_at = now(), turn_person = null, turn_since = null,
      version = version + 1, updated_at = now() where id = g.id returning * into g;
    perform holler.push_to(g.chat_id, array(select x::uuid from jsonb_array_elements_text(st->'order') x where x <> p_me::text), 'Pass It On is ready to watch');
  else
    st := jsonb_set(st, '{idx}', to_jsonb(i + 1));
    update holler.games set state = st, turn_person = (st->'order'->>(i + 1))::uuid, turn_since = now(), nudged_at = null,
      version = version + 1, updated_at = now() where id = g.id returning * into g;
    perform holler.push_to(g.chat_id, array[g.turn_person], 'Your turn in Pass It On');
  end if;
end $$;


-- ---------- chat summary: round games count as 'your turn' while you still owe a move ----------
create or replace function holler.chat_summary(p_chat uuid, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'code', c.invite_code, 'theme', c.theme, 'lastPoloAt', c.last_polo_at,
    'muted', (select m.muted from holler.members m where m.chat_id = c.id and m.person_id = p_me),
    'members', (select coalesce(jsonb_agg(holler.person_json(p) order by m.joined_at), '[]')
                  from holler.members m join holler.people p on p.id = m.person_id where m.chat_id = c.id),
    'unread', (select count(*) from holler.polos po where po.chat_id = c.id and po.status = 'ready' and po.game_id is null
                 and po.author_id <> p_me
                 and not exists (select 1 from holler.views v where v.polo_id = po.id and v.person_id = p_me)),
    'yourTurn', (select count(*) from holler.games g where g.chat_id = c.id and g.status = 'playing' and (g.turn_person = p_me or coalesce(g.state->'todo', '[]'::jsonb) ? p_me::text)),
    'last', (select jsonb_build_object('id', po.id, 'kind', po.kind, 'thumb', po.thumb_path, 'author', po.author_id,
                                       'body', left(po.body, 80), 'at', po.created_at,
                                       'seen', (select coalesce(jsonb_agg(v.person_id order by v.viewed_at), '[]') from holler.views v
                                                 where v.polo_id = po.id and v.person_id <> po.author_id))
               from holler.polos po where po.chat_id = c.id and po.status = 'ready' and po.game_id is null
              order by po.created_at desc limit 1)
  ) from holler.chats c where c.id = p_chat
$$;


-- ---------- finishing a polo: a Charades word goes to the game's secret, never onto the polo ----------
create or replace function public.holler_finish_polo(p_token text, p_polo uuid, p_duration real, p_w int, p_h int, p_transcript text, p_effects jsonb, p_has_thumb boolean)
returns jsonb language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); po holler.polos; sz bigint; rt uuid;
begin
  -- never publish an empty recording (an iPhone can hand back a 0-byte file from a very short take)
  select coalesce((o.metadata->>'size')::bigint, 0) into sz from storage.objects o
    join holler.polos x on x.path = o.name where x.id = p_polo and o.bucket_id = 'holler';
  if coalesce(sz, 0) < 1000 then raise exception 'That holler came out empty. Please record it again.'; end if;
  select * into po from holler.polos where id = p_polo and author_id = me and status = 'uploading';
  if po.id is null then raise exception 'polo not found'; end if;
  if p_effects ? 'game' then perform holler.game_take_turn(p_polo, me, p_effects); end if;
  if p_effects ? 'reactTo' then
    begin rt := (p_effects->>'reactTo')::uuid; exception when others then rt := null; end;
    update holler.polos set react_to = rt where id = p_polo
      and exists (select 1 from holler.polos o where o.id = rt and o.chat_id = po.chat_id);
  end if;
  update holler.polos set status = 'ready', ready_at = now(), duration = p_duration, width = p_w, height = p_h,
    transcript = nullif(left(p_transcript, 20000), ''), effects = coalesce(p_effects, '{}'::jsonb) #- '{game,word}',
    thumb_path = case when p_has_thumb then thumb_path end
  where id = p_polo and author_id = me and status = 'uploading' returning * into po;
  if po.id is null then raise exception 'polo not found'; end if;
  if po.game_id is null then update holler.chats set last_polo_at = now() where id = po.chat_id; end if;
  insert into holler.views (polo_id, person_id) values (po.id, me) on conflict do nothing;
  return holler.polo_json(po);
end $$;


-- ---------- shared pieces for the round games ----------
create or replace function holler.game_hidden(g holler.games) returns boolean
language sql stable as $$
  select g.status <> 'playing' and g.saved_at is null and g.ended_at <= now() - interval '7 days'
$$;

create or replace function holler.game_base(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select jsonb_build_object(
    'id', g.id, 'chat', g.chat_id, 'kind', g.kind, 'status', g.status, 'version', g.version,
    'order', g.state->'order', 'todo', coalesce(g.state->'todo', '[]'::jsonb), 'turnPerson', g.turn_person,
    'nudgedAt', g.nudged_at, 'createdBy', g.created_by, 'createdAt', g.created_at, 'endedAt', g.ended_at,
    'savedAt', g.saved_at, 'savedBy', g.saved_by, 'hidden', holler.game_hidden(g),
    'hidesAt', case when g.status <> 'playing' and g.saved_at is null then g.ended_at + interval '7 days' end,
    'turns', '[]'::jsonb, 'idx', 0, 'turnSec', g.state->'turnSec', 'deck', g.state->'deck')
$$;

create or replace function holler.order_idx(p_order jsonb, p_who uuid) returns int
language sql immutable as $$
  select (k - 1)::int from jsonb_array_elements_text(p_order) with ordinality a(x, k) where x = p_who::text
$$;

-- ---------- Poker Face ----------
-- Everyone records an answer to the same question straight to camera. One person, picked at random by the
-- server, is secretly handed the real answer; everyone else makes one up. Then everyone else votes on who
-- was telling the truth. state: { order, deck, cardId, question, phase: record|vote, since, clips: {who: polo},
-- votes: {who: pick}, todo }. secret: { truth: personId, answer }.
create or replace function holler.poker_json(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select holler.game_base(g, p_me) || jsonb_build_object(
    'cardId', g.state->'cardId', 'question', g.state->'question', 'phase', g.state->'phase', 'since', g.state->'since',
    'recorded', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(coalesce(g.state->'clips', '{}'::jsonb)) k),
    'voted', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(coalesce(g.state->'votes', '{}'::jsonb)) k),
    'myVote', g.state->'votes'->(p_me::text),
    'truthIsMe', coalesce(g.secret->>'truth' = p_me::text, false),
    'answer', case when g.secret->>'truth' = p_me::text or g.status <> 'playing' then g.secret->>'answer' end,
    'truth', case when g.status <> 'playing' then g.secret->>'truth' end,
    'votes', case when g.status <> 'playing' then g.state->'votes' end,
    'clips', case when (g.state->>'phase' = 'vote' or g.status <> 'playing') and not holler.game_hidden(g) then
               (select coalesce(jsonb_agg(holler.polo_json(po) order by po.game_turn), '[]')
                  from holler.polos po where po.game_id = g.id and po.status = 'ready') end
  )
$$;

-- Moves the game along when nobody owes anything (or 48 hours passed). Runs on every read and write.
create or replace function holler.poker_advance(p_game uuid) returns void
language plpgsql security definer set search_path = holler, public as $$
declare g holler.games; st jsonb; todo jsonb; truth text; n int;
begin
  select * into g from holler.games where id = p_game for update;
  if g.id is null or g.status <> 'playing' then return; end if;
  st := g.state; truth := g.secret->>'truth';
  select coalesce(jsonb_agg(x), '[]') into todo from jsonb_array_elements_text(coalesce(st->'todo', '[]')) x
   where holler.is_member(g.chat_id, x::uuid);
  if jsonb_array_length(todo) > 0 and (st->>'since')::timestamptz > now() - interval '48 hours' then
    if todo is distinct from st->'todo' then
      update holler.games set state = jsonb_set(st, '{todo}', todo), version = version + 1, updated_at = now() where id = g.id;
    end if;
    return;
  end if;

  if st->>'phase' = 'record' then
    select count(*) into n from jsonb_object_keys(coalesce(st->'clips', '{}'::jsonb));
    if not coalesce((st->'clips') ? truth, false) or n < 2 then
      update holler.games set state = jsonb_set(st, '{todo}', '[]'), status = 'ended', ended_at = now(),
        version = version + 1, updated_at = now() where id = g.id;
      return;
    end if;
    select coalesce(jsonb_agg(x), '[]') into todo from jsonb_array_elements_text(st->'order') x
     where x <> truth and holler.is_member(g.chat_id, x::uuid);
    st := st || jsonb_build_object('phase', 'vote', 'since', now(), 'todo', todo);
    update holler.games set state = st, version = version + 1, updated_at = now() where id = g.id;
    perform holler.push_to(g.chat_id, array(select jsonb_array_elements_text(todo)::uuid), 'Poker Face: everyone answered. Who is telling the truth?');
    return;
  end if;

  update holler.games set state = jsonb_set(st, '{todo}', '[]'), status = 'done', ended_at = now(),
    version = version + 1, updated_at = now() where id = g.id;
  perform holler.push_to(g.chat_id, array(select jsonb_array_elements_text(st->'order')::uuid), 'Poker Face: see who was lying');
end $$;

create or replace function holler.poker_take_turn(p_polo uuid, p_me uuid, p_game uuid) returns void
language plpgsql security definer set search_path = holler, public as $$
declare g holler.games; st jsonb;
begin
  perform holler.poker_advance(p_game);
  select * into g from holler.games where id = p_game for update;
  if not coalesce((g.state->'order') ? p_me::text, false) then raise exception 'You are not in that game.'; end if;
  if g.status <> 'playing' or g.state->>'phase' <> 'record' then raise exception 'Answers are closed, so this one was not sent.'; end if;
  if coalesce((g.state->'clips') ? p_me::text, false) then raise exception 'You already answered this one.'; end if;
  update holler.polos set game_id = g.id, game_turn = holler.order_idx(g.state->'order', p_me) where id = p_polo;
  st := jsonb_set(g.state, '{clips}', coalesce(g.state->'clips', '{}'::jsonb) || jsonb_build_object(p_me::text, p_polo));
  st := jsonb_set(st, '{todo}', (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements_text(coalesce(st->'todo', '[]')) x where x <> p_me::text));
  update holler.games set state = st, version = version + 1, updated_at = now() where id = g.id;
  perform holler.poker_advance(p_game);
end $$;

create or replace function public.holler_game_vote(p_token text, p_game uuid, p_pick uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; st jsonb;
begin
  perform holler.game_tick(p_game);
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) or g.kind <> 'poker' then raise exception 'That game is gone.'; end if;
  if g.status <> 'playing' then raise exception 'Voting is over.'; end if;
  if g.state->>'phase' <> 'vote' then raise exception 'Voting opens once everyone has answered.'; end if;
  if not coalesce((g.state->'todo') ? me::text, false) then
    if coalesce((g.state->'votes') ? me::text, false) then raise exception 'You already voted.'; end if;
    raise exception 'You know the answer, so you sit this vote out.';
  end if;
  if p_pick = me or not coalesce((g.state->'clips') ? p_pick::text, false) then raise exception 'Pick someone else''s answer.'; end if;
  st := jsonb_set(g.state, '{votes}', coalesce(g.state->'votes', '{}'::jsonb) || jsonb_build_object(me::text, p_pick));
  st := jsonb_set(st, '{todo}', (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements_text(st->'todo') x where x <> me::text));
  update holler.games set state = st, version = version + 1, updated_at = now() where id = g.id;
  perform holler.poker_advance(p_game);
  select * into g from holler.games where id = p_game;
  return holler.game_json(g, me);
end $$;

-- ---------- Charades Relay ----------
-- Everyone acts out their own secret word (a fixed 10, 15 or 20 seconds, no words). Everyone else watches
-- and guesses: up to 3 tries per clip, and the sooner in the clip you get it, the more it scores.
-- state: { order, turnSec, deck, acts: {who: {polo, at}}, guesses: {actor: {guesser: {tries, ok, done, t, text, at}}}, todo }
-- secret: { words: {who: word} }. A word only shows to its actor, to a guesser who is finished with it, and to everyone at the end.
create or replace function holler.charades_norm(s text) returns text
language sql immutable as $$
  select replace(trim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(s, '')), '[^a-z0-9 ]', '', 'g'),
    '\m(the|a|an)\M', ' ', 'g'), '\s+', ' ', 'g')), ' ', '')
$$;

create or replace function holler.charades_match(p_guess text, p_word text) returns boolean
language sql immutable as $$
  with n as (select holler.charades_norm(p_guess) g, holler.charades_norm(p_word) w)
  select w <> '' and g <> '' and (
       g = w or rtrim(g, 's') = rtrim(w, 's')
    or (length(w) >= 3 and position(w in g) > 0)
    or (length(g) >= 5 and position(g in w) > 0 and length(g) * 10 >= length(w) * 7)
  ) from n
$$;

create or replace function holler.charades_todo(g holler.games) returns jsonb
language sql stable security definer set search_path = holler as $$
  select coalesce(jsonb_agg(p), '[]') from jsonb_array_elements_text(g.state->'order') p
   where holler.is_member(g.chat_id, p::uuid)
     and (not coalesce((g.state->'acts') ? p, false)
          or exists (select 1 from jsonb_object_keys(coalesce(g.state->'acts', '{}'::jsonb)) a
                      where a <> p and not coalesce((g.state->'guesses'->a->p->>'done')::boolean, false)))
$$;

create or replace function holler.charades_json(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select holler.game_base(g, p_me) || jsonb_build_object(
    'acted', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(coalesce(g.state->'acts', '{}'::jsonb)) k),
    'acts', (select coalesce(jsonb_agg(jsonb_build_object(
        'who', a.key, 'at', a.value->'at',
        'clip', case when not holler.game_hidden(g) then
                  (select holler.polo_json(po) from holler.polos po where po.id = (a.value->>'polo')::uuid and po.status = 'ready') end,
        'word', case when g.status <> 'playing' or a.key = p_me::text
                       or coalesce((g.state->'guesses'->a.key->(p_me::text)->>'done')::boolean, false)
                     then g.secret->'words'->>a.key end,
        'mine', g.state->'guesses'->a.key->(p_me::text),
        'results', (select coalesce(jsonb_object_agg(r.key,
                      case when g.status <> 'playing' or a.key = p_me::text
                             or coalesce((g.state->'guesses'->a.key->(p_me::text)->>'done')::boolean, false)
                           then r.value else r.value - 'text' end), '{}'::jsonb)
                      from jsonb_each(coalesce(g.state->'guesses'->a.key, '{}'::jsonb)) r)
      ) order by a.value->>'at'), '[]') from jsonb_each(coalesce(g.state->'acts', '{}'::jsonb)) a)
  )
$$;

create or replace function holler.charades_advance(p_game uuid) returns void
language plpgsql security definer set search_path = holler, public as $$
declare g holler.games; todo jsonb;
begin
  select * into g from holler.games where id = p_game for update;
  if g.id is null or g.status <> 'playing' then return; end if;
  todo := holler.charades_todo(g);
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
  perform holler.push_to(g.chat_id, array(select jsonb_array_elements_text(g.state->'order')::uuid), 'Charades Relay: the final scores are in');
end $$;

create or replace function holler.charades_take_turn(p_polo uuid, p_me uuid, p_game uuid, p_word text) returns void
language plpgsql security definer set search_path = holler, public as $$
declare g holler.games; st jsonb; w text := trim(coalesce(p_word, '')); nm text;
begin
  perform holler.charades_advance(p_game);
  select * into g from holler.games where id = p_game for update;
  if not coalesce((g.state->'order') ? p_me::text, false) then raise exception 'You are not in that game.'; end if;
  if g.status <> 'playing' then raise exception 'That game is over, so this one was not sent.'; end if;
  if coalesce((g.state->'acts') ? p_me::text, false) then raise exception 'You already acted in this one.'; end if;
  if length(w) not between 1 and 60 then raise exception 'That clip lost its word. Please act it again.'; end if;
  update holler.polos set game_id = g.id, game_turn = holler.order_idx(g.state->'order', p_me) where id = p_polo;
  st := jsonb_set(g.state, '{acts}', coalesce(g.state->'acts', '{}'::jsonb) || jsonb_build_object(p_me::text, jsonb_build_object('polo', p_polo, 'at', now())));
  st := jsonb_set(st, '{guesses}', coalesce(st->'guesses', '{}'::jsonb) || jsonb_build_object(p_me::text, '{}'::jsonb));
  update holler.games set state = st,
    secret = jsonb_set(secret, '{words}', coalesce(secret->'words', '{}'::jsonb) || jsonb_build_object(p_me::text, w)),
    version = version + 1, updated_at = now() where id = g.id;
  perform holler.charades_advance(p_game);
  select split_part(name, ' ', 1) into nm from holler.people where id = p_me;
  perform holler.push_to(g.chat_id, array(select x::uuid from jsonb_array_elements_text(g.state->'order') x where x <> p_me::text),
    coalesce(nm, 'Someone') || ' acted one out in Charades Relay. Can you get it?');
end $$;

create or replace function public.holler_game_guess(p_token text, p_game uuid, p_actor uuid, p_text text, p_t real) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; e jsonb; w text; ok boolean; tries int; fin boolean;
begin
  perform holler.game_tick(p_game);
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) or g.kind <> 'charades' then raise exception 'That game is gone.'; end if;
  if g.status <> 'playing' then raise exception 'This game is over.'; end if;
  if not coalesce((g.state->'order') ? me::text, false) then raise exception 'You are not in that game.'; end if;
  if p_actor = me then raise exception 'That one is yours.'; end if;
  if not coalesce((g.state->'acts') ? p_actor::text, false) then raise exception 'They have not acted yet.'; end if;
  if length(trim(coalesce(p_text, ''))) = 0 then raise exception 'Type a guess.'; end if;
  e := coalesce(g.state->'guesses'->p_actor::text->me::text, '{}'::jsonb);
  if coalesce((e->>'done')::boolean, false) then raise exception 'You already finished this one.'; end if;
  w := g.secret->'words'->>p_actor::text;
  ok := holler.charades_match(p_text, w);
  tries := coalesce((e->>'tries')::int, 0) + 1;
  fin := ok or tries >= 3;
  e := jsonb_build_object('tries', tries, 'ok', ok, 'done', fin, 't', case when ok then greatest(0, coalesce(p_t, 0)) end,
                          'text', left(trim(p_text), 80), 'at', now());
  update holler.games set state = jsonb_set(state, array['guesses', p_actor::text, me::text], e),
    version = version + 1, updated_at = now() where id = g.id;
  perform holler.charades_advance(p_game);
  select * into g from holler.games where id = p_game;
  return jsonb_build_object('ok', ok, 'tries', tries, 'done', fin, 'word', case when fin then w end, 'game', holler.game_json(g, me));
end $$;

-- ---------- dispatchers: every game goes through these ----------
create or replace function holler.game_json(g holler.games, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select case g.kind when 'poker' then holler.poker_json(g, p_me) when 'charades' then holler.charades_json(g, p_me)
         else holler.pass_json(g, p_me) end
$$;

create or replace function holler.game_tick(p_game uuid) returns void
language plpgsql security definer set search_path = holler, public as $$
declare k text;
begin
  select kind into k from holler.games where id = p_game;
  if k = 'poker' then perform holler.poker_advance(p_game);
  elsif k = 'charades' then perform holler.charades_advance(p_game);
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
  else perform holler.pass_take_turn(p_polo, p_me, p_effects);
  end if;
end $$;

-- ---------- starting a round game ----------
create or replace function public.holler_game_start2(p_token text, p_chat uuid, p_kind text, p_order uuid[], p_opts jsonb)
returns jsonb language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; n int; x uuid; q text; ans text; sec int; nm text;
begin
  if not holler.is_member(p_chat, me) then raise exception 'not in this chat'; end if;
  if p_kind not in ('poker', 'charades') then raise exception 'Unknown game'; end if;
  n := coalesce(array_length(p_order, 1), 0);
  if p_kind = 'poker' and (n < 3 or n > 5) then raise exception 'Poker Face needs 3 to 5 people.'; end if;
  if p_kind = 'charades' and (n < 2 or n > 5) then raise exception 'Charades Relay needs 2 to 5 people.'; end if;
  if not (me = any(p_order)) then raise exception 'You have to be in a game you start.'; end if;
  if (select count(distinct y) from unnest(p_order) y) <> n then raise exception 'Someone is in the game twice.'; end if;
  foreach x in array p_order loop
    if not holler.is_member(p_chat, x) then raise exception 'Everyone in the game has to be in this chat.'; end if;
  end loop;
  if (select count(*) from holler.games where chat_id = p_chat and status = 'playing') >= 3 then
    raise exception 'This chat already has 3 games going. Finish one first.';
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
  else
    sec := coalesce((p_opts->>'turnSec')::int, 15);
    if sec not in (10, 15, 20) then raise exception 'Turns are 10, 15 or 20 seconds.'; end if;
    insert into holler.games (chat_id, kind, state, secret, created_by)
    values (p_chat, 'charades',
      jsonb_build_object('order', to_jsonb(p_order), 'turnSec', sec, 'deck', left(coalesce(p_opts->>'deck', 'mixed'), 20),
                         'acts', '{}'::jsonb, 'guesses', '{}'::jsonb, 'todo', to_jsonb(p_order)),
      jsonb_build_object('words', '{}'::jsonb), me)
    returning * into g;
  end if;
  select split_part(name, ' ', 1) into nm from holler.people where id = me;
  perform holler.push_to(p_chat, array(select y from unnest(p_order) y where y <> me),
    coalesce(nm, 'Someone') || ' started ' || holler.game_label(p_kind) || '. You''re in.');
  return holler.game_json(g, me);
end $$;

-- ---------- nudge: Pass It On nudges whoever is up; round games nudge everyone who still owes a move ----------
create or replace function public.holler_game_nudge(p_token text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; nm text; who uuid[];
begin
  perform holler.game_tick(p_game);
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) then raise exception 'That game is gone.'; end if;
  if g.status <> 'playing' then return holler.game_json(g, me); end if;
  if g.kind = 'passiton' then
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

revoke all on function holler.pass_json(holler.games, uuid), holler.pass_tick(uuid), holler.pass_take_turn(uuid, uuid, jsonb),
  holler.game_base(holler.games, uuid), holler.poker_json(holler.games, uuid), holler.poker_advance(uuid),
  holler.poker_take_turn(uuid, uuid, uuid), holler.charades_todo(holler.games), holler.charades_json(holler.games, uuid),
  holler.charades_advance(uuid), holler.charades_take_turn(uuid, uuid, uuid, text),
  holler.game_json(holler.games, uuid), holler.game_tick(uuid), holler.game_take_turn(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function
  public.holler_game_start2(text, uuid, text, uuid[], jsonb), public.holler_game_vote(text, uuid, uuid),
  public.holler_game_guess(text, uuid, uuid, text, real), public.holler_game_nudge(text, uuid)
to anon, authenticated;

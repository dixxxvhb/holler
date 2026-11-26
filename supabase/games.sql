-- Holler Play (2026-11-26): turn games where a turn is a holler, plus reaction replies.
-- Plan: docs/plans/2026-11-25-holler-games.md. Additive: one new table, three nullable columns on polos,
-- and replacements of Holler's own functions. Nothing is dropped or rewritten. Safe to run twice.
-- Pass It On's rules live here (not in a client reduce) so the phrase and the middle clips stay hidden.

create table if not exists holler.games (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references holler.chats(id) on delete cascade,
  kind text not null check (kind in ('passiton')),
  status text not null default 'playing' check (status in ('playing','done','ended')),
  state jsonb not null default '{}',
  secret jsonb not null default '{}',
  version int not null default 0,
  turn_person uuid references holler.people(id) on delete set null,
  turn_since timestamptz,
  nudged_at timestamptz,
  created_by uuid references holler.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  saved_by uuid references holler.people(id) on delete set null,
  saved_at timestamptz
);
create index if not exists games_chat_idx on holler.games (chat_id, status);

alter table holler.polos add column if not exists game_id uuid references holler.games(id) on delete set null;
alter table holler.polos add column if not exists game_turn int;
alter table holler.polos add column if not exists react_to uuid references holler.polos(id) on delete set null;
create index if not exists polos_game_idx on holler.polos (game_id) where game_id is not null;

revoke all on holler.games from anon, authenticated;

-- ---------- polo json: carries reactTo and game ----------
create or replace function holler.polo_json(po holler.polos) returns jsonb
language sql stable security definer set search_path = holler as $$
  select jsonb_build_object(
    'id', po.id, 'chat', po.chat_id, 'author', po.author_id, 'kind', po.kind, 'path', po.path,
    'thumb', po.thumb_path, 'mime', po.mime, 'duration', po.duration, 'w', po.width, 'h', po.height,
    'body', po.body, 'transcript', po.transcript, 'effects', po.effects, 'at', po.created_at,
    'reactTo', po.react_to, 'game', po.game_id, 'gameTurn', po.game_turn,
    'views', (select coalesce(jsonb_agg(jsonb_build_object('who', v.person_id, 'at', v.viewed_at)), '[]')
                from holler.views v where v.polo_id = po.id),
    'reactions', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'who', r.person_id, 'kind', r.kind, 't', r.at_sec) order by r.created_at), '[]')
                    from holler.reactions r where r.polo_id = po.id),
    'savedBy', (select coalesce(jsonb_agg(s.person_id), '[]') from holler.saves s where s.polo_id = po.id)
  )
$$;

-- ---------- chat summary: game turn clips never count as unread or as the latest holler ----------
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
    'yourTurn', (select count(*) from holler.games g where g.chat_id = c.id and g.status = 'playing' and g.turn_person = p_me),
    'last', (select jsonb_build_object('id', po.id, 'kind', po.kind, 'thumb', po.thumb_path, 'author', po.author_id,
                                       'body', left(po.body, 80), 'at', po.created_at,
                                       'seen', (select coalesce(jsonb_agg(v.person_id order by v.viewed_at), '[]') from holler.views v
                                                 where v.polo_id = po.id and v.person_id <> po.author_id))
               from holler.polos po where po.chat_id = c.id and po.status = 'ready' and po.game_id is null
              order by po.created_at desc limit 1)
  ) from holler.chats c where c.id = p_chat
$$;

-- ---------- push to chosen people (same edge function as notify_polo) ----------
create or replace function holler.push_to(p_chat uuid, p_people uuid[], p_body text) returns void
language plpgsql security definer set search_path = holler, extensions, public as $$
declare secret text; subs jsonb; cname text;
begin
  select value into secret from holler.config where key = 'push_secret';
  if secret is null then return; end if;
  select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'sub', s.sub)) into subs
    from holler.members m join holler.push_subs s on s.person_id = m.person_id
   where m.chat_id = p_chat and m.person_id = any(p_people) and not m.muted;
  if subs is null then return; end if;
  select nullif(name, '') into cname from holler.chats where id = p_chat;
  perform net.http_post(
    url := 'https://swjqlfcqvcrnydpyjyog.supabase.co/functions/v1/holler-push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-holler-secret', secret),
    body := jsonb_build_object('title', coalesce(cname, 'Holler'), 'body', p_body, 'chat', p_chat, 'url', '#/c/' || p_chat, 'subs', subs)
  );
exception when others then
  return; -- a push never blocks a game
end $$;

-- notify_polo: game clips stay quiet (the game sends its own pushes); reactions say so.
create or replace function holler.notify_polo() returns trigger
language plpgsql security definer set search_path = holler, extensions, public as $$
declare
  secret text; aname text; cname text; subs jsonb; msg text;
begin
  if new.status <> 'ready' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'ready' then return new; end if;
  if new.game_id is not null then return new; end if;

  select value into secret from holler.config where key = 'push_secret';
  if secret is null then return new; end if;

  select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'sub', s.sub)) into subs
    from holler.members m
    join holler.push_subs s on s.person_id = m.person_id
   where m.chat_id = new.chat_id and m.person_id <> new.author_id and not m.muted;
  if subs is null then return new; end if;

  select name into aname from holler.people where id = new.author_id;
  select name into cname from holler.chats where id = new.chat_id;
  aname := coalesce(nullif(aname, ''), 'Someone');
  cname := nullif(cname, '');

  if new.kind = 'text' then
    msg := aname || ': ' || left(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g'), 80);
  elsif new.react_to is not null then
    msg := aname || ' filmed a reaction';
  elsif cname is not null then
    msg := aname || ' hollered in ' || cname;
  else
    msg := aname || ' hollered';
  end if;

  perform net.http_post(
    url := 'https://swjqlfcqvcrnydpyjyog.supabase.co/functions/v1/holler-push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-holler-secret', secret),
    body := jsonb_build_object('title', coalesce(cname, 'Holler'), 'body', msg, 'chat', new.chat_id, 'url', '#/c/' || new.chat_id, 'subs', subs)
  );
  return new;
exception when others then
  return new; -- never block a polo because a push failed
end $$;

-- ---------- game state ----------
-- What one person may see of a game. Clips only once it's over, and only for 7 days unless the reel is saved.
create or replace function holler.game_json(g holler.games, p_me uuid) returns jsonb
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
create or replace function holler.game_tick(p_game uuid) returns void
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
create or replace function holler.game_take_turn(p_polo uuid, p_me uuid, p_effects jsonb) returns void
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

-- ---------- finishing a polo: attach game turns and reactions before it goes live ----------
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
    transcript = nullif(left(p_transcript, 20000), ''), effects = coalesce(p_effects, '{}'),
    thumb_path = case when p_has_thumb then thumb_path end
  where id = p_polo and author_id = me and status = 'uploading' returning * into po;
  if po.id is null then raise exception 'polo not found'; end if;
  if po.game_id is null then update holler.chats set last_polo_at = now() where id = po.chat_id; end if;
  insert into holler.views (polo_id, person_id) values (po.id, me) on conflict do nothing;
  return holler.polo_json(po);
end $$;

-- ---------- the chat: no game clips in the strip; games come alongside ----------
create or replace function public.holler_chat(p_token text, p_chat uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); gid uuid;
begin
  if not holler.is_member(p_chat, me) then raise exception 'not in this chat'; end if;
  for gid in select id from holler.games where chat_id = p_chat and status = 'playing' loop perform holler.game_tick(gid); end loop;
  return holler.chat_summary(p_chat, me) || jsonb_build_object(
    'polos', (select coalesce(jsonb_agg(holler.polo_json(po) order by po.created_at), '[]')
                from holler.polos po where po.chat_id = p_chat and po.status = 'ready' and po.game_id is null),
    'games', (select coalesce(jsonb_agg(holler.game_json(g, me) order by g.created_at), '[]')
                from holler.games g where g.chat_id = p_chat
                 and (g.status = 'playing' or g.saved_at is not null or g.ended_at > now() - interval '7 days')));
end $$;

-- ---------- game RPCs ----------
create or replace function public.holler_game_start(p_token text, p_chat uuid, p_kind text, p_order uuid[], p_turn_sec int, p_phrase text, p_deck_id text)
returns jsonb language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; n int; x uuid;
begin
  if not holler.is_member(p_chat, me) then raise exception 'not in this chat'; end if;
  if p_kind <> 'passiton' then raise exception 'Unknown game'; end if;
  n := coalesce(array_length(p_order, 1), 0);
  if n < 3 or n > 5 then raise exception 'Pass It On needs 3 to 5 people.'; end if;
  if p_order[1] is distinct from me then raise exception 'You go first in a game you start.'; end if;
  if (select count(distinct y) from unnest(p_order) y) <> n then raise exception 'Someone is in the order twice.'; end if;
  foreach x in array p_order loop
    if not holler.is_member(p_chat, x) then raise exception 'Everyone in the order has to be in this chat.'; end if;
  end loop;
  if p_turn_sec not in (5, 10, 15) then raise exception 'Turns are 5, 10 or 15 seconds.'; end if;
  if length(trim(coalesce(p_phrase, ''))) not between 1 and 120 then raise exception 'Pick a phrase.'; end if;
  if (select count(*) from holler.games where chat_id = p_chat and status = 'playing') >= 3 then
    raise exception 'This chat already has 3 games going. Finish one first.';
  end if;
  insert into holler.games (chat_id, kind, state, secret, turn_person, turn_since, created_by)
  values (p_chat, p_kind,
          jsonb_build_object('order', to_jsonb(p_order), 'turnSec', p_turn_sec, 'idx', 0, 'turns', '[]'::jsonb, 'looked', '{}'::jsonb, 'guess', null),
          jsonb_build_object('phrase', trim(p_phrase), 'deckId', left(coalesce(p_deck_id, ''), 40)),
          me, now(), me)
  returning * into g;
  return holler.game_json(g, me);
end $$;

create or replace function public.holler_game(p_token text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games;
begin
  perform holler.game_tick(p_game);
  select * into g from holler.games where id = p_game;
  if g.id is null or not holler.is_member(g.chat_id, me) then raise exception 'That game is gone.'; end if;
  return holler.game_json(g, me);
end $$;

-- The clip you copy: the last real turn before yours. Only for the person whose turn it is, and only until they've watched it once.
create or replace function public.holler_game_look(p_token text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; pid uuid; po holler.polos;
begin
  perform holler.game_tick(p_game);
  select * into g from holler.games where id = p_game;
  if g.id is null or not holler.is_member(g.chat_id, me) then raise exception 'That game is gone.'; end if;
  if g.status <> 'playing' or g.turn_person is distinct from me then raise exception 'It is not your turn.'; end if;
  if coalesce(g.state->'looked' ? me::text, false) then raise exception 'You already had your one look.'; end if;
  select (t->>'polo')::uuid into pid from jsonb_array_elements(g.state->'turns') with ordinality a(t, k)
   where t->>'polo' is not null order by k desc limit 1;
  if pid is null then raise exception 'There is nothing to copy yet.'; end if;
  select * into po from holler.polos where id = pid and status = 'ready';
  if po.id is null then raise exception 'That clip is gone.'; end if;
  return jsonb_build_object('path', po.path, 'thumb', po.thumb_path, 'duration', po.duration, 'who', po.author_id, 'mime', po.mime);
end $$;

create or replace function public.holler_game_looked(p_token text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games;
begin
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) then raise exception 'That game is gone.'; end if;
  if g.status = 'playing' and g.turn_person = me then
    update holler.games set state = jsonb_set(state, '{looked}', coalesce(state->'looked', '{}'::jsonb) || jsonb_build_object(me::text, now())),
      version = version + 1, updated_at = now() where id = g.id returning * into g;
  end if;
  return holler.game_json(g, me);
end $$;

create or replace function public.holler_game_nudge(p_token text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games; nm text;
begin
  perform holler.game_tick(p_game);
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) then raise exception 'That game is gone.'; end if;
  if g.status <> 'playing' or g.turn_person is null or g.turn_person = me then return holler.game_json(g, me); end if;
  if g.nudged_at > now() - interval '6 hours' then raise exception 'They were nudged in the last 6 hours.'; end if;
  select split_part(name, ' ', 1) into nm from holler.people where id = me;
  update holler.games set nudged_at = now() where id = g.id returning * into g;
  perform holler.push_to(g.chat_id, array[g.turn_person], coalesce(nm, 'Someone') || ' is waiting on your Pass It On turn');
  return holler.game_json(g, me);
end $$;

create or replace function public.holler_game_save(p_token text, p_game uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games;
begin
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) then raise exception 'That game is gone.'; end if;
  if g.status = 'playing' then raise exception 'Save the reel once the game is over.'; end if;
  if p_on and g.ended_at <= now() - interval '7 days' and g.saved_at is null then raise exception 'These clips are already hidden.'; end if;
  update holler.games set saved_at = case when p_on then coalesce(saved_at, now()) end,
                          saved_by = case when p_on then coalesce(saved_by, me) end,
                          updated_at = now()
   where id = g.id returning * into g;
  return holler.game_json(g, me);
end $$;

create or replace function public.holler_game_end(p_token text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); g holler.games;
begin
  select * into g from holler.games where id = p_game for update;
  if g.id is null or not holler.is_member(g.chat_id, me) then raise exception 'That game is gone.'; end if;
  if g.created_by is distinct from me then raise exception 'Only the person who started it can end it.'; end if;
  if g.status = 'playing' then
    update holler.games set status = 'ended', ended_at = now(), turn_person = null, turn_since = null,
      version = version + 1, updated_at = now() where id = g.id returning * into g;
  end if;
  return holler.game_json(g, me);
end $$;

revoke all on function holler.game_json(holler.games, uuid), holler.game_tick(uuid), holler.game_take_turn(uuid, uuid, jsonb),
  holler.push_to(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function
  public.holler_game_start(text, uuid, text, uuid[], int, text, text), public.holler_game(text, uuid),
  public.holler_game_look(text, uuid), public.holler_game_looked(text, uuid), public.holler_game_nudge(text, uuid),
  public.holler_game_save(text, uuid, boolean), public.holler_game_end(text, uuid)
to anon, authenticated;

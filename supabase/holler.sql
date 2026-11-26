-- Holler: private video messages for a few people. Lives inside figgg's Supabase project in its own
-- `holler` schema (never exposed to PostgREST). The app reaches it only through public.holler_*
-- security-definer functions that take the caller's secret device token. Never add holler tables to
-- figgg's public schema (figgg's export/wipe enumerates it).

create schema if not exists holler;
create extension if not exists pgcrypto with schema extensions;

create table if not exists holler.people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 40),
  color text not null default '#FF7AA2',
  avatar_path text,
  token_hash text not null unique,
  prefs jsonb not null default '{}',
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists holler.tokens (
  token_hash text primary key,
  person_id uuid not null references holler.people(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists holler.chats (
  id uuid primary key default gen_random_uuid(),
  name text not null default '' check (length(name) <= 60),
  invite_code text not null unique,
  theme text not null default 'ember',
  created_by uuid references holler.people(id) on delete set null,
  created_at timestamptz not null default now(),
  last_polo_at timestamptz not null default now()
);

create table if not exists holler.members (
  chat_id uuid not null references holler.chats(id) on delete cascade,
  person_id uuid not null references holler.people(id) on delete cascade,
  joined_at timestamptz not null default now(),
  muted boolean not null default false,
  primary key (chat_id, person_id)
);

create table if not exists holler.polos (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references holler.chats(id) on delete cascade,
  author_id uuid not null references holler.people(id) on delete cascade,
  kind text not null check (kind in ('video','audio','text')),
  path text,
  thumb_path text,
  mime text,
  duration real,
  width int,
  height int,
  body text check (body is null or length(body) <= 2000),
  transcript text check (transcript is null or length(transcript) <= 20000),
  effects jsonb not null default '{}',
  status text not null default 'uploading' check (status in ('uploading','ready','deleted')),
  created_at timestamptz not null default now(),
  ready_at timestamptz
);
create index if not exists polos_chat_idx on holler.polos (chat_id, created_at);

create table if not exists holler.views (
  polo_id uuid not null references holler.polos(id) on delete cascade,
  person_id uuid not null references holler.people(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (polo_id, person_id)
);

create table if not exists holler.reactions (
  id uuid primary key default gen_random_uuid(),
  polo_id uuid not null references holler.polos(id) on delete cascade,
  person_id uuid not null references holler.people(id) on delete cascade,
  kind text not null check (length(kind) <= 20),
  at_sec real,
  created_at timestamptz not null default now()
);
create index if not exists reactions_polo_idx on holler.reactions (polo_id);

create table if not exists holler.saves (
  polo_id uuid not null references holler.polos(id) on delete cascade,
  person_id uuid not null references holler.people(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (polo_id, person_id)
);

create table if not exists holler.push_subs (
  endpoint text primary key,
  person_id uuid not null references holler.people(id) on delete cascade,
  sub jsonb not null,
  created_at timestamptz not null default now()
);

-- Nobody but the functions below touches these tables.
revoke all on all tables in schema holler from anon, authenticated;

-- ---------- helpers ----------
create or replace function holler.who(p_token text) returns uuid
language plpgsql security definer set search_path = holler, extensions, public as $$
declare v uuid;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'not signed in'; end if;
  select person_id into v from holler.tokens where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if v is null then raise exception 'not signed in'; end if;
  update holler.people set last_seen = now() where id = v and last_seen < now() - interval '1 minute';
  return v;
end $$;

create or replace function holler.is_member(p_chat uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = holler as $$
  select exists (select 1 from holler.members where chat_id = p_chat and person_id = p_person)
$$;

create or replace function holler.new_code() returns text
language plpgsql set search_path = holler, extensions as $$
declare c text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from holler.chats where invite_code = c);
  end loop;
  return c;
end $$;

create or replace function holler.person_json(p holler.people) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'color', p.color, 'avatar', p.avatar_path, 'lastSeen', p.last_seen)
$$;

create or replace function holler.chat_summary(p_chat uuid, p_me uuid) returns jsonb
language sql stable security definer set search_path = holler as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'code', c.invite_code, 'theme', c.theme, 'lastPoloAt', c.last_polo_at,
    'muted', (select m.muted from holler.members m where m.chat_id = c.id and m.person_id = p_me),
    'members', (select coalesce(jsonb_agg(holler.person_json(p) order by m.joined_at), '[]')
                  from holler.members m join holler.people p on p.id = m.person_id where m.chat_id = c.id),
    'unread', (select count(*) from holler.polos po where po.chat_id = c.id and po.status = 'ready'
                 and po.author_id <> p_me
                 and not exists (select 1 from holler.views v where v.polo_id = po.id and v.person_id = p_me)),
    'last', (select jsonb_build_object('id', po.id, 'kind', po.kind, 'thumb', po.thumb_path, 'author', po.author_id,
                                       'body', left(po.body, 80), 'at', po.created_at,
                                       'seen', (select coalesce(jsonb_agg(v.person_id order by v.viewed_at), '[]') from holler.views v
                                                 where v.polo_id = po.id and v.person_id <> po.author_id))
               from holler.polos po where po.chat_id = c.id and po.status = 'ready'
              order by po.created_at desc limit 1)
  ) from holler.chats c where c.id = p_chat
$$;

create or replace function holler.polo_json(po holler.polos) returns jsonb
language sql stable security definer set search_path = holler as $$
  select jsonb_build_object(
    'id', po.id, 'chat', po.chat_id, 'author', po.author_id, 'kind', po.kind, 'path', po.path,
    'thumb', po.thumb_path, 'mime', po.mime, 'duration', po.duration, 'w', po.width, 'h', po.height,
    'body', po.body, 'transcript', po.transcript, 'effects', po.effects, 'at', po.created_at,
    'views', (select coalesce(jsonb_agg(jsonb_build_object('who', v.person_id, 'at', v.viewed_at)), '[]')
                from holler.views v where v.polo_id = po.id),
    'reactions', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'who', r.person_id, 'kind', r.kind, 't', r.at_sec) order by r.created_at), '[]')
                    from holler.reactions r where r.polo_id = po.id),
    'savedBy', (select coalesce(jsonb_agg(s.person_id), '[]') from holler.saves s where s.polo_id = po.id)
  )
$$;

-- ---------- the API (public, called with the anon key) ----------
create or replace function public.holler_signup(p_name text, p_color text) returns jsonb
language plpgsql security definer set search_path = holler, extensions, public as $$
declare tok text := encode(extensions.gen_random_bytes(24), 'hex'); p holler.people;
begin
  insert into holler.people (name, color, token_hash)
  values (left(trim(p_name), 40), coalesce(nullif(p_color, ''), '#FF7AA2'), encode(extensions.digest(tok, 'sha256'), 'hex'))
  returning * into p;
  insert into holler.tokens (token_hash, person_id) values (p.token_hash, p.id);
  return jsonb_build_object('token', tok, 'me', holler.person_json(p));
end $$;

create or replace function public.holler_home(p_token text) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); p holler.people;
begin
  select * into p from holler.people where id = me;
  return jsonb_build_object(
    'me', holler.person_json(p) || jsonb_build_object('prefs', p.prefs),
    'chats', (select coalesce(jsonb_agg(holler.chat_summary(c.id, me) order by c.last_polo_at desc), '[]')
                from holler.chats c join holler.members m on m.chat_id = c.id and m.person_id = me),
    'usage', (select jsonb_build_object('bytes', coalesce(sum((o.metadata->>'size')::bigint), 0), 'count', count(*))
                from storage.objects o where o.bucket_id = 'holler')
  );
end $$;

create or replace function public.holler_update_me(p_token text, p_name text, p_color text, p_avatar text, p_prefs jsonb)
returns jsonb language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); p holler.people;
begin
  update holler.people set
    name = coalesce(nullif(left(trim(p_name), 40), ''), name),
    color = coalesce(nullif(p_color, ''), color),
    avatar_path = case when p_avatar = '' then null when p_avatar is null then avatar_path else p_avatar end,
    prefs = case when p_prefs is null then prefs else prefs || p_prefs end
  where id = me returning * into p;
  return holler.person_json(p) || jsonb_build_object('prefs', p.prefs);
end $$;

create or replace function public.holler_create_chat(p_token text, p_name text) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); c holler.chats;
begin
  insert into holler.chats (name, invite_code, created_by) values (left(coalesce(trim(p_name), ''), 60), holler.new_code(), me) returning * into c;
  insert into holler.members (chat_id, person_id) values (c.id, me);
  return holler.chat_summary(c.id, me);
end $$;

create or replace function public.holler_join(p_token text, p_code text) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); c holler.chats; n int;
begin
  select * into c from holler.chats where invite_code = upper(trim(p_code));
  if c.id is null then raise exception 'That code did not match a chat'; end if;
  select count(*) into n from holler.members where chat_id = c.id;
  if n >= 12 and not holler.is_member(c.id, me) then raise exception 'That chat is full'; end if;
  insert into holler.members (chat_id, person_id) values (c.id, me) on conflict do nothing;
  return holler.chat_summary(c.id, me);
end $$;

create or replace function public.holler_chat_update(p_token text, p_chat uuid, p_name text, p_theme text, p_muted boolean)
returns jsonb language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token);
begin
  if not holler.is_member(p_chat, me) then raise exception 'not in this chat'; end if;
  update holler.chats set name = coalesce(left(trim(p_name), 60), name), theme = coalesce(nullif(p_theme, ''), theme) where id = p_chat;
  if p_muted is not null then update holler.members set muted = p_muted where chat_id = p_chat and person_id = me; end if;
  return holler.chat_summary(p_chat, me);
end $$;

create or replace function public.holler_leave(p_token text, p_chat uuid) returns void
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token);
begin
  delete from holler.members where chat_id = p_chat and person_id = me;
end $$;

create or replace function public.holler_chat(p_token text, p_chat uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token);
begin
  if not holler.is_member(p_chat, me) then raise exception 'not in this chat'; end if;
  return holler.chat_summary(p_chat, me) || jsonb_build_object(
    'polos', (select coalesce(jsonb_agg(holler.polo_json(po) order by po.created_at), '[]')
                from holler.polos po where po.chat_id = p_chat and po.status = 'ready'));
end $$;

create or replace function public.holler_saved(p_token text) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token);
begin
  return (select coalesce(jsonb_agg(holler.polo_json(po) order by s.created_at desc), '[]')
            from holler.saves s join holler.polos po on po.id = s.polo_id
           where s.person_id = me and po.status = 'ready' and holler.is_member(po.chat_id, me));
end $$;

create or replace function public.holler_start_polo(p_token text, p_chat uuid, p_kind text, p_ext text, p_mime text, p_body text)
returns jsonb language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); po holler.polos; pid uuid := gen_random_uuid(); ext text := regexp_replace(coalesce(p_ext, 'mp4'), '[^a-z0-9]', '', 'g');
begin
  if not holler.is_member(p_chat, me) then raise exception 'not in this chat'; end if;
  insert into holler.polos (id, chat_id, author_id, kind, path, thumb_path, mime, body, status, ready_at)
  values (pid, p_chat, me, p_kind,
          case when p_kind = 'text' then null else p_chat || '/' || pid || '.' || ext end,
          case when p_kind = 'video' then p_chat || '/' || pid || '.jpg' end,
          p_mime, p_body,
          case when p_kind = 'text' then 'ready' else 'uploading' end,
          case when p_kind = 'text' then now() end)
  returning * into po;
  if p_kind = 'text' then update holler.chats set last_polo_at = now() where id = p_chat; end if;
  return holler.polo_json(po);
end $$;

create or replace function public.holler_finish_polo(p_token text, p_polo uuid, p_duration real, p_w int, p_h int, p_transcript text, p_effects jsonb, p_has_thumb boolean)
returns jsonb language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); po holler.polos; sz bigint;
begin
  -- never publish an empty recording (an iPhone can hand back a 0-byte file from a very short take)
  select coalesce((o.metadata->>'size')::bigint, 0) into sz from storage.objects o
    join holler.polos x on x.path = o.name where x.id = p_polo and o.bucket_id = 'holler';
  if coalesce(sz, 0) < 1000 then raise exception 'That holler came out empty. Please record it again.'; end if;
  update holler.polos set status = 'ready', ready_at = now(), duration = p_duration, width = p_w, height = p_h,
    transcript = nullif(left(p_transcript, 20000), ''), effects = coalesce(p_effects, '{}'),
    thumb_path = case when p_has_thumb then thumb_path end
  where id = p_polo and author_id = me and status = 'uploading' returning * into po;
  if po.id is null then raise exception 'polo not found'; end if;
  update holler.chats set last_polo_at = now() where id = po.chat_id;
  insert into holler.views (polo_id, person_id) values (po.id, me) on conflict do nothing;
  return holler.polo_json(po);
end $$;

create or replace function public.holler_delete_polo(p_token text, p_polo uuid) returns void
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token);
begin
  update holler.polos set status = 'deleted' where id = p_polo and author_id = me;
end $$;

create or replace function public.holler_view(p_token text, p_polo uuid) returns void
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token);
begin
  insert into holler.views (polo_id, person_id)
  select po.id, me from holler.polos po where po.id = p_polo and holler.is_member(po.chat_id, me)
  on conflict do nothing;
end $$;

create or replace function public.holler_react(p_token text, p_polo uuid, p_kind text, p_at real) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); po holler.polos;
begin
  select * into po from holler.polos where id = p_polo;
  if po.id is null or not holler.is_member(po.chat_id, me) then raise exception 'not in this chat'; end if;
  insert into holler.reactions (polo_id, person_id, kind, at_sec) values (p_polo, me, left(p_kind, 20), p_at);
  return holler.polo_json(po);
end $$;

create or replace function public.holler_save(p_token text, p_polo uuid, p_on boolean) returns void
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token);
begin
  if p_on then
    insert into holler.saves (polo_id, person_id)
    select po.id, me from holler.polos po where po.id = p_polo and holler.is_member(po.chat_id, me) on conflict do nothing;
  else
    delete from holler.saves where polo_id = p_polo and person_id = me;
  end if;
end $$;

create or replace function public.holler_push_sub(p_token text, p_sub jsonb, p_on boolean) returns void
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token);
begin
  if p_on then
    insert into holler.push_subs (endpoint, person_id, sub) values (p_sub->>'endpoint', me, p_sub)
    on conflict (endpoint) do update set person_id = me, sub = p_sub;
  else
    delete from holler.push_subs where endpoint = p_sub->>'endpoint';
  end if;
end $$;

-- A token for linking another device: the same person, a fresh token; old ones keep working.
create or replace function public.holler_link_device(p_token text) returns text
language plpgsql security definer set search_path = holler, extensions, public as $$
declare me uuid := holler.who(p_token); tok text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  insert into holler.tokens (token_hash, person_id) values (encode(extensions.digest(tok, 'sha256'), 'hex'), me);
  return tok;
end $$;

-- Storage gate: anon may upload only to a path a live polo or avatar reserved.
create or replace function public.holler_upload_ok(p_name text) returns boolean
language sql stable security definer set search_path = holler as $$
  select exists (select 1 from holler.polos po where po.status = 'uploading' and po.created_at > now() - interval '2 hours'
                   and (po.path = p_name or po.thumb_path = p_name))
      or (p_name ~ '^avatars/[0-9a-f-]{36}/[A-Za-z0-9]{6,40}\.jpg$'
          and exists (select 1 from holler.people pe where pe.id::text = split_part(p_name, '/', 2)))
$$;

create or replace function public.holler_delete_ok(p_name text) returns boolean
language sql stable security definer set search_path = holler as $$
  select exists (select 1 from holler.polos po where po.status = 'deleted' and (po.path = p_name or po.thumb_path = p_name))
$$;

revoke all on function holler.who(text), holler.is_member(uuid, uuid), holler.chat_summary(uuid, uuid), holler.polo_json(holler.polos), holler.new_code() from public, anon, authenticated;
grant execute on function
  public.holler_signup(text, text), public.holler_home(text), public.holler_update_me(text, text, text, text, jsonb),
  public.holler_create_chat(text, text), public.holler_join(text, text), public.holler_chat_update(text, uuid, text, text, boolean),
  public.holler_leave(text, uuid), public.holler_chat(text, uuid), public.holler_saved(text),
  public.holler_start_polo(text, uuid, text, text, text, text), public.holler_finish_polo(text, uuid, real, int, int, text, jsonb, boolean),
  public.holler_delete_polo(text, uuid), public.holler_view(text, uuid), public.holler_react(text, uuid, text, real),
  public.holler_save(text, uuid, boolean), public.holler_push_sub(text, jsonb, boolean), public.holler_link_device(text),
  public.holler_upload_ok(text), public.holler_delete_ok(text)
to anon, authenticated;

-- ---------- storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('holler', 'holler', true, 52428800, array['video/*', 'audio/*', 'image/*'])
on conflict (id) do update set public = true, file_size_limit = 52428800, allowed_mime_types = array['video/*', 'audio/*', 'image/*'];

drop policy if exists holler_insert on storage.objects;
create policy holler_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'holler' and public.holler_upload_ok(name));
drop policy if exists holler_select_deleted on storage.objects;
create policy holler_select_deleted on storage.objects for select to anon, authenticated
  using (bucket_id = 'holler' and public.holler_delete_ok(name));
drop policy if exists holler_delete on storage.objects;
create policy holler_delete on storage.objects for delete to anon, authenticated
  using (bucket_id = 'holler' and public.holler_delete_ok(name));

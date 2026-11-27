-- Profiles (2026-11-27): a few words each person picks, shown to the people they share a chat with,
-- plus a small stats read. The words live in people.prefs (about, into, song); only those keys and
-- the chosen look and voice are ever shown to others, each capped in length here.

create or replace function holler.person_json(p holler.people) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'color', p.color, 'avatar', p.avatar_path, 'lastSeen', p.last_seen,
    'joined', p.created_at,
    'profile', jsonb_strip_nulls(jsonb_build_object(
      'about', nullif(left(p.prefs->>'about', 140), ''),
      'into', nullif(left(p.prefs->>'into', 60), ''),
      'song', nullif(left(p.prefs->>'song', 60), ''),
      'look', nullif(left(p.prefs->>'look', 30), ''),
      'voice', nullif(left(p.prefs->>'voice', 30), ''))))
$$;

-- Stats count only chats the asker is also in.
create or replace function public.holler_profile(p_token text, p_person uuid) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); p holler.people;
begin
  if p_person <> me and not exists (
    select 1 from holler.members a join holler.members b on a.chat_id = b.chat_id where a.person_id = me and b.person_id = p_person
  ) then raise exception 'You are not in a chat with them'; end if;
  select * into p from holler.people where id = p_person;
  if p.id is null then raise exception 'Not found'; end if;
  return holler.person_json(p) || jsonb_build_object('stats', (
    with shared as (select chat_id from holler.members where person_id = me),
    mine as (select po.* from holler.polos po where po.author_id = p.id and po.status = 'ready' and po.chat_id in (select chat_id from shared)),
    gms as (select g.* from holler.games g where g.chat_id in (select chat_id from shared) and g.state->'order' ? p.id::text)
    select jsonb_build_object(
      'hollers', (select count(*) from mine where kind in ('video', 'audio')),
      'notes', (select count(*) from mine where kind = 'text'),
      'minutes', (select coalesce(round((sum(duration) / 60)::numeric, 0), 0) from mine where kind in ('video', 'audio')),
      'seconds', (select coalesce(round(sum(duration)::numeric, 0), 0) from mine where kind in ('video', 'audio')),
      'games', (select count(*) from gms),
      'wins', (select count(*) from gms where state->>'winner' = p.id::text),
      'first', (select min(created_at) from mine))
  ));
end $$;

grant execute on function public.holler_profile(text, uuid) to anon, authenticated;

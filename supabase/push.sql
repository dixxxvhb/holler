-- Holler push: when a polo becomes ready, tell the holler-push edge function to notify the other
-- members who turned notifications on and have not muted the chat. Free: pg_net + one edge function.

create table if not exists holler.config (key text primary key, value text not null);
revoke all on holler.config from anon, authenticated, public;
-- insert the shared secret once (not stored in this file):
--   insert into holler.config values ('push_secret', '<same value as the HOLLER_PUSH_SECRET function secret>')
--   on conflict (key) do update set value = excluded.value;

create or replace function holler.notify_polo() returns trigger
language plpgsql security definer set search_path = holler, extensions, public as $$
declare
  secret text; aname text; cname text; subs jsonb; msg text;
begin
  if new.status <> 'ready' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'ready' then return new; end if;

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

revoke all on function holler.notify_polo() from public, anon, authenticated;

drop trigger if exists polos_notify on holler.polos;
create trigger polos_notify after insert or update of status on holler.polos
  for each row execute function holler.notify_polo();

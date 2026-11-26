-- Short codes to sign another device in as the same person. Needed on iPhone, where the Home Screen
-- app and Safari keep separate storage, and links always open in Safari.
create table if not exists holler.link_codes (
  code text primary key,
  person_id uuid not null references holler.people(id) on delete cascade,
  expires_at timestamptz not null
);
revoke all on holler.link_codes from anon, authenticated, public;

create or replace function public.holler_link_code(p_token text) returns text
language plpgsql security definer set search_path = holler, extensions, public as $$
declare me uuid := holler.who(p_token); c text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  delete from holler.link_codes where expires_at < now() or person_id = me;
  loop
    c := '';
    for i in 1..6 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from holler.link_codes where code = c);
  end loop;
  insert into holler.link_codes (code, person_id, expires_at) values (c, me, now() + interval '30 minutes');
  return c;
end $$;

create or replace function public.holler_redeem_code(p_code text) returns jsonb
language plpgsql security definer set search_path = holler, extensions, public as $$
declare lc holler.link_codes; tok text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  select * into lc from holler.link_codes where code = upper(trim(p_code)) and expires_at > now();
  if lc.code is null then
    perform pg_sleep(1); -- slows guessing; a code is 1 in a billion and lasts 30 minutes
    raise exception 'That code did not work. Codes last 30 minutes.';
  end if;
  delete from holler.link_codes where code = lc.code;
  insert into holler.tokens (token_hash, person_id) values (encode(extensions.digest(tok, 'sha256'), 'hex'), lc.person_id);
  return jsonb_build_object('token', tok);
end $$;

grant execute on function public.holler_link_code(text), public.holler_redeem_code(text) to anon, authenticated;

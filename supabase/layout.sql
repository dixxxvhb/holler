-- Holler layout (2026-11-27): the Play page lists every game you are in, from all your chats, in one read.
-- Same rows, same per-person view (holler.game_json) and same 7-day window as the 'games' list holler_chat already
-- returns for each chat you belong to. Nothing becomes visible to anyone who could not already see it. Read only.
create or replace function public.holler_games(p_token text) returns jsonb
language plpgsql security definer set search_path = holler, public as $$
declare me uuid := holler.who(p_token); gid uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  -- the same catch-up holler_chat does on open: skip anyone who has sat on a turn too long
  for gid in select g.id from holler.games g where g.status = 'playing' and holler.is_member(g.chat_id, me) loop
    perform holler.game_tick(gid);
  end loop;
  return jsonb_build_object('games', (
    select coalesce(jsonb_agg(holler.game_json(g, me) || jsonb_build_object('chat', g.chat_id) order by g.created_at), '[]'::jsonb)
      from holler.games g
     where holler.is_member(g.chat_id, me)
       and (g.status = 'playing' or g.ended_at > now() - interval '7 days')));
end $$;

grant execute on function public.holler_games(text) to anon, authenticated;

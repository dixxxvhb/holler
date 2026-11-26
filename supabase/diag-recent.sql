-- Read-only: the newest hollers and games, to diagnose a send problem. Changes nothing.
select json_build_object(
  'polos', (select json_agg(x) from (select po.created_at, po.status, po.kind, p.name as who, c.name as chat, po.game_id is not null as in_game,
              (select array_agg(k) from jsonb_object_keys(coalesce(po.effects, '{}')) k) as fx, po.effects->'game' as game
            from holler.polos po join holler.people p on p.id = po.author_id join holler.chats c on c.id = po.chat_id
            order by po.created_at desc limit 25) x),
  'games', (select json_agg(y) from (select g.created_at, g.kind, g.status, c.name as chat, g.state - 'order' as st,
              (select json_agg(p.name) from jsonb_array_elements_text(g.state->'order') o join holler.people p on p.id = o::uuid) as players
            from holler.games g join holler.chats c on c.id = g.chat_id order by g.created_at desc limit 5) y)
) report;

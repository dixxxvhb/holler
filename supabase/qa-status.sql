-- Read-only: what's in Holler right now (people, chats, games), to check QA left nothing behind.
select json_build_object(
  'people', (select json_agg(name order by created_at) from holler.people),
  'games', (select coalesce(json_agg(json_build_object('status', g.status, 'created', g.created_at, 'chat', c.name,
              'members', (select json_agg(p.name) from holler.members m join holler.people p on p.id = m.person_id where m.chat_id = g.chat_id))), '[]')
            from holler.games g join holler.chats c on c.id = g.chat_id)
) report;

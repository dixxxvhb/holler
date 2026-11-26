-- Seen receipts on the home screen: who has watched the latest holler in each chat.
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

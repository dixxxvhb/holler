-- Refuse to publish an empty recording.
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

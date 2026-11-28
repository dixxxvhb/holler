-- QA only (scripts/qa-limit.mjs): make the QA chat's leaving hollers due now, then run the limit over the QA chat
-- with no hold, so they are taken out and storage is asked to delete their files. Never looks at any other chat.
update holler.polos set leaves_at = now() - interval '1 minute'
 where leaves_at is not null and status = 'ready' and chat_id in (select holler.limit_chats('qa'));
select holler.limit_run('qa', 5, interval '3 days', interval '0') report;

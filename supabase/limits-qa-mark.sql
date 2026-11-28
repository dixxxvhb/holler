-- QA only (scripts/qa-limit.mjs): run the limit over chats named 'ZZ limit test' whose every member is a QA person,
-- keeping 5 seconds, so the oldest QA hollers are marked as leaving. Never looks at any other chat.
select holler.limit_run('qa', 5, interval '3 days', interval '0') report;

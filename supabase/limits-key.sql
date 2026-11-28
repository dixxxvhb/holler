-- The project's publishable key, so the database can ask storage to delete a removed holler's file (the same call
-- scripts/clean-qa-remote.mjs makes). This key is public by design: it is the one already inside the app that every
-- phone downloads. On its own it lets storage delete only files whose holler is marked deleted (the holler_delete
-- storage policy), which is exactly what the limit needs and nothing more. Safe to run at any time; switches nothing on.
insert into holler.config values ('storage_key', 'sb_publishable_agYvnH3Bs77pPvNwaZLzjg_DjUsbeMW') on conflict (key) do update set value = excluded.value;
select json_build_object('storage_key_set', exists (select 1 from holler.config where key = 'storage_key')) done;

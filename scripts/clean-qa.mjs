// Removes QA people (Avery QA, Blake QA, QA Bot, ZZTest*), their chats, hollers and files.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').trim().split(/\r?\n/).map(l => l.split('=')));
const sql = q => JSON.parse(execFileSync('node', ['scripts/sb.mjs', 'sql', q], { env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).toString().replace(/^\d+ /, ''));
const QA = `(select id from holler.people where name in ('QA Bot','Avery QA','Blake QA') or name like 'ZZTest%')`;
// 1. mark their hollers deleted so the storage delete policy lets the files go
// a QA holler the per-chat limit took out sits in a hold and storage keeps a held file: QA files have no hold (no-op until limits.sql is applied)
sql(`do $$ begin if exists (select 1 from information_schema.columns where table_schema = 'holler' and table_name = 'polos' and column_name = 'purge_after') then execute 'update holler.polos set purge_after = null where purge_after is not null and author_id in ${QA.replace(/'/g, "''")}'; end if; end $$`);
const rows = sql(`with u as (update holler.polos set status = 'deleted' where author_id in ${QA} returning path, thumb_path)
  select coalesce(json_agg(p), '[]') paths from (select path p from u where path is not null union all select thumb_path from u where thumb_path is not null) t`);
const paths = rows[0].paths;
for (let i = 0; i < paths.length; i += 100) {
  const r = await fetch(`${env.VITE_SUPABASE_URL}/storage/v1/object/holler`, { method: 'DELETE', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }) });
  console.log('storage delete', r.status, (await r.json()).length ?? '');
}
// 2. chats with only QA members, then the QA people (cascades members, views, reactions, saves, tokens)
const out = sql(`with c as (delete from holler.chats ch where not exists (select 1 from holler.members m where m.chat_id = ch.id and m.person_id not in ${QA}) returning 1),
  p as (delete from holler.people where id in ${QA} returning 1) select (select count(*) from c) chats, (select count(*) from p) people`);
console.log('removed', JSON.stringify(out[0]), 'files', paths.length);
console.log('left', JSON.stringify(sql(`select (select count(*) from holler.people) people, (select count(*) from holler.chats) chats, (select count(*) from storage.objects where bucket_id='holler') files`)[0]));

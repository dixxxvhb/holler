// PC only. Removes files in the holler bucket that sit in a chat that no longer exists and that nothing points at.
// Nobody can reach those (a chat is only deleted by QA cleanup or when its last member leaves). Files in live chats are
// never touched. Uses the Management API token (scripts/token.ps1) to look them up and to fetch the service key for the
// Storage API; neither is printed. Dry run by default: node scripts/purge-orphans.mjs [--delete]
import { execFileSync } from 'node:child_process';
const REF = 'swjqlfcqvcrnydpyjyog';
const tok = execFileSync('powershell', ['-NoProfile', '-File', new URL('./token.ps1', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')]).toString().trim();
const mgmt = (p, o = {}) => fetch(`https://api.supabase.com/v1/projects/${REF}${p}`, { ...o, headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json', ...(o.headers || {}) } });
const q = await mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query: `
  with refd as (select path n from holler.polos where path is not null union select thumb_path from holler.polos where thumb_path is not null
                union select avatar_path from holler.people where avatar_path is not null)
  select name, coalesce((metadata->>'size')::bigint, 0) sz from storage.objects
   where bucket_id = 'holler' and name not like 'avatars/%' and name not in (select n from refd)
     and split_part(name, '/', 1) not in (select id::text from holler.chats)` }) });
const rows = await q.json();
if (!Array.isArray(rows)) { console.log('lookup failed', q.status); process.exit(1); }
console.log('orphaned files in deleted chats:', rows.length, (rows.reduce((a, r) => a + Number(r.sz), 0) / 1e6).toFixed(1), 'MB');
if (!process.argv.includes('--delete') || !rows.length) process.exit(0);
const keys = await (await mgmt('/api-keys?reveal=true')).json();
const svc = keys.find(k => k.name === 'service_role')?.api_key;
if (!svc) { console.log('no service key'); process.exit(1); }
let gone = 0;
for (let i = 0; i < rows.length; i += 100) {
  const r = await fetch(`https://${REF}.supabase.co/storage/v1/object/holler`, { method: 'DELETE',
    headers: { apikey: svc, Authorization: `Bearer ${svc}`, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: rows.slice(i, i + 100).map(r => r.name) }) });
  const j = await r.json(); gone += Array.isArray(j) ? j.length : 0; console.log('delete', r.status, Array.isArray(j) ? j.length : JSON.stringify(j).slice(0, 200));
}
console.log('removed', gone);

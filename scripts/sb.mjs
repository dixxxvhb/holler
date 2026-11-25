// Supabase Management API helper for figgg's project. Never prints the token.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const REF = 'swjqlfcqvcrnydpyjyog';
const tok = execFileSync('powershell', ['-NoProfile', '-File', new URL('./token.ps1', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')]).toString().trim();
const api = (p, o = {}) => fetch(`https://api.supabase.com/v1/projects/${REF}${p}`, { ...o, headers: { Authorization: `Bearer ${tok}`, ...(o.headers || {}) } });
const [cmd, arg] = process.argv.slice(2);
if (cmd === 'sql') {
  const query = arg.endsWith('.sql') ? readFileSync(arg, 'utf8') : arg;
  const r = await api('/database/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  console.log(r.status, JSON.stringify(await r.json(), null, 1).slice(0, 6000));
} else if (cmd === 'get') {
  const r = await api(arg); console.log(r.status, JSON.stringify(await r.json(), null, 1).slice(0, 6000));
} else if (cmd === 'secrets') {
  const body = JSON.parse(readFileSync(arg, 'utf8'));
  const r = await api('/secrets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  console.log(r.status, await r.text());
} else if (cmd === 'deploy') {
  const slug = arg; const fd = new FormData();
  fd.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: slug, verify_jwt: false }));
  fd.append('file', new Blob([readFileSync(`supabase/functions/${slug}/index.ts`)]), 'index.ts');
  const r = await api(`/functions/deploy?slug=${slug}`, { method: 'POST', body: fd });
  console.log(r.status, (await r.text()).slice(0, 2000));
}

// clean-qa from the Neo (or anywhere with `ssh pc`): the SQL runs on the PC through pc-run's holler-sql step,
// which only runs files pushed to origin/main; the file deletes go straight to storage with the public key.
// Same result as scripts/clean-qa.mjs. Usage: node scripts/clean-qa-remote.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').trim().split(/\r?\n/).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const run = f => {
  const out = execFileSync('ssh', ['pc', `pwsh -NoProfile -File C:/Users/bowle/bin/pc-run.ps1 holler-sql ${f}`]).toString();
  const body = out.slice(out.indexOf('\n', out.indexOf('started')) + 1, out.lastIndexOf('pc-run:')).trim();
  if (!/^20\d /.test(body)) throw new Error(`${f} failed:\n${out}`);
  return JSON.parse(body.replace(/^\d+ /, ''));
};
const paths = run('qa-clean-1.sql')[0].paths;
for (let i = 0; i < paths.length; i += 100) {
  const r = await fetch(`${env.VITE_SUPABASE_URL}/storage/v1/object/holler`, { method: 'DELETE', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }) });
  console.log('storage delete', r.status, (await r.json()).length ?? '');
}
console.log('files', paths.length, 'then', JSON.stringify(run('qa-clean-2.sql')[0]));

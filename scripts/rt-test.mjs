// Two raw realtime clients on one topic: does broadcast + presence flow both ways, and how fast?
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import ws from 'ws';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').trim().split(/\r?\n/).map(l => l.split('=')));
const mk = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { realtime: { transport: ws } });
const topic = 'holler:rt-test-' + Date.now();
const t0 = Date.now(); const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(2), ...a);
const chan = (c, key) => c.channel(topic, { config: { broadcast: { self: false }, presence: { key } } });
const A = chan(mk(), 'A'), B = chan(mk(), 'B');
for (const [n, ch] of [['A', A], ['B', B]]) {
  ch.on('broadcast', { event: 'ev' }, ({ payload }) => log(n, 'got', JSON.stringify(payload)));
  ch.on('presence', { event: 'sync' }, () => log(n, 'presence', JSON.stringify(Object.fromEntries(Object.entries(ch.presenceState()).map(([k, v]) => [k, v.map(x => x.status)])))));
}
await Promise.all([A, B].map(ch => new Promise(r => ch.subscribe(s => { if (s === 'SUBSCRIBED') r(); }))));
log('both subscribed');
await A.track({ status: 'here' }); await B.track({ status: 'here' });
await new Promise(r => setTimeout(r, 1500));
log('A -> recording'); await A.track({ status: 'recording' });
await new Promise(r => setTimeout(r, 1500));
log('A -> here'); await A.track({ status: 'here' });
await A.send({ type: 'broadcast', event: 'ev', payload: { from: 'A' } });
await B.send({ type: 'broadcast', event: 'ev', payload: { from: 'B' } });
await new Promise(r => setTimeout(r, 2500));
process.exit(0);

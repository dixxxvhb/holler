// A long holler (14 MB, three resumable pieces) goes up, the page reloads mid-send, and the send
// must pick up from the server's offset instead of starting over, then land as a ready holler.
// Usage: PW_CHANNEL=chrome node scripts/qa-long-send.mjs [baseUrl]   then: node scripts/clean-qa.mjs
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:5188/';
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const P = await ctx.newPage();
const log = [];
P.on('request', r => { if (/upload\/resumable|object\/holler/.test(r.url())) log.push(`${r.method()} ${r.headers()['upload-offset'] ?? ''} ${r.url().split('/storage/v1/')[1].slice(0, 40)}`); });
P.on('pageerror', e => log.push('pageerror ' + e.message));
let fails = 0; const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };

await P.goto(BASE);
await P.fill('#nm', 'Avery QA');
await P.click("text=Let's go");
await P.waitForSelector('text=Start a chat');
await P.click('button:has-text("Start a chat")');
await P.fill('#cn', 'QA Long');
await P.click('text=Make it');
await P.waitForSelector('.code-big');
await P.click('.sheet-head .icon-btn');
const chat = await P.evaluate(() => location.hash.split('/')[2]);
ok(!!chat, 'in a chat ' + chat);

// hand the outbox a 14 MB "video" (stands in for a ~2.5 minute iPhone take)
const start = () => P.evaluate(async chat => {
  const ob = await import('/src/lib/outbox.ts'); const api = await import('/src/lib/api.ts');
  const me = (await api.api.home()).me.id;
  const big = new Uint8Array(14 * 1024 * 1024 + 4321); for (let i = 0; i < big.length; i += 4096) big[i] = i % 251;
  const thumb = new Blob([new Uint8Array(3000)], { type: 'image/jpeg' });
  ob.sendRecording(chat, me, { blob: new Blob([big], { type: 'video/mp4' }), mime: 'video/mp4', ext: 'mp4', duration: 150, w: 720, h: 1280, thumb, kind: 'video', effects: {} }, null);
}, chat);
// slow the line so a reload can land mid-send
await P.route('**/upload/resumable/**', async r => { if (r.request().method() === 'PATCH') await new Promise(x => setTimeout(x, 1500)); await r.continue().catch(() => {}); });
await start();
await P.waitForSelector('.net-off.sending', { timeout: 15000 }).then(() => ok(true, 'keep-open line shows'), () => ok(false, 'keep-open line shows'));
await P.screenshot({ path: 'shots/long-send-1.png' });
// wait for the first piece to land, then reload
for (let i = 0; i < 60 && !log.some(l => l.startsWith('PATCH 6291456')); i++) await P.waitForTimeout(500);
ok(log.some(l => l.startsWith('PATCH 6291456')), 'second piece started before reload');
const before = log.length;
await P.reload();
await P.unroute('**/upload/resumable/**');
// after reload the outbox resumes from IndexedDB
for (let i = 0; i < 120; i++) {
  const st = await P.evaluate(() => [...document.querySelectorAll('.tile.mine.pending')].length);
  if (i > 6 && !st && log.slice(before).some(l => l.startsWith('PATCH 12582912'))) break;
  await P.waitForTimeout(500);
}
const after = log.slice(before);
ok(after.some(l => l.startsWith('HEAD')), 'asked the server how far it got');
ok(!after.some(l => l.startsWith('PATCH 0 ')), 'did not start over from zero');
ok(!after.some(l => l.startsWith('POST') && l.includes('upload/resumable')), 'reused the same upload');
await P.waitForTimeout(5000);
const ready = await P.evaluate(async chat => { const api = await import('/src/lib/api.ts'); const c = await api.api.chat(chat); return (c.polos || []).filter(p => p.kind === 'video').map(p => ({ id: p.id, path: p.path })); }, chat);
ok(ready.length === 1, 'one ready video in the chat: ' + JSON.stringify(ready));
console.log(log.join('\n'));
await P.screenshot({ path: 'shots/long-send-2.png' });
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);

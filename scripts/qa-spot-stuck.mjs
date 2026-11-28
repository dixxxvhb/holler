// 11-27: On The Spot stuck on "recording" on Dixon's iPhone and never sent. Likely chain: two quick taps on an
// answer counted as a double tap on the picture, flipped the camera mid-take, and the iPhone recorder stopped
// itself; finish() then saw "not recording" and returned, leaving the screen stuck. This plays that out:
// a double tap on an answer must not flip the camera, and a recorder that dies mid-take must still send.
// Usage: PW_CHANNEL=chrome node scripts/qa-spot-stuck.mjs [baseUrl] ; then clean the QA people
import { chromium } from 'playwright';
// the room opens on its thread (11-27): the camera opens from the live tile. camFirst opens it before a step
// that uses the camera's own controls (the record button, the rail); it does nothing when the camera is already open.
const camFirst = async p => { if (await p.locator('.chat.in-thread .rec.live-tile').count()) { await p.locator('.rec.live-tile').click(); await p.waitForSelector('.chat.cam-open'); } };
import { mkdirSync, readFileSync } from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:5188/';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').trim().split(/\r?\n/).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const rpc = async (fn, body) => {
  const r = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(fn + ' ' + JSON.stringify(j)); return j;
};
mkdirSync('shots/spot-stuck', { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(ok ? 'PASS' : 'FAIL', name, extra); };
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const mk = async () => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(() => {
    window.__gum = 0;
    const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = c => { window.__gum++; return g(c); };
    const st = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (...a) { window.__rec = this; return st.apply(this, a); };
  });
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('pageerror', e.message)); return p;
};
const A = await mk(), B = await mk();
await A.goto(BASE); await A.fill('#nm', 'Avery QA'); await A.click("text=Let's go");
await A.click('button:has-text("Start a chat")'); await A.fill('#cn', 'QA Spot'); await A.click('text=Make it');
await A.waitForSelector('.code-big'); const code = (await A.textContent('.code-big')).trim(); await A.click('.sheet-head .icon-btn');
await B.goto(BASE + '#/join/' + code); await B.fill('#nm', 'Blake QA'); await B.click('text=Join the chat'); await B.waitForSelector('.chat-top', { timeout: 15000 });
await A.waitForTimeout(2500);
const tA = await A.evaluate(() => localStorage.getItem('holler.token'));
const home = await rpc('holler_home', { p_token: tA }); const chat = home.chats[0].id; const idA = home.me.id;

await A.click('.g-play-tile'); await A.waitForSelector('.g-opt'); await A.waitForTimeout(450);
await A.click('.g-opt:has-text("On The Spot")'); await A.waitForTimeout(400); await A.click('.btn.g-go:has-text("Start")');
await A.waitForSelector('.g-banner:has-text("Three questions")');
await camFirst(A); await A.click('.rec'); await A.waitForSelector('.spot-opt', { timeout: 15000 }); await A.waitForTimeout(800);
const gum0 = await A.evaluate(() => window.__gum);
// a quick double tap on an answer (what a thumb does when the first tap feels slow)
await A.locator('.spot-opt').nth(0).dblclick(); await A.waitForTimeout(1600);
check('double tap on an answer does not flip the camera', (await A.evaluate(() => window.__gum)) === gum0, `gum ${gum0} -> ${await A.evaluate(() => window.__gum)}`);
// the phone ends the recorder by itself mid-take
await A.evaluate(() => window.__rec.stop()); await A.waitForTimeout(400);
for (let k = 1; k < 3; k++) { await A.waitForSelector('.spot-opt:not([disabled])', { timeout: 15000 }); await A.locator('.spot-opt').nth(k).click(); await A.waitForTimeout(1100); }
await A.waitForTimeout(1500);
check('screen is not stuck on recording', !(await A.evaluate(() => !!document.querySelector('.chat.is-rec'))));
await A.screenshot({ path: 'shots/spot-stuck/01-after-dead-recorder.png' });
await A.waitForTimeout(6500);
const c = await rpc('holler_chat', { p_token: tA, p_chat: chat });
const g = c.games.find(x => x.kind === 'spot');
// game clips stay out of the chat list, so the proof is the game: the go only counts once its clip is in
check('the clip landed and the game counted the go', g && !(g.todo || []).includes(idA), JSON.stringify(g?.todo));
const failed = results.filter(r => !r).length;
console.log(`${results.length - failed}/${results.length} passed`);
await b.close(); process.exit(failed ? 1 : 0);

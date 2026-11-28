// Repro: start Charades Relay, draw on the picture, act (auto-sends at 10 s), then try a regular holler and a text.
// Logs every holler RPC so we can see what reaches the server. Then ALWAYS: node scripts/clean-qa-remote.mjs
// Usage: PW_CHANNEL=chrome node scripts/qa-after-act.mjs [baseUrl]
import { chromium, webkit } from 'playwright';
// the room opens on its thread (11-27): the camera opens from the live tile. camFirst opens it before a step
// that uses the camera's own controls (the record button, the rail); it does nothing when the camera is already open.
const camFirst = async p => { if (await p.locator('.chat.in-thread .rec.live-tile').count()) { await p.locator('.rec.live-tile').click(); await p.waitForSelector('.chat.cam-open'); } };
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:5188/';
const OUT = 'shots/after-act'; mkdirSync(OUT, { recursive: true });
const b = process.env.PW_WEBKIT ? await webkit.launch() : await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...(process.env.PW_WEBKIT ? {} : { permissions: ['camera', 'microphone'] }), hasTouch: true };
const [A, B] = await Promise.all([0, 1].map(async () => (await b.newContext(phone)).newPage()));
const rpcs = [];
A.on('request', r => { const m = r.url().match(/rpc\/(holler_\w+)/); if (m) rpcs.push(m[1]); });
A.on('pageerror', e => console.log('A pageerror', e.message));
A.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('A console', m.type(), m.text().slice(0, 300)); });
const checks = []; const check = (ok, w) => { checks.push(ok); console.log(ok ? '  ok ' : '  FAIL', w); };
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
try {
  await A.goto(BASE); await A.fill('#nm', 'ZZTestAvery'); await A.click('text=Let\'s go'); await A.waitForSelector('text=Start a chat');
  await A.click('button:has-text("Start a chat")'); await A.fill('#cn', 'ZZTest AfterAct'); await A.click('text=Make it');
  await A.waitForSelector('.code-big'); const code = (await A.textContent('.code-big')).trim(); await A.click('.sheet-head .icon-btn');
  await B.goto(BASE + '#/join/' + code); await B.fill('#nm', 'ZZTestBlake'); await B.click('text=Join the chat'); await B.waitForSelector('.chat-top', { timeout: 15000 });
  await A.waitForTimeout(2500);
  await A.click('.g-play-tile'); await A.click('.g-opt:has-text("Charades Relay")');
  await A.click('.g-seg button:has-text("10 sec")'); await A.waitForTimeout(400);
  await A.click('.btn.g-go:has-text("Start")'); await A.waitForSelector('.g-banner'); await A.waitForTimeout(800);
  // draw on it
  await camFirst(A); await A.click('.rail-btn:has-text("Draw")');
  const box = await A.locator('.preview').boundingBox();
  await A.mouse.move(box.x + 100, box.y + 300); await A.mouse.down(); await A.mouse.move(box.x + 250, box.y + 380, { steps: 8 }); await A.mouse.up();
  await shot(A, '01-drawn');
  await A.click('.chip.done:has-text("Done")'); await A.waitForTimeout(300);
  await camFirst(A); await A.click('.rec');
  if (process.env.TAP_AT_END) {
    // tap the button again right as the act sends itself, like a person tapping 'done' at the end of the ring
    await A.waitForFunction(() => /0:(09|10)/.test(document.querySelector('.timer')?.textContent || ''), null, { timeout: 15000, polling: 20 });
    await A.waitForFunction(() => /0:10/.test(document.querySelector('.timer')?.textContent || '') || !document.querySelector('.timer'), null, { timeout: 5000, polling: 5 });
    await A.locator('.rec').dispatchEvent('pointerdown', { button: 0, pointerId: 1, isPrimary: true }); await A.locator('.rec').dispatchEvent('pointerup', { button: 0, pointerId: 1, isPrimary: true });
  }
  await A.waitForTimeout(13000); await shot(A, '02-after-act');
  { const t1 = await A.locator('.timer').textContent().catch(() => null); await A.waitForTimeout(2100); const t2 = await A.locator('.timer').textContent().catch(() => null);
    check(!t1 || t1 !== t2, `no frozen phantom recording after the act (${t1} -> ${t2})`);
    if (t2) { await camFirst(A); await A.click('.rec'); await A.waitForTimeout(6000); } }
  console.log('state after act:', await A.evaluate(() => ({ timer: document.querySelector('.timer')?.textContent || null, rec: document.querySelector('.rec')?.className })));
  check(!(await A.locator('.g-banner').count()), 'turn banner gone after the act');
  const before = rpcs.length;
  // regular holler
  await camFirst(A); await A.click('.rec'); await A.waitForTimeout(2600); await camFirst(A); await A.click('.rec'); await A.waitForTimeout(7000); await shot(A, '03-after-holler');
  console.log('rpcs after holler', rpcs.slice(before));
  check(rpcs.slice(before).includes('holler_finish_polo'), 'regular holler finished on the server');
  // text
  const b2 = rpcs.length;
  await A.click('button[aria-label="Send a text"]'); await A.fill('textarea.field', 'hi after act'); await A.click('.btn.primary.wide:has-text("Send")'); await A.waitForTimeout(2500);
  await shot(A, '04-after-text');
  console.log('rpcs after text', rpcs.slice(b2));
  check(rpcs.slice(b2).includes('holler_start_polo'), 'text reached the server');
} catch (e) { console.log('ERROR', e.message); await shot(A, 'zz-error'); checks.push(false); }
console.log(checks.filter(Boolean).length + '/' + checks.length);
await b.close();

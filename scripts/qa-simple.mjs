import { chromium } from 'playwright';
// the room opens on its thread (11-27): the camera opens from the live tile. camFirst opens it before a step
// that uses the camera's own controls (the record button, the rail); it does nothing when the camera is already open.
const camFirst = async p => { if (await p.locator('.chat.in-thread .rec.live-tile').count()) { await p.locator('.rec.live-tile').click(); await p.waitForSelector('.chat.cam-open'); }
  await p.waitForSelector('.chat.cam-live', { timeout: 15000 }).catch(() => {}); };   // round two: the camera sleeps until it opens, so wait for it to be on
const BASE = process.argv[2] || 'http://localhost:5188/';
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
// one browser plays every person here and they share one fake camera, which sends no frames to anyone while another
// person's sleeping camera still holds it: each page lets go of the camera fast (a test hook; phones wait 90 s)
{ const nc = b.newContext.bind(b); b.newContext = async (...a) => { const c = await nc(...a); await c.addInitScript(() => { try { localStorage.setItem('holler.releaseMs', '300'); } catch { /* */ } }); return c; }; }
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'] })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE); await p.fill('#nm', 'Avery QA'); await p.click("text=Let's go");
await p.click('button:has-text("Start a chat")'); await p.click('text=Make it');
await p.waitForSelector('.code-big'); await p.click('.sheet-head .icon-btn');
const chatHash = await p.evaluate(() => location.hash);
await p.goto(BASE + '#/settings'); await p.waitForSelector('text=Simple camera');
await p.click('label.toggle:has-text("Simple camera")');
await p.click('label.toggle:has-text("Look before sending")');
await p.waitForTimeout(1200);
await p.goto(BASE + chatHash); await p.waitForTimeout(2500);
await camFirst(p); await p.waitForTimeout(800);
const raw = await p.locator('video.raw-video').count();
const looks = await p.locator('.rail-btn:has-text("Looks")').count();
await camFirst(p); await p.click('.rec'); await p.waitForTimeout(2000); await camFirst(p); await p.click('.rec');
await p.waitForSelector('.review', { timeout: 8000 });
await p.waitForTimeout(800);
await p.screenshot({ path: 'shots/20-review.png' });
await p.click('.review-bar .btn.primary');
await p.waitForSelector('.tile:not(.pending)', { timeout: 30000 });
await p.screenshot({ path: 'shots/21-simple-sent.png' });
// link a second device with the 6-letter code
await p.goto(BASE + '#/settings'); await p.click('text=Use on another device');
await p.waitForSelector('.sheet .code-big'); const lcode = (await p.textContent('.sheet .code-big')).trim();
const p2 = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
p2.on('pageerror', e => errs.push('p2 ' + e.message));
await p2.goto(BASE); await p2.click('text=I already have Holler');
await p2.fill('#lc', lcode); await p2.click("text=That's me");
await p2.waitForSelector('.chat-card', { timeout: 15000 });
await p2.screenshot({ path: 'shots/22-linked-device.png' });
const chats = await p2.locator('.chat-card').count();
await p2.click('button.tab[data-tab="you"]'); await p2.waitForSelector('input[aria-label="Your name"]');   // who is signed in: You shows the name
const linked = { code: lcode, chats, me: await p2.inputValue('input[aria-label="Your name"]') };
console.log(JSON.stringify({ raw, looksHidden: looks === 0, linked, errs }));
await b.close();

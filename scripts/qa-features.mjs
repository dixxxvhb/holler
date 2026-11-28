// Hold to record, pause/resume, timer, ring light, watching banner, unread title, player swipes.
// Usage: node scripts/qa-features.mjs [baseUrl]
import { chromium } from 'playwright';
// the room opens on its thread (11-27): the camera opens from the live tile. camFirst opens it before a step
// that uses the camera's own controls (the record button, the rail); it does nothing when the camera is already open.
const camFirst = async p => { if (await p.locator('.chat.in-thread .rec.live-tile').count()) { await p.locator('.rec.live-tile').click(); await p.waitForSelector('.chat.cam-open'); }
  await p.waitForSelector('.chat.cam-live', { timeout: 15000 }).catch(() => {}); };   // round two: the camera sleeps until it opens, so wait for it to be on
const openMore = async p => { await camFirst(p); if (!(await p.locator('.rail-btn[aria-expanded="true"]').count())) await p.click('.rail-btn[aria-label="More tools"]'); };
const BASE = process.argv[2] || 'http://localhost:5188/';
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
// one browser plays every person here and they share one fake camera, which sends no frames to anyone while another
// person's sleeping camera still holds it: each page lets go of the camera fast (a test hook; phones wait 90 s)
{ const nc = b.newContext.bind(b); b.newContext = async (...a) => { const c = await nc(...a); await c.addInitScript(() => { try { localStorage.setItem('holler.releaseMs', '300'); } catch { /* */ } }); return c; }; }
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'] };
const A = await (await b.newContext(phone)).newPage();
const B = await (await b.newContext(phone)).newPage();
const errs = [];
for (const [n, p] of [['A', A], ['B', B]]) p.on('pageerror', e => errs.push(`${n}: ${e.message}`));
const out = {};
const tiles = p => p.locator('.thread .tile:not(.pending)').count();
const waitTiles = async (p, n) => { for (let i = 0; i < 60; i++) { if (await tiles(p) >= n) return true; await p.waitForTimeout(500); } return false; };
const rec = async p => (await A.locator('.rec').boundingBox());

await A.goto(BASE); await A.fill('#nm', 'Avery QA'); await A.click("text=Let's go");
await A.click('button:has-text("Start a chat")'); await A.fill('#cn', 'QA Crew'); await A.click('text=Make it');
await A.waitForSelector('.code-big'); const code = (await A.textContent('.code-big')).trim(); await A.click('.sheet-head .icon-btn');
await B.goto(BASE + '#/join/' + code); await B.fill('#nm', 'Blake QA'); await B.click('text=Join the chat');
await B.waitForSelector('.chat-top', { timeout: 15000 });
await B.click('.chat-top .icon-btn'); await B.waitForSelector('.chat-card');
await A.waitForTimeout(2500);

// 1. hold to record: press 2.5 s, let go, it sends (the round button, in the camera)
await camFirst(A); await A.waitForTimeout(500);
let r = await rec(A);
await A.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await A.mouse.down();
await A.waitForTimeout(1700); out.holdHint = await A.textContent('.rec-hint').catch(() => null);
await A.waitForTimeout(800); await A.mouse.up();
out.holdSent = await waitTiles(A, 1);

// 2. tap, pause 2.5 s in the middle, resume, tap to send: duration should be about 2 s, not 4.5
await A.waitForTimeout(4000);
await camFirst(A); await A.click('.rec'); await A.waitForTimeout(1000);
await camFirst(A); await A.click('.rail-btn:has-text("Pause")'); await A.waitForTimeout(400);
out.pausedTag = await A.locator('.paused-tag').count();
await A.screenshot({ path: 'shots/40-paused.png' });
await A.waitForTimeout(2100);
await camFirst(A); await A.click('.rail-btn:has-text("Resume")'); await A.waitForTimeout(1000);
await camFirst(A); await A.click('.rec');
out.pauseSent = await waitTiles(A, 2);
out.pauseDur = await A.locator('.thread .tile:not(.pending) .tile-dur').nth(1).textContent().catch(() => null);

// 3. timer: 3 s count, then it records on its own
await A.waitForTimeout(4000);
await openMore(A); await camFirst(A); await A.click('.rail-btn:has-text("Timer")'); await A.waitForTimeout(300);
await camFirst(A); await A.click('.rec'); await A.waitForTimeout(400);
out.countdownShown = await A.locator('.countdown').textContent().catch(() => null);
await A.screenshot({ path: 'shots/41-countdown.png' });
await A.waitForTimeout(3600);
out.recordingAfterTimer = await A.locator('.rec.on').count();
await A.waitForTimeout(1200); await camFirst(A); await A.click('.rec');
out.timerSent = await waitTiles(A, 3);
await openMore(A); await camFirst(A); await A.click('.rail-btn:has-text("3s")'); await camFirst(A); await A.click('.rail-btn:has-text("10s")'); // back to off

// 4. ring light
await openMore(A); await camFirst(A); await A.click('.rail-btn:has-text("Light")'); await A.waitForTimeout(300);
out.ringLight = await A.locator('.ring-light').count();
await A.screenshot({ path: 'shots/42-light.png' });
await A.click('.side-btn[aria-label="Back to the chat"]'); await A.waitForTimeout(400);   // the who-is-here line lives in the thread

// 5. B's home: unread in the title
await B.waitForTimeout(2500);
out.bTitle = await B.title();
// 6. B watches; A sees "is watching"
await B.click('.chat-card'); await B.waitForTimeout(1500);
await B.click('.new-pill', { force: true }); await B.waitForTimeout(1800);
out.aWatchBanner = await A.locator('.rec-banner.watch').textContent().catch(() => null);
await A.screenshot({ path: 'shots/43-watching.png' });
// 7. swipes: left to the next one, down to close
const idx = () => B.evaluate(() => [...document.querySelectorAll('.bars i b')].findIndex(e => e.style.width !== '100%'));
const before = await idx();
await B.mouse.move(320, 400); await B.mouse.down(); await B.mouse.move(200, 405, { steps: 6 }); await B.mouse.move(80, 410, { steps: 6 }); await B.mouse.up();
await B.waitForTimeout(800);
out.swipeLeft = [before, await idx()];
await B.mouse.move(200, 300); await B.mouse.down(); await B.mouse.move(205, 420, { steps: 8 }); await B.mouse.move(210, 560, { steps: 8 }); await B.mouse.up();
await B.waitForTimeout(600);
out.swipeDownClosed = (await B.locator('.player').count()) === 0;
await B.click('.chat-top .icon-btn'); await B.waitForTimeout(2000);
out.bTitleAfter = await B.title();
out.errs = errs;
console.log(JSON.stringify(out, null, 1));
await b.close();

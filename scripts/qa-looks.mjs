// Every look renders (no shader failure), a contact sheet of them, and mid-recording changes:
// swipe through looks, switch voice, draw, then send and play it back.
// Usage: node scripts/qa-looks.mjs [baseUrl] [fakeVideo.y4m]
import { chromium } from 'playwright';
// the room opens on its thread (11-27): the camera opens from the live tile. camFirst opens it before a step
// that uses the camera's own controls (the record button, the rail); it does nothing when the camera is already open.
const camFirst = async p => { if (await p.locator('.chat.in-thread .rec.live-tile').count()) { await p.locator('.rec.live-tile').click(); await p.waitForSelector('.chat.cam-open'); } };
const BASE = process.argv[2] || 'http://localhost:5188/';
const Y4M = process.argv[3];
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', ...(Y4M ? [`--use-file-for-fake-video-capture=${Y4M}`] : [])] });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, permissions: ['camera', 'microphone'] })).newPage();
const errs = [], warns = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { const t = m.text(); if (/webgl off|shader|cutout off|voice off/i.test(t)) warns.push(t.slice(0, 300)); });
await p.goto(BASE); await p.fill('#nm', 'Avery QA'); await p.click("text=Let's go");
await p.click('button:has-text("Start a chat")'); await p.click('text=Make it');
await p.waitForSelector('.code-big'); await p.click('.sheet-head .icon-btn');
await p.waitForTimeout(2500);
await camFirst(p); await p.click('.rail-btn:has-text("Looks")');
const kinds = await p.locator('.ktab').allTextContents();
const done = [];
for (const k of (process.env.SKIP ? [] : kinds)) {
  await p.click(`.ktab:has-text("${k}")`);
  const chips = await p.locator('.looks-panel .chips .chip').allTextContents();
  for (const c of chips) {
    await p.click(`.looks-panel .chips .chip:text-is("${c}")`);
    await p.waitForTimeout(k === 'Background' ? (done.some(d => d.k === 'Background') ? 900 : 9000) : 650);
    const file = `shots/looks/${String(done.length).padStart(2, '0')}.png`;
    await p.locator('canvas.cam').screenshot({ path: file });
    done.push({ k, c, file });
  }
}
const cutTag = await p.locator('.cut-tag').count();
// mid-recording: start, swipe twice, change voice, draw a line, send
await p.click('.ktab:has-text("Color")'); await p.click('.looks-panel .chips .chip:text-is("Natural")');
await camFirst(p); await p.click('.rail-btn:has-text("Looks")');
await camFirst(p); await p.click('.rec'); await p.waitForTimeout(900);
const sw = async dir => { await p.mouse.move(dir < 0 ? 300 : 90, 420); await p.mouse.down(); await p.mouse.move(dir < 0 ? 90 : 300, 425, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(700); };
await sw(-1); const flash1 = await p.locator('.look-flash').textContent().catch(() => null);
await sw(-1); await sw(-1);
await camFirst(p); await p.click('.rail-btn:has-text("Voice")'); await p.click('.chip:has-text("Chipmunk")'); await p.waitForTimeout(700);
await camFirst(p); await p.click('.rail-btn:has-text("Draw")');
await p.mouse.move(120, 300); await p.mouse.down(); await p.mouse.move(260, 360, { steps: 8 }); await p.mouse.up();
await camFirst(p); await p.click('.rail-btn:has-text("Looks")'); await p.click('.ktab:has-text("Warp")'); await p.click('.looks-panel .chips .chip:text-is("Big head")');
await p.mouse.move(200, 300); await p.mouse.down(); await p.mouse.move(150, 250, { steps: 5 }); await p.mouse.up(); // drag the bulge
await p.waitForTimeout(800);
const midShot = 'shots/looks/mid.png'; await p.screenshot({ path: midShot });
await camFirst(p); await p.click('.rec');
// (sending folds the camera back into the thread and closes the Looks panel, so there is no panel to close here)
let sent = false; for (let i = 0; i < 60 && !sent; i++) { sent = (await p.locator('.thread .tile:not(.pending)').count()) > 0; if (!sent) await p.waitForTimeout(500); }
await p.click('.thread .tile:not(.pending)'); await p.waitForTimeout(2500);
const play = await p.evaluate(() => { const v = document.querySelector('.p-video'); return v ? { d: v.duration, w: v.videoWidth, t: v.currentTime, tile: document.querySelector('.tile-dur')?.textContent } : null; });
console.log(JSON.stringify({ looks: done.length, kinds, cutTagWhileLoading: cutTag, flash1, sent, play, warns, errs }, null, 1));
console.log('SHEET ' + JSON.stringify(done));
await b.close();

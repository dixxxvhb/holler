// Flip mid-recording + camera asked only once across chat hops. Pass "ios" to fake an iPhone Home Screen app.
import { chromium } from 'playwright';
// the room opens on its thread (11-27): the camera opens from the live tile. camFirst opens it before a step
// that uses the camera's own controls (the record button, the rail); it does nothing when the camera is already open.
const camFirst = async p => { if (await p.locator('.chat.in-thread .rec.live-tile').count()) { await p.locator('.rec.live-tile').click(); await p.waitForSelector('.chat.cam-open'); }
  await p.waitForSelector('.chat.cam-live', { timeout: 15000 }).catch(() => {}); };   // round two: the camera sleeps until it opens, so wait for it to be on
const BASE = process.argv[2] || 'http://localhost:5188/';
const IOS = process.argv[3] === 'ios';
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
// one browser plays every person here and they share one fake camera, which sends no frames to anyone while another
// person's sleeping camera still holds it: each page lets go of the camera fast (a test hook; phones wait 90 s)
{ const nc = b.newContext.bind(b); b.newContext = async (...a) => { const c = await nc(...a); await c.addInitScript(() => { try { localStorage.setItem('holler.releaseMs', '300'); } catch { /* */ } }); return c; }; }
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'],
  ...(IOS ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' } : {}) });
await ctx.addInitScript(([ios]) => {
  window.__gum = [];
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = c => { window.__gum.push({ v: !!c.video, a: !!c.audio, f: c.video?.facingMode }); return orig(c); };
  if (ios) Object.defineProperty(navigator, 'standalone', { get: () => true });
  window.__hash = [];
  addEventListener('hashchange', () => window.__hash.push(location.hash));
}, [IOS]);
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE); await p.fill('#nm', 'Avery QA'); await p.click("text=Let's go");
await p.click('button:has-text("Start a chat")'); await p.click('text=Make it');
await p.waitForSelector('.code-big'); await p.click('.sheet-head .icon-btn');
await p.waitForTimeout(2500);
// hop out and back twice
for (let i = 0; i < 2; i++) {
  await p.click('.chat-top .icon-btn'); await p.waitForSelector('.chat-card');
  await p.click('.chat-card'); await p.waitForTimeout(1500);
}
// flip before recording, then twice during
await camFirst(p); await p.click('.rail-btn:has-text("Flip")'); await p.waitForTimeout(800);
await camFirst(p); await p.click('.rec'); await p.waitForTimeout(1500);
const flipDuring = await p.locator('.rail-btn:has-text("Flip")').count();
await camFirst(p); await p.click('.rail-btn:has-text("Flip")'); await p.waitForTimeout(1200);
// double-tap the picture
const box = await p.locator('.preview').boundingBox();
await p.mouse.click(box.x + box.width / 2, box.y + 300); await p.mouse.click(box.x + box.width / 2, box.y + 300);
await p.waitForTimeout(1500);
await camFirst(p); await p.click('.rec');
await p.waitForSelector('.tile:not(.pending) img', { timeout: 30000 });
await p.waitForTimeout(500);
// play it back and check it decodes with real pixels and full length
await p.click('.tile:not(.pending)'); await p.waitForTimeout(2500);
const play = await p.evaluate(() => { const v = document.querySelector('.player video, video.p-video'); return v ? { d: v.duration, w: v.videoWidth, t: v.currentTime } : null; });
await p.screenshot({ path: 'shots/30-after-flip.png' });
const out = await p.evaluate(() => ({ gum: window.__gum, hash: window.__hash, url: location.href }));
console.log(JSON.stringify({ ios: IOS, flipDuring, play, ...out, errs }, null, 1));
await b.close();

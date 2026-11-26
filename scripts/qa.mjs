// Two fake people, fake cameras, one full loop: sign up, make a chat, join by code, record with a
// look + text + voice filter, the other sees it arrive, watches, reacts; a text note; saved.
// Usage: node scripts/qa.mjs [baseUrl]
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:5188/';
const OUT = 'shots';
const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false, permissions: ['camera', 'microphone'] };
const A = await (await b.newContext(phone)).newPage();
const B = await (await b.newContext(phone)).newPage();
const errs = [];
for (const [n, p] of [['A', A], ['B', B]]) {
  await p.addInitScript(() => localStorage.setItem('holler.debug', '1'));
  p.on('console', m => { if (m.text().startsWith('[live]')) console.log(n, m.text()); });
  p.on('pageerror', e => errs.push(`${n} pageerror: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error') errs.push(`${n} console: ${m.text()}`); });
}
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });
const step = s => console.log('--', s);

step('A signs up');
await A.goto(BASE);
await A.fill('#nm', 'Avery QA');
await shot(A, '01-onboard');
await A.click('text=Let\'s go');
await A.waitForSelector('text=Start a chat');
await shot(A, '02-home-empty');

step('A makes a chat');
await A.click('button:has-text("Start a chat")');
await A.fill('#cn', 'QA Crew');
await A.click('text=Make it');
await A.waitForSelector('.code-big');
const code = (await A.textContent('.code-big')).trim();
await shot(A, '03-invite');
console.log('code', code);
await A.click('.sheet-head .icon-btn');

step('B joins by link');
await B.goto(BASE + '#/join/' + code);
await B.fill('#nm', 'Blake QA');
await B.click('text=Join the chat');
await B.waitForSelector('.chat-top', { timeout: 15000 });
await B.waitForTimeout(1500);
await shot(B, '04-B-in-chat');

step('A records with a look, text and voice');
await A.waitForTimeout(1500);
await A.click('.rail-btn:has-text("Looks")');
await A.click('.chip:has-text("Film")');
await shot(A, '05-looks');
await A.click('.rail-btn:has-text("Voice")');
await A.click('.chip:has-text("Chipmunk")');
await A.click('.rail-btn:has-text("Text")');
await A.fill('.tools .field', 'Hello from the QA bot');
await A.click('.chip.on:has-text("Done")');
await A.click('.rail-btn:has-text("Draw")');
const box = await A.locator('.preview').boundingBox();
await A.mouse.move(box.x + 100, box.y + 300); await A.mouse.down();
for (let i = 0; i < 12; i++) await A.mouse.move(box.x + 100 + i * 15, box.y + 300 + Math.sin(i) * 40);
await A.mouse.up();
await A.click('.chip.on:has-text("Done")');
await A.click('.rec');
await A.waitForTimeout(2200);
const bRec = await B.locator('.rec-banner').count();
await shot(A, '06-A-recording');
await shot(B, '07-B-sees-recording');
await A.waitForTimeout(1200);
await A.click('.rec');
await A.waitForTimeout(400);
await shot(A, '08-A-sending');
await A.waitForSelector('.tile:not(.pending)', { timeout: 30000 });
await shot(A, '09-A-sent');

step('B gets it and watches');
await B.waitForSelector('.new-pill', { timeout: 15000 });
await shot(B, '10-B-new');
await B.click('.new-pill', { force: true });
await B.waitForSelector('.player');
await B.waitForTimeout(1500);
const vid = await B.evaluate(() => { const v = document.querySelector('.p-video'); return v ? { ready: v.readyState, w: v.videoWidth, h: v.videoHeight, t: v.currentTime, err: v.error?.code } : null; });
console.log('B video', JSON.stringify(vid));
await B.click('.reacts button[aria-label="Love"]');
await B.waitForTimeout(300);
await shot(B, '11-B-watching');
await B.click('.pill-btn:has-text("Save")');
await B.click('.pill-btn:has-text("1x")');
await B.waitForTimeout(500);
await B.click('.pill-btn.reply');

step('B sends a text note');
await B.click('.side-btn[aria-label="Send a text"]');
await B.fill('textarea', 'Got it. This is a text note.');
await B.click('.sheet .btn.primary');
await B.waitForTimeout(1500);
await shot(B, '12-B-after-text');

step('A sends a voice-only holler, B plays it');
await A.click('.rail-btn:has-text("Voice only")');
await A.click('.rec'); await A.waitForTimeout(2200); await A.click('.rec');
await A.waitForTimeout(6000);
await B.waitForSelector('.new-pill', { timeout: 20000 });
await B.click('.new-pill', { force: true });
await B.waitForSelector('.p-audio');
await B.waitForTimeout(1500);
const aud = await B.evaluate(() => { const v = document.querySelector('.p-video'); return v ? { ready: v.readyState, t: v.currentTime, paused: v.paused, err: v.error?.code } : null; });
console.log('B voice', JSON.stringify(aud));
await shot(B, '12b-B-voice');
await B.keyboard.press('Escape');
await A.click('.rail-btn:has-text("Voice only")');

step('A records, closes the app mid-send, reopens: it still sends');
const bBefore = await B.locator('.tile').count();
await A.click('.rec'); await A.waitForTimeout(1800); await A.click('.rec');
await A.waitForTimeout(700);
await A.reload();
await A.waitForTimeout(12000);
await B.waitForTimeout(16000); // B's 15 s backstop poll at worst
const bAfter = await B.locator('.tile').count();
console.log('resume', JSON.stringify({ bBefore, bAfter }));
await shot(A, '12c-A-after-reload');
console.log('A side-btns', await A.locator('.rec-row .side-btn').count(), await A.evaluate(() => [...document.querySelectorAll('.rec-row .side-btn')].map(e => e.getBoundingClientRect().toJSON())));

step('A sees reaction + note');
await A.waitForTimeout(4000);
const bBannerAfter = await B.locator('.rec-banner').count();
await shot(A, '13-A-strip');
const aTiles = await A.locator('.tile').count();
await A.click('.rec-row .side-btn');
await A.keyboard.press('Escape');
await A.goto(BASE + '#/');
await A.waitForTimeout(1500);
await shot(A, '14-A-home');
await A.goto(BASE + '#/settings');
await A.waitForTimeout(1000);
await A.screenshot({ path: `${OUT}/15-settings.png`, fullPage: true });
await B.goto(BASE + '#/saved');
await B.waitForTimeout(1500);
await shot(B, '16-B-saved');

const camtest = { A: await A.evaluate(() => localStorage.getItem('holler.camtest2')), B: await B.evaluate(() => localStorage.getItem('holler.camtest2')) };
console.log(JSON.stringify({ camtest, code, bSawRecordingBanner: bRec, bBannerAfterStop: bBannerAfter, aTiles, errors: errs.slice(0, 20) }, null, 1));
await b.close();

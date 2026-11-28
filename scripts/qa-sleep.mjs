// The camera and mic sleep unless they are in use (11-27 round two). Counts every getUserMedia call and watches each
// track's readyState/enabled through an init script, with the quiet spell cut to 4 s (localStorage holler.releaseMs).
// Two fake people: opening a room, reading and a board game from the Play page ask for nothing; opening the camera
// asks once; closing it turns the picture off and keeps the mic; a second open inside the spell asks for nothing new;
// after the spell both tracks are stopped; Film my reaction and Don't Laugh's watch wake the camera and still film.
// Usage: PW_CHANNEL=chrome node scripts/qa-sleep.mjs [baseUrl]   then clean up: node scripts/clean-qa-remote.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:5188/';
const OUT = 'shots/sleep'; mkdirSync(OUT, { recursive: true });
const REL = 4000;
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'] };
const errs = [];
const mk = async n => {
  const ctx = await b.newContext(phone);
  await ctx.addInitScript(rel => {
    try { localStorage.setItem('holler.releaseMs', String(rel)); localStorage.setItem('holler.camtest2', 'ok'); } catch { /* about:blank */ }
    const md = navigator.mediaDevices; if (!md || window.__gumWrapped) return; window.__gumWrapped = true;
    window.__gum = []; window.__tracks = [];
    const real = md.getUserMedia.bind(md);
    md.getUserMedia = async c => { window.__gum.push({ video: !!c?.video, audio: !!c?.audio, at: Date.now() }); const s = await real(c); s.getTracks().forEach(t => window.__tracks.push(t)); return s; };
  }, REL);
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(`${n} pageerror: ${e.message}`));
  return p;
};
const A = await mk('A'), B = await mk('B');
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });
const step = s => console.log('--', s);
const checks = [];
const check = (ok, what, extra = '') => { checks.push([!!ok, what]); console.log(ok ? '  ok  ' : '  FAIL', what, extra); };
const media = p => p.evaluate(() => ({ calls: window.__gum.length, gum: window.__gum.map(g => `${g.video ? 'v' : ''}${g.audio ? 'a' : ''}`).join(','),
  live: window.__tracks.filter(t => t.readyState === 'live').map(t => `${t.kind}:${t.enabled ? 'on' : 'off'}`) }));
const camOn = p => p.waitForFunction(() => document.querySelector('.chat.cam-live') && !document.querySelector('.rec.waiting'), null, { timeout: 15000 });
const openCam = async p => { await p.locator('.rec.live-tile').click(); await p.waitForSelector('.chat.cam-open'); await camOn(p); await p.waitForTimeout(500); };
const closeCam = async p => { await p.click('.side-btn[aria-label="Back to the chat"]'); await p.waitForSelector('.chat.in-thread'); await p.waitForTimeout(600); };

try {
  step('two people, one chat: nothing asked for');
  await A.goto(BASE); await A.fill('#nm', 'ZZTestAvery'); await A.click("text=Let's go"); await A.waitForSelector('text=Start a chat');
  await A.click('button:has-text("Start a chat")'); await A.fill('#cn', 'ZZTest Sleep'); await A.click('text=Make it');
  await A.waitForSelector('.code-big'); const code = (await A.textContent('.code-big')).trim(); await A.click('.sheet-head .icon-btn');
  await B.goto(BASE + '#/join/' + code); await B.fill('#nm', 'ZZTestBlake'); await B.click('text=Join the chat'); await B.waitForSelector('.chat-top', { timeout: 15000 });
  await A.waitForTimeout(2500); await B.waitForTimeout(1500);
  for (const [n, p] of [['A', A], ['B', B]]) { const m = await media(p); check(m.calls === 0 && m.live.length === 0, `${n}: opening a room asks for nothing`, JSON.stringify(m)); }
  check(await A.locator('.rec.live-tile.asleep .av').count() === 1, 'the sleeping tile shows your own face');
  await shot(A, '01-asleep-tile');

  step('B starts a board game from the Play page');
  await B.locator('.chat-top .icon-btn').first().click(); await B.waitForSelector('button.tab[data-tab="play"]');
  await B.click('button.tab[data-tab="play"]'); await B.waitForSelector('.g-tile');
  await B.locator('.g-tile:has-text("Tic-Tac-Toe")').click(); await B.click('.pl-chat');
  await B.waitForSelector('.sheet .g-order-tools .chip', { timeout: 15000 }); await B.click('.sheet .g-order-tools .chip');
  await B.click('.sheet .g-seg button:nth-child(2)'); await B.click('.sheet .btn.g-go'); await B.waitForTimeout(2500);
  { const m = await media(B); check(m.calls === 0 && m.live.length === 0, 'B: a board game from the Play page asks for nothing', JSON.stringify(m)); }
  await B.keyboard.press('Escape'); await B.waitForTimeout(400);
  while (await B.locator('.g-page .g-back').count()) { await B.click('.g-page .g-back'); await B.waitForTimeout(300); }

  step('A opens the camera, closes it, opens it again');
  await openCam(A); await shot(A, '02-cam-on');
  { const m = await media(A); check(m.calls === 1 && m.gum === 'va' && m.live.includes('video:on') && m.live.includes('audio:on'), 'one ask for camera and mic when the camera opens', JSON.stringify(m)); }
  await closeCam(A);
  { const m = await media(A); check(m.live.includes('video:off') && m.live.includes('audio:on'), 'closed: picture off, mic kept', JSON.stringify(m)); }
  await shot(A, '03-closed');
  await openCam(A);
  { const m = await media(A); check(m.calls === 1 && m.live.includes('video:on'), 'a second open inside the spell makes no new ask', JSON.stringify(m)); }
  await closeCam(A); await A.waitForTimeout(REL + 1500);
  { const m = await media(A); check(m.live.length === 0, 'after the spell both tracks are stopped', JSON.stringify(m)); }

  step('A records a holler (a fresh ask, then it sleeps and lets go)');
  await openCam(A); await A.click('.rec'); await A.waitForTimeout(2600); await A.click('.rec');
  await A.waitForSelector('.chat.in-thread', { timeout: 10000 });
  await A.waitForSelector('.thread .tile:not(.pending)', { timeout: 30000 }); await A.waitForTimeout(REL + 1500);
  { const m = await media(A); check(m.calls === 2 && m.live.length === 0, 'the holler sent, then everything let go', JSON.stringify(m)); }

  step('B films a reaction: the switch wakes the camera');
  if (!(await B.locator('.chat-top').count())) { await B.click('button.tab[data-tab="chats"]'); await B.waitForSelector('.chat-card'); await B.click('.chat-card'); await B.waitForSelector('.chat-top'); }
  await B.waitForSelector('.new-pill', { timeout: 20000 }); await B.waitForTimeout(800);
  const bBefore = (await media(B)).calls;
  await B.click('.new-pill', { force: true }); await B.waitForSelector('.g-film');
  if (!(await B.locator('.g-film.on').count())) await B.click('.g-film');
  await B.waitForSelector('.g-face.live', { timeout: 15000 }); await shot(B, '04-B-filming');
  { const m = await media(B); check(m.calls === bBefore + 1 && m.live.includes('video:on'), 'Film my reaction wakes the camera', JSON.stringify(m)); }
  await B.waitForSelector('.g-after', { timeout: 20000 }); await B.click('.g-after .btn'); await B.waitForSelector('.g-review');
  await B.click('.g-review .btn.primary'); await B.waitForTimeout(500); await B.keyboard.press('Escape'); await B.waitForTimeout(8000);
  await A.waitForTimeout(3000);
  check(await A.locator('.g-tile-pip').count() >= 1, 'the reaction still sends and lands');
  // switch it back off so B's next watch asks for nothing
  await B.waitForTimeout(REL + 1500);
  { const m = await media(B); check(m.live.length === 0, 'B: after the player closed, everything let go', JSON.stringify(m)); }

  step('Don\'t Laugh: the watch wakes the camera');
  await A.click('.g-play-tile'); await A.waitForSelector('.g-opt'); await A.waitForTimeout(450);
  await A.locator('.g-opt').filter({ has: A.locator('b:text-is("Don\'t Laugh")') }).click(); await A.waitForTimeout(500);
  await A.click('.seg button:has-text("10 sec")'); await A.click('.btn.g-go:has-text("Start")');
  await A.waitForSelector('.g-banner:has-text("Make them laugh")'); await camOn(A); await A.click('.rec'); await A.waitForTimeout(13000);
  await B.waitForSelector('.g-chip.turn:has-text("Don\'t Laugh")', { timeout: 25000 });
  await B.locator('.g-chip:has-text("Don\'t Laugh")').first().click(); await B.waitForSelector('.g-page'); await B.waitForTimeout(900);
  await B.click('.btn.g-go:has-text("Record mine")'); await B.waitForSelector('.g-banner:has-text("Make them laugh")');
  await camOn(B); await B.click('.rec'); await B.waitForTimeout(13000);
  await B.waitForTimeout(REL + 1500);
  { const m = await media(B); check(m.live.length === 0, 'B: asleep and let go before the watch', JSON.stringify(m)); }
  const bBefore2 = (await media(B)).calls;
  if (!(await B.locator('.g-page').count())) { await B.locator('.g-chip:has-text("Don\'t Laugh")').first().click(); await B.waitForSelector('.g-page'); await B.waitForTimeout(900); }
  await B.locator('.g-row:has-text("ZZTestAvery") .btn:has-text("Watch")').click(); await B.waitForSelector('.l-ready');
  await B.click('.l-ready .btn.g-go'); await B.waitForSelector('.l-gave', { timeout: 30000 }); await B.waitForTimeout(1500); await shot(B, '05-B-laugh-watch');
  { const m = await media(B); check(m.calls === bBefore2 + 1 && m.live.includes('video:on') && await B.locator('.l-me').count() === 1, 'Don\'t Laugh\'s watch wakes the camera and shows your face', JSON.stringify(m)); }
  await B.waitForSelector('.l-done', { timeout: 30000 });
} catch (e) { console.log('STOPPED:', e.message.split('\n')[0]); checks.push([false, 'ran to the end']); }

const pass = checks.filter(c => c[0]).length;
console.log(`checks: ${pass} of ${checks.length} passed`);
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();

// 11-27 polish checks: game dock, moving in Tic-Tac-Toe while a holler records, voice-only and notes-only phones, profiles.
// Usage: PW_CHANNEL=chrome node scripts/qa-polish.mjs [baseUrl]  -> shots/polish/*.png ; then node scripts/clean-qa.mjs
import { chromium } from 'playwright';
// the room opens on its thread (11-27): the camera opens from the live tile. camFirst opens it before a step
// that uses the camera's own controls (the record button, the rail); it does nothing when the camera is already open.
const camFirst = async p => { if (await p.locator('.chat.in-thread .rec.live-tile').count()) { await p.locator('.rec.live-tile').click(); await p.waitForSelector('.chat.cam-open'); }
  await p.waitForSelector('.chat.cam-live', { timeout: 15000 }).catch(() => {}); };   // round two: the camera sleeps until it opens, so wait for it to be on
import { mkdirSync, readFileSync } from 'fs';
const BASE = process.argv[2] || 'http://localhost:5188/';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').trim().split(/\r?\n/).map(l => l.split('=')));
mkdirSync('shots/polish', { recursive: true });
const rpc = async (fn, body) => {
  const r = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(fn + ' ' + JSON.stringify(j)); return j;
};
const results = [];
const check = (name, ok, extra = '') => { results.push([name, !!ok]); console.log(ok ? 'PASS' : 'FAIL', name, extra); };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
// one browser plays every person here and they share one fake camera, which sends no frames to anyone while another
// person's sleeping camera still holds it: each page lets go of the camera fast (a test hook; phones wait 90 s)
{ const nc = b.newContext.bind(b); b.newContext = async (...a) => { const c = await nc(...a); await c.addInitScript(() => { try { localStorage.setItem('holler.releaseMs', '300'); } catch { /* */ } }); return c; }; }
const mk = async () => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'], userAgent: UA });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    const put = () => { const s = document.createElement('style'); s.textContent = ':root{--safe-t:47px!important;--safe-b:34px!important}'; document.documentElement.appendChild(s); };
    if (document.documentElement) put(); else addEventListener('DOMContentLoaded', put);
    // count mic mute/unmute: the 11-27 fix says the mic track is never switched off and on
    window.__micFlips = 0;
    const d = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'enabled');
    Object.defineProperty(MediaStreamTrack.prototype, 'enabled', { get() { return d.get.call(this); }, set(v) { if (this.kind === 'audio' && d.get.call(this) !== v) window.__micFlips++; d.set.call(this, v); } });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('pageerror', e.message));
  return page;
};
const shot = (p, n) => p.screenshot({ path: `shots/polish/${n}.png` });

const A = await mk(), B = await mk();
await A.goto(BASE); await A.fill('#nm', 'Avery QA'); await A.click("text=Let's go");
await A.click('button:has-text("Start a chat")'); await A.fill('#cn', 'QA Crew'); await A.click('text=Make it');
await A.waitForSelector('.code-big'); const code = (await A.textContent('.code-big')).trim(); await A.click('.sheet-head .icon-btn');
await B.goto(BASE + '#/join/' + code); await B.fill('#nm', 'Blake QA'); await B.click('text=Join the chat');
await B.waitForSelector('.chat-top', { timeout: 15000 });
const tA = await A.evaluate(() => localStorage.getItem('holler.token'));
const tB = await B.evaluate(() => localStorage.getItem('holler.token'));
const homeA = await rpc('holler_home', { p_token: tA });
const chat = homeA.chats[0].id; const idA = homeA.me.id; const idB = homeA.chats[0].members.find(m => m.id !== idA).id;

// a game, and a little profile for Blake
await rpc('holler_game_start2', { p_token: tA, p_chat: chat, p_kind: 'ttt', p_order: [idA, idB], p_opts: {} });
await rpc('holler_update_me', { p_token: tB, p_name: null, p_color: null, p_avatar: null, p_prefs: { about: 'Teaching tap on Tuesdays, sleeping in on Sundays.', into: 'Sourdough and old musicals', song: 'Dancing Queen', look: 'none', voice: 'none' } });

// mic flips on open and leave (the loud iPhone sound)
await A.waitForTimeout(2500);
await A.evaluate(() => { window.__micFlips = 0; });
await A.click('.chat-top .icon-btn'); await A.waitForSelector('.chats'); await A.waitForTimeout(600);
await A.click('.chat-card'); await A.waitForSelector('.chat-top'); await A.waitForTimeout(2500);
check('mic never muted or unmuted leaving and reopening a chat', (await A.evaluate(() => window.__micFlips)) === 0, `flips=${await A.evaluate(() => window.__micFlips)}`);

// dock
await A.waitForSelector('.g-dock .g-chip', { timeout: 10000 });
check('dock shows the game', await A.isVisible('.g-dock .g-chip'));
check('dock marks Avery to move', await A.isVisible('.g-chip.turn'));
check('games are not in the strip any more', (await A.locator('.thread .g-tile').count()) === 0);
await shot(A, '01-dock');

// record, move while talking, send
await camFirst(A); await A.click('button.rec'); await A.waitForTimeout(1200);
check('chip says move while you talk', (await A.textContent('.g-chip.turn em'))?.includes('Move while you talk'));
await A.click('.g-chip.turn'); await A.waitForSelector('.g-page.float', { timeout: 8000 });
await A.waitForTimeout(500); await shot(A, '02-float-board-while-recording');
const cells = A.locator('.g-page.float .d-ttt .d-cell');
const nCells = await cells.count();
if (nCells) { await cells.nth(4).click(); await A.waitForTimeout(1500); }
check('board cell found in floating page', nCells >= 9, `cells=${nCells}`);
check('still recording after the move', await A.evaluate(() => !!document.querySelector('.chat.is-rec')));
await A.click('.g-page.float .g-back'); await A.waitForTimeout(300);
await A.click('button.rec'); await A.waitForTimeout(6500);
const chatA = await rpc('holler_chat', { p_token: tA, p_chat: chat });
check('the holler landed', chatA.polos.some(p => p.author === idA && p.kind === 'video'));
const ttt = chatA.games.find(g => g.kind === 'ttt');
check('the move landed', ttt && ttt.turnPerson === idB, `turn=${ttt?.turnPerson === idB ? 'B' : 'A'}`);

// B: home shows "Your move"
await B.evaluate(() => { location.hash = '#/'; });
await B.waitForSelector('.chats'); await B.waitForTimeout(1500);
check('home card says Your move', await B.isVisible('.turn-tag'));
await shot(B, '03-home-your-move');

// B: voice only
await B.evaluate(() => localStorage.setItem('holler.cam', 'voice'));
await B.evaluate(c => { location.hash = '#/c/' + c; }, chat);
await B.reload(); await B.waitForSelector('.chat-top'); await B.waitForTimeout(2500);
await camFirst(B); await B.waitForTimeout(600);
check('voice mode shows voice screen', await B.isVisible('.audio-mode'));
check('voice mode asked for no camera', await B.evaluate(() => !document.querySelector('.rail button[aria-label="Flip camera"]')));
await shot(B, '04-voice-only');
await camFirst(B); await B.click('button.rec'); await B.waitForTimeout(2000); await B.click('button.rec'); await B.waitForTimeout(6500);
const chatB = await rpc('holler_chat', { p_token: tB, p_chat: chat });
check('voice holler landed as audio', chatB.polos.some(p => p.author === idB && p.kind === 'audio'));

// B: notes and games only
await B.evaluate(() => localStorage.setItem('holler.cam', 'off'));
await B.reload(); await B.waitForSelector('.chat-top'); await B.waitForTimeout(1500);
// 11-27: a notes-only phone gets the thread with the big Note button, no wall
check('notes mode shows the thread, no wall', !(await B.isVisible('.notes-mode')) && await B.isVisible('.thread') && await B.isVisible('.rec.note-only'));
await shot(B, '05-notes-only');
await B.click('.rec.note-only'); await B.fill('.sheet textarea', 'No camera, still here'); await B.click('.sheet .btn.primary'); await B.waitForTimeout(1500);
const chatB2 = await rpc('holler_chat', { p_token: tB, p_chat: chat });
check('note sent from notes mode', chatB2.polos.some(p => p.body === 'No camera, still here'));
// B can still move in the game with no camera
await B.click('.g-chip.turn'); await B.waitForSelector('.g-page'); await B.waitForTimeout(600);
await B.locator('.g-page .d-ttt .d-cell').nth(0).click(); await B.waitForTimeout(1500);
const chatB3 = await rpc('holler_chat', { p_token: tB, p_chat: chat });
check('no-camera phone moved in the game', chatB3.games.find(g => g.kind === 'ttt')?.turnPerson === idA);
await B.click('.g-page .g-back');
// the camera sheet
// (the wall's Change button is gone; a game that needs more than notes offers Change, as does You)
await B.click('.g-play-tile'); await B.click('.g-opt:has-text("Give me a card")'); await B.click('.toast button:has-text("Change")'); await B.waitForSelector('.cam-opt'); await shot(B, '06-camera-sheet');
await B.locator('.sheet-head .icon-btn').last().click(); await B.waitForTimeout(400); await B.keyboard.press('Escape'); await B.waitForTimeout(400);   // the camera sheet, then the Play sheet under it

// profiles
await A.click('.chat-title'); await A.waitForSelector('.person-row');
await A.locator('.person-row', { hasText: 'Blake' }).click();
await A.waitForSelector('.sheet.prof .prof-stat b:not(:has(.sk-num))', { timeout: 8000 }).catch(() => {});
await A.waitForTimeout(800);
const profTxt = await A.textContent('.sheet.prof');
check('profile shows about', profTxt.includes('Teaching tap'));
check('profile shows on repeat', profTxt.includes('Dancing Queen'));
check('profile stats loaded', !(await A.isVisible('.sheet.prof .sk-num')));
await shot(A, '07-profile');

const failed = results.filter(r => !r[1]).length;
console.log(`${results.length - failed}/${results.length} passed`);
await b.close();
process.exit(failed ? 1 : 0);

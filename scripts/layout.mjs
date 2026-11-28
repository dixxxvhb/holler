// Screenshots of every screen at iPhone sizes, with iPhone safe areas faked, for overlap checks.
// The room opens on its thread (2chat: with the new line; 2cdays: across several days); 2acam is the camera open, 5rec recording,
// 22notes a notes-only phone, 23play the Play page, 24playsheet the Play sheet's grid.
// Usage: node scripts/layout.mjs [baseUrl]   -> shots/layout/<device>-<state>.png
import { chromium } from 'playwright';
// the room opens on its thread (11-27): the camera opens from the live tile. camFirst opens it before a step
// that uses the camera's own controls (the record button, the rail); it does nothing when the camera is already open.
const camFirst = async p => { if (await p.locator('.chat.in-thread .rec.live-tile').count()) { await p.locator('.rec.live-tile').click(); await p.waitForSelector('.chat.cam-open'); }
  await p.waitForSelector('.chat.cam-live', { timeout: 15000 }).catch(() => {}); };   // round two: the camera sleeps until it opens, so wait for it to be on
import { mkdirSync } from 'fs';
const BASE = process.argv[2] || 'http://localhost:5188/';
mkdirSync('shots/layout', { recursive: true });
const DEVICES = [
  { n: 'se', w: 375, h: 667, t: 20, b: 0 },
  { n: 'mini', w: 375, h: 812, t: 50, b: 34 },
  { n: 'i15', w: 390, h: 844, t: 47, b: 34 },
  { n: 'max', w: 430, h: 932, t: 59, b: 34 },
];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
// one browser plays every person here and they share one fake camera, which sends no frames to anyone while another
// person's sleeping camera still holds it: each page lets go of the camera fast (a test hook; phones wait 90 s)
{ const nc = b.newContext.bind(b); b.newContext = async (...a) => { const c = await nc(...a); await c.addInitScript(() => { try { localStorage.setItem('holler.releaseMs', '300'); } catch { /* */ } }); return c; }; }
const mk = async (d, standalone) => {
  const ctx = await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'], userAgent: UA });
  await ctx.addInitScript(([t, bt, sa]) => {
    if (sa) Object.defineProperty(navigator, 'standalone', { get: () => true });
    const put = () => { const s = document.createElement('style'); s.textContent = `:root{--safe-t:${t}px!important;--safe-b:${bt}px!important}`; document.documentElement.appendChild(s); };
    if (document.documentElement) put(); else addEventListener('DOMContentLoaded', put);
  }, [d.t, d.b, standalone]);
  return ctx;
};
// one setup: A + B, a chat with a few videos and notes
const setupDev = DEVICES[2];
const A = await (await mk(setupDev, true)).newPage();
const B = await (await mk(setupDev, true)).newPage();
await A.goto(BASE); await A.fill('#nm', 'Avery QA'); await A.click("text=Let's go");
await A.click('button:has-text("Start a chat")'); await A.fill('#cn', 'QA Crew'); await A.click('text=Make it');
await A.waitForSelector('.code-big'); const code = (await A.textContent('.code-big')).trim(); await A.click('.sheet-head .icon-btn');
await B.goto(BASE + '#/join/' + code); await B.fill('#nm', 'Blake QA'); await B.click('text=Join the chat');
await B.waitForSelector('.chat-top', { timeout: 15000 });
await A.waitForTimeout(2000);
for (let i = 0; i < 2; i++) { await camFirst(A); await A.click('.rec'); await A.waitForTimeout(1800); await camFirst(A); await A.click('.rec'); await A.waitForTimeout(4500); }
for (const t of ['On my way', 'Call you after class', 'That was so good']) { await B.click('.side-btn'); await B.fill('.sheet textarea', t); await B.click('.sheet .btn.primary'); await B.waitForTimeout(700); }
await camFirst(B); await B.click('.rec'); await B.waitForTimeout(1800); await camFirst(B); await B.click('.rec'); await B.waitForTimeout(5000);
const token = await A.evaluate(() => localStorage.getItem('holler.token'));
const chatId = await A.evaluate(() => location.hash.split('/')[2] || '');
await A.context().close(); await B.context().close();

// LAYOUT_ONLY=i15,se shoots only those sizes (a faster round while iterating)
const ONLY = (process.env.LAYOUT_ONLY || '').split(',').filter(Boolean);
for (const d of DEVICES) {
  if (ONLY.length && !ONLY.includes(d.n)) continue;
  for (const sa of [true, false]) {
    if (!sa && d.n !== 'i15') continue;
    const p = await (await mk(d, sa)).newPage();
    await p.addInitScript(tok => { localStorage.setItem('holler.token', tok); localStorage.setItem('holler.camtest2', 'ok'); }, token);
    const shot = async s => p.screenshot({ path: `shots/layout/${d.n}${sa ? '' : '-safari'}-${s}.png` });
    await p.goto(BASE); await p.waitForSelector('.chat-card'); await p.waitForTimeout(800); await shot('1home');
    if (!sa) { await p.close(); continue; }
    await p.click('.chat-card'); await p.waitForTimeout(2500); await shot('2chat');
    await camFirst(p); await p.waitForTimeout(700); await shot('2acam'); await p.click('.side-btn[aria-label="Back to the chat"]'); await p.waitForTimeout(600);
    // the thread across several days: same hollers, with the first two moved back (a faked response, nothing is written)
    await p.route('**/rpc/holler_chat', async r => { const res = await r.fetch(); const j = await res.json(); const ps = j?.polos || []; if (ps[0]) ps[0].at = new Date(Date.now() - 4 * 864e5).toISOString(); if (ps[1]) ps[1].at = new Date(Date.now() - 864e5).toISOString(); await r.fulfill({ response: res, json: j }); });
    const reenter = async () => { await p.locator('.chat-top .icon-btn').first().click(); await p.waitForSelector('.chat-card'); await p.click('.chat-card'); await p.waitForSelector('.thread .tile'); await p.waitForTimeout(1500); };   // a Home Screen app keeps its place in memory, so a reload would land on home
    await reenter(); await p.evaluate(() => { const s = document.querySelector('.thread'); if (s) s.scrollTop = 0; }); await p.waitForTimeout(300); await shot('2cdays');
    await p.unroute('**/rpc/holler_chat'); await reenter();
    await camFirst(p); await p.click('.rail-btn[aria-label="More tools"]'); await p.waitForTimeout(300); await shot('2bmore'); await camFirst(p); await p.click('.rail-btn[aria-label="Fewer tools"]');
    await camFirst(p); await p.click('.rail-btn:has-text("Looks")'); await p.waitForTimeout(300); await shot('3looks');
    await p.click('.ktab:has-text("Warp")'); await p.click('.looks-panel .chip:has-text("Big head")'); await p.waitForTimeout(300);
    await camFirst(p); await p.click('.rec'); await p.waitForTimeout(1200); await shot('4rec-looks');
    await camFirst(p); await p.click('.rail-btn:has-text("Looks")'); await p.waitForTimeout(300); await shot('5rec');
    await p.click('.side-btn'); await p.waitForTimeout(500);
    await camFirst(p); await p.click('.rail-btn:has-text("Draw")'); await p.waitForTimeout(300); await shot('6draw');
    await camFirst(p); await p.click('.rail-btn:has-text("Text")'); await p.waitForTimeout(300); await shot('7text');
    await camFirst(p); await p.click('.rail-btn:has-text("Text")'); await p.waitForTimeout(300);
    await p.click('.side-btn[aria-label="Back to the chat"]'); await p.waitForTimeout(600);
    await p.locator('.thread .tile:not(.pending)').first().evaluate(e => e.click()); await p.waitForTimeout(1500); await p.evaluate(() => document.querySelector('.p-video')?.pause()); await shot('8player-own');
    await p.click('.p-top .icon-btn'); await p.waitForTimeout(500);
    await p.locator('.thread .tile:not(.pending)').last().evaluate(e => e.click()); await p.waitForTimeout(1500); await p.evaluate(() => document.querySelector('.p-video')?.pause()); await shot('9player-other');
    await p.click('.p-top .icon-btn'); await p.waitForTimeout(500);
    await p.locator('.chat-title').evaluate(e => e.click()); await p.waitForTimeout(600); await shot('10info');
    await p.locator('.btn.leave').evaluate(e => e.click()); await p.waitForTimeout(500); await shot('10bask'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    if (!(await p.locator('.sheet .code-big').count())) throw new Error('Escape on a question closed the sheet under it too');
    await p.goto(BASE); await p.waitForSelector('button.tab[data-tab="you"]'); await p.click('button.tab[data-tab="you"]'); await p.waitForTimeout(800); await shot('11settings');
    await p.evaluate(() => window.scrollTo(0, 99999)); await p.locator('.settings, main, body').first().evaluate(e => e.scrollTo?.(0, 99999)); await p.waitForTimeout(300); await shot('12settings-bottom');
    // more states (nothing below writes to the database: sheets are closed unsent, home variants are faked responses)
    await p.goto(BASE); await p.waitForSelector('.chat-card'); await p.waitForTimeout(500);
    await p.click('button.new-chat-btn'); await p.waitForTimeout(500); await p.fill('#cn', 'Roomies'); await shot('13newchat');
    await p.click('text=Have a code? Join a chat'); await p.waitForTimeout(500); await p.fill('#jc', '94D'); await shot('14join'); await p.keyboard.press('Escape');
    await p.click('.chat-card'); await p.waitForTimeout(2500);
    await p.click('.side-btn[aria-label="Send a text"]'); await p.waitForTimeout(500); await p.fill('.sheet textarea', "Running late. Start without me, I'll catch up."); await shot('15typed'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await camFirst(p); await p.click('.rail-btn[aria-label="More tools"]'); await p.click('.more-tools .rail-btn:has-text("Voice only")'); await camFirst(p); await p.click('.rail-btn[aria-label="Fewer tools"]'); await p.waitForTimeout(400); await shot('16voice');
    await camFirst(p); await p.click('.rail-btn[aria-label="More tools"]'); await p.click('.more-tools .rail-btn:has-text("Voice only")'); await camFirst(p); await p.click('.rail-btn[aria-label="Fewer tools"]');
    // the Play sheet's grid, a phone set to notes and games, the Play page
    await p.click('.side-btn[aria-label="Back to the chat"]'); await p.waitForTimeout(500);
    await p.click('.g-play-tile'); await p.waitForSelector('.g-opt'); await p.waitForTimeout(500); await shot('24playsheet'); await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    await p.evaluate(() => localStorage.setItem('holler.cam', 'off')); await p.reload(); await p.waitForSelector('.chat-card'); await p.click('.chat-card'); await p.waitForSelector('.rec.note-only'); await p.waitForTimeout(1500); await shot('22notes');
    await p.evaluate(() => localStorage.removeItem('holler.cam'));
    await p.goto(BASE + '#/play'); await p.waitForTimeout(2000); await shot('23play');
    await p.goto(BASE + '#/saved'); await p.waitForTimeout(1500); await shot('17saved');
    const fakeHome = async mut => { await p.unroute('**/rpc/holler_home').catch(() => {}); await p.route('**/rpc/holler_home', async r => { const res = await r.fetch(); const j = await res.json(); mut(j); await r.fulfill({ response: res, json: j }); }); };
    await fakeHome(j => {
      const c = j.chats[0]; if (!c) return; const mk = (o) => ({ ...c, ...o });
      const t = new Date(Date.now() - 7200e3).toISOString();
      // a group (three people), a game waiting with something new (a pill) and without (the status line), so every card state shows
      const third = { ...c.members[0], id: 'fake-third', name: 'Dee QA', color: '#4fd1a5', avatar: null };
      j.chats = [mk({ id: 'f1', yourTurn: 1 }), mk({ id: 'f2', name: 'Besties', theme: 'sky', unread: 0 }), mk({ id: 'f3', name: 'Grandma, Grandpa and all the cousins in Ohio', theme: 'lime', unread: 2, yourTurn: 1, members: [...c.members, third], last: { ...c.last, author: j.me.id, at: t, seen: c.members.map(m => m.id) } }),
        mk({ id: 'f4', name: 'Nan', theme: 'violet', unread: 0, muted: true, last: { ...c.last, kind: 'text', thumb: null, body: 'Call you after class' } }), mk({ id: 'f5', name: 'Sunday crew', theme: 'sun', unread: 0, yourTurn: 2, members: [...c.members, third], last: null })];
    });
    await p.goto(BASE); await p.waitForSelector('.chat-card'); await p.waitForTimeout(600);
    await p.evaluate(() => { const li = document.querySelectorAll('.chats li')[1]; li.classList.add('is-live'); li.querySelector('.chat-card').classList.add('live'); li.querySelector('.cc-sub').innerHTML = '<span class="live-txt">Blake is recording</span>'; });
    await shot('18many'); await p.evaluate(() => document.querySelector('.chats').scrollIntoView({ block: 'end' })); await p.evaluate(() => { window.scrollTo(0, 99999); document.querySelector('.home')?.scrollTo(0, 99999); }); await p.waitForTimeout(300); await shot('18bmany-bottom');
    await fakeHome(j => { j.chats = []; });
    await p.goto(BASE); await p.waitForSelector('.empty'); await p.waitForTimeout(500); await shot('19empty');
    await p.unroute('**/rpc/holler_home');
    {
      const q = await (await mk(d, sa)).newPage();
      await q.goto(BASE); await q.waitForSelector('#nm'); await q.waitForTimeout(600); await q.screenshot({ path: `shots/layout/${d.n}-20onboard.png` });
      await q.click('.link-btn'); await q.waitForTimeout(300); await q.fill('#lc', 'K7Q'); await q.screenshot({ path: `shots/layout/${d.n}-20bonboard-code.png` });
      await q.close();
      const r = await (await mk(d, sa)).newPage();
      await r.addInitScript(tok => { localStorage.setItem('holler.token', tok); localStorage.setItem('holler.camtest2', 'ok'); navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no', 'NotAllowedError')); }, token);
      await r.goto(BASE); await r.waitForSelector('.chat-card'); await r.click('.chat-card'); await r.waitForTimeout(2000); await r.screenshot({ path: `shots/layout/${d.n}-21camoff.png` });
      await r.close();
    }
    await p.close();
  }
}
console.log('done', chatId);
await b.close();

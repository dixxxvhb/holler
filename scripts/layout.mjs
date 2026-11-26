// Screenshots of every screen at iPhone sizes, with iPhone safe areas faked, for overlap checks.
// Usage: node scripts/layout.mjs [baseUrl]   -> shots/layout/<device>-<state>.png
import { chromium } from 'playwright';
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
const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
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
for (let i = 0; i < 2; i++) { await A.click('.rec'); await A.waitForTimeout(1800); await A.click('.rec'); await A.waitForTimeout(4500); }
for (const t of ['On my way', 'Call you after class', 'That was so good']) { await B.click('.side-btn'); await B.fill('.sheet textarea', t); await B.click('.sheet .btn.primary'); await B.waitForTimeout(700); }
await B.click('.rec'); await B.waitForTimeout(1800); await B.click('.rec'); await B.waitForTimeout(5000);
const token = await A.evaluate(() => localStorage.getItem('holler.token'));
const chatId = await A.evaluate(() => location.hash.split('/')[2] || '');
await A.context().close(); await B.context().close();

for (const d of DEVICES) {
  for (const sa of [true, false]) {
    if (!sa && d.n !== 'i15') continue;
    const p = await (await mk(d, sa)).newPage();
    await p.addInitScript(tok => { localStorage.setItem('holler.token', tok); localStorage.setItem('holler.camtest2', 'ok'); }, token);
    const shot = async s => p.screenshot({ path: `shots/layout/${d.n}${sa ? '' : '-safari'}-${s}.png` });
    await p.goto(BASE); await p.waitForSelector('.chat-card'); await p.waitForTimeout(800); await shot('1home');
    if (!sa) { await p.close(); continue; }
    await p.click('.chat-card'); await p.waitForTimeout(2500); await shot('2chat');
    await p.click('.rail-btn[aria-label="More tools"]'); await p.waitForTimeout(300); await shot('2bmore'); await p.click('.rail-btn[aria-label="Fewer tools"]');
    await p.click('.rail-btn:has-text("Looks")'); await p.waitForTimeout(300); await shot('3looks');
    await p.click('.ktab:has-text("Warp")'); await p.click('.looks-panel .chip:has-text("Big head")'); await p.waitForTimeout(300);
    await p.click('.rec'); await p.waitForTimeout(1200); await shot('4rec-looks');
    await p.click('.rail-btn:has-text("Looks")'); await p.waitForTimeout(300); await shot('5rec');
    await p.click('.side-btn'); await p.waitForTimeout(500);
    await p.click('.rail-btn:has-text("Draw")'); await p.waitForTimeout(300); await shot('6draw');
    await p.click('.rail-btn:has-text("Text")'); await p.waitForTimeout(300); await shot('7text');
    await p.click('.rail-btn:has-text("Text")'); await p.waitForTimeout(300);
    await p.locator('.strip .tile:not(.pending)').first().evaluate(e => e.click()); await p.waitForTimeout(1500); await p.evaluate(() => document.querySelector('.p-video')?.pause()); await shot('8player-own');
    await p.click('.p-top .icon-btn'); await p.waitForTimeout(500);
    await p.locator('.strip .tile:not(.pending)').last().evaluate(e => e.click()); await p.waitForTimeout(1500); await p.evaluate(() => document.querySelector('.p-video')?.pause()); await shot('9player-other');
    await p.click('.p-top .icon-btn'); await p.waitForTimeout(500);
    await p.locator('.chat-title').evaluate(e => e.click()); await p.waitForTimeout(600); await shot('10info');
    await p.goto(BASE); await p.waitForSelector('.me-btn'); await p.click('.me-btn'); await p.waitForTimeout(800); await shot('11settings');
    await p.evaluate(() => window.scrollTo(0, 99999)); await p.locator('.settings, main, body').first().evaluate(e => e.scrollTo?.(0, 99999)); await p.waitForTimeout(300); await shot('12settings-bottom');
    // more states (nothing below writes to the database: sheets are closed unsent, home variants are faked responses)
    await p.goto(BASE); await p.waitForSelector('.chat-card'); await p.waitForTimeout(500);
    await p.click('.fab-row .btn.primary'); await p.waitForTimeout(500); await p.fill('#cn', 'Roomies'); await shot('13newchat'); await p.keyboard.press('Escape');
    await p.click('.fab-row .btn:not(.primary)'); await p.waitForTimeout(500); await p.fill('#jc', '94D'); await shot('14join'); await p.keyboard.press('Escape');
    await p.click('.chat-card'); await p.waitForTimeout(2500);
    await p.click('.side-btn[aria-label="Send a text"]'); await p.waitForTimeout(500); await p.fill('.sheet textarea', "Running late. Start without me, I'll catch up."); await shot('15typed'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await p.click('.rail-btn[aria-label="More tools"]'); await p.click('.more-tools .rail-btn:has-text("Voice only")'); await p.click('.rail-btn[aria-label="Fewer tools"]'); await p.waitForTimeout(400); await shot('16voice');
    await p.click('.rail-btn[aria-label="More tools"]'); await p.click('.more-tools .rail-btn:has-text("Voice only")'); await p.click('.rail-btn[aria-label="Fewer tools"]');
    await p.goto(BASE + '#/saved'); await p.waitForTimeout(1500); await shot('17saved');
    const fakeHome = async mut => { await p.unroute('**/rpc/holler_home').catch(() => {}); await p.route('**/rpc/holler_home', async r => { const res = await r.fetch(); const j = await res.json(); mut(j); await r.fulfill({ response: res, json: j }); }); };
    await fakeHome(j => {
      const c = j.chats[0]; if (!c) return; const mk = (o) => ({ ...c, ...o });
      const t = new Date(Date.now() - 7200e3).toISOString();
      j.chats = [mk({ id: 'f1' }), mk({ id: 'f2', name: 'Besties', theme: 'sky', unread: 0 }), mk({ id: 'f3', name: 'Grandma, Grandpa and all the cousins in Ohio', theme: 'lime', unread: 0, last: { ...c.last, author: j.me.id, at: t, seen: c.members.map(m => m.id) } }),
        mk({ id: 'f4', name: 'Nan', theme: 'violet', unread: 0, muted: true, last: { ...c.last, kind: 'text', thumb: null, body: 'Call you after class' } }), mk({ id: 'f5', name: 'Sunday crew', theme: 'sun', unread: 0, last: null })];
    });
    await p.goto(BASE); await p.waitForSelector('.chat-card'); await p.waitForTimeout(600);
    await p.evaluate(() => { const li = document.querySelectorAll('.chats li')[1]; li.classList.add('is-live'); li.querySelector('.chat-card').classList.add('live'); li.querySelector('.cc-sub').innerHTML = '<span class="live-txt">Blake is recording</span>'; });
    await shot('18many'); await p.evaluate(() => document.querySelector('.chats').scrollIntoView({ block: 'end' })); await p.evaluate(() => window.scrollTo(0, 99999)); await shot('18bmany-bottom');
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

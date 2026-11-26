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
    await p.close();
  }
}
console.log('done', chatId);
await b.close();

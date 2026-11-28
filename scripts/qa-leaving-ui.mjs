// The "leaving soon" bar, badge, list and Save button, with NOTHING applied to the database: two QA people and
// real QA hollers, and Blake's copy of the chat read is given two of them as leaving (the fields the per-chat
// limit would send once it is on). Proves the app side on its own; scripts/qa-limit.mjs is the full loop and
// needs supabase/limits.sql applied first.
// Usage: PW_CHANNEL=chrome node scripts/qa-leaving-ui.mjs [baseUrl]   then   node scripts/clean-qa-remote.mjs
import { chromium } from 'playwright';
import { statSync, mkdirSync } from 'node:fs';
const camFirst = async p => { if (await p.locator('.chat.in-thread .rec.live-tile').count()) { await p.locator('.rec.live-tile').click(); await p.waitForSelector('.chat.cam-open'); }
  await p.waitForSelector('.chat.cam-live', { timeout: 15000 }).catch(() => {}); };
const BASE = process.argv[2] || 'http://localhost:5188/';
const OUT = 'shots/limit'; mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const check = (ok, name, extra = '') => { if (ok) pass++; else fail++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : extra); };

const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
{ const nc = b.newContext.bind(b); b.newContext = async (...a) => { const c = await nc(...a); await c.addInitScript(() => { try { localStorage.setItem('holler.releaseMs', '300'); } catch { /* */ } }); return c; }; }
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false, permissions: ['camera', 'microphone'], acceptDownloads: true };
const A = await (await b.newContext(phone)).newPage();
const B = await (await b.newContext(phone)).newPage();
const errs = [];
for (const [n, p] of [['A', A], ['B', B]]) p.on('pageerror', e => errs.push(`${n} pageerror: ${e.message}`));

console.log('-- two QA people, a note and three short hollers');
await A.goto(BASE); await A.fill('#nm', 'Avery QA'); await A.click("text=Let's go");
await A.click('button:has-text("Start a chat")'); await A.fill('#cn', 'QA Crew'); await A.click('text=Make it');
await A.waitForSelector('.code-big'); const code = (await A.textContent('.code-big')).trim(); await A.click('.sheet-head .icon-btn');
await B.goto(BASE + '#/join/' + code); await B.fill('#nm', 'Blake QA'); await B.click('text=Join the chat'); await B.waitForSelector('.chat-top', { timeout: 15000 });
await A.waitForTimeout(1500);
await A.click('.side-btn[aria-label="Send a text"]'); await A.fill('textarea', 'this note stays'); await A.click('.sheet .btn.primary'); await A.waitForTimeout(1500);
for (let i = 0; i < 3; i++) {
  await camFirst(A); await A.click('.rec'); await A.waitForTimeout(3200); await A.click('.rec');
  let n = 0; for (let k = 0; k < 80 && n < i + 1; k++) { n = await A.locator('.thread .tile:not(.pending)').count(); if (n < i + 1) await A.waitForTimeout(500); }
  check(n === i + 1, `holler ${i + 1} sent`, `tiles ${n}`);
  await A.waitForTimeout(6500);
}

console.log('-- Blake sees the chat as it is today: nothing about a limit');
await B.reload(); await B.waitForSelector('.thread .tile', { timeout: 15000 }); await B.waitForTimeout(800);
check(await B.locator('.leaving-bar').count() === 0 && await B.locator('.tile-leave').count() === 0, 'no bar and no badge while the limit is off');
await B.click('.chat-title'); await B.waitForSelector('.sheet .fine');
const infoLine = await B.locator('.sheet .fine:has-text("kept forever")').count();
check(infoLine === 1, 'chat info still says kept forever while the limit is off');
await B.keyboard.press('Escape'); await B.waitForTimeout(500);

console.log('-- the same chat, with the two oldest hollers marked as leaving (stand-in for what the limit would send)');
let chatId = '';
await B.route('**/rpc/holler_chat', async route => {
  const r = await route.fetch(); const j = await r.json();
  const vids = (j.polos || []).filter(p => p.kind === 'video');
  const when = [new Date(Date.now() + 2.4 * 864e5).toISOString(), new Date(Date.now() + 2.9 * 864e5).toISOString()];
  vids.slice(0, 2).forEach((p, i) => { p.leavesAt = when[i]; });
  j.leaving = vids.slice(0, 2); j.keepSeconds = 720; chatId = j.id;
  await route.fulfill({ response: r, json: j });
});
await B.reload(); await B.waitForSelector('.leaving-bar', { timeout: 15000 }); await B.waitForTimeout(800);
const barText = (await B.locator('.leaving-bar b').textContent()) || '';
check(/^2 hollers/.test(barText), 'the bar says how many and when', barText);
check(await B.locator('.thread .tile .tile-leave').count() === 2, 'the two leaving hollers carry a badge');
const box = await B.locator('.leaving-bar').boundingBox(); const top = await B.locator('.thread').boundingBox();
check(box && top && box.y - top.y < 20 && box.width > 300, 'the bar sits at the top of the chat', JSON.stringify({ box, top }));
await B.screenshot({ path: `${OUT}/01-bar.png` });
await B.click('.leaving-bar'); await B.waitForSelector('.leaving-list li'); await B.waitForTimeout(600);
check(await B.locator('.leaving-list li').count() === 2 && await B.locator('.leaving-save').count() === 2, 'the list has each one with one button');
check((await B.locator('.leaving-save').first().textContent()).trim() === 'Save to camera roll', 'the button says Save to camera roll');
check(await B.locator('.leaving-sheet button:has-text("Keep"), .leaving-sheet button:has-text("Saved")').count() === 0, 'there is no way to keep one inside Holler');
await B.screenshot({ path: `${OUT}/02-list.png` });
const dl = B.waitForEvent('download', { timeout: 30000 }).catch(() => null);
await B.locator('.leaving-save').first().click();
const d = await dl; const saved = d ? await d.path() : null;
check(!!saved && statSync(saved).size > 20000 && /\.mp4$/.test(d.suggestedFilename()), 'Save hands over the real video file', d ? `${d.suggestedFilename()} ${saved && statSync(saved).size}` : 'no download');
await B.waitForTimeout(900);
check(await B.locator('.leaving-main em:has-text("saved from this phone")').count() === 1, 'the row remembers it was saved');
await B.screenshot({ path: `${OUT}/03-after-save.png` });
await B.locator('.leaving-pic').nth(1).click(); await B.waitForSelector('.p-video', { timeout: 15000 });
check(true, 'tapping a picture in the list plays that holler');
await B.keyboard.press('Escape'); await B.waitForTimeout(600);
await B.click('.chat-title'); await B.waitForSelector('.sheet .fine');
await B.waitForTimeout(600);
check(await B.locator('.sheet .fine:has-text("newest 12 minutes")').count() === 1, 'chat info explains the limit once it is on');
await B.screenshot({ path: `${OUT}/04-info.png` });
await B.keyboard.press('Escape'); await B.waitForTimeout(400);

console.log('-- the ping\'s link opens the list');
await B.goto(BASE + `#/c/${chatId}/leaving`); await B.reload();
await B.waitForSelector('.leaving-list li', { timeout: 15000 });
check(await B.locator('.leaving-list li').count() === 2, 'the link from the ping opens the list');

console.log(JSON.stringify({ pass, fail, errs }, null, 1));
await b.close();
process.exit(fail ? 1 : 0);

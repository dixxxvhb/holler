// The per-chat limit, end to end, on QA people only. Two fake people in a chat named 'ZZ limit test' (the only
// name the test path of the limit will look at, and only while every member is a QA person): four short hollers
// and a note; the limit is run over that chat keeping 5 seconds; the oldest hollers show as leaving (bar, badge,
// sheet with one Save button each, and Save hands over the real file); then they are made due, taken out, and their
// files really go from storage, while the newest hollers and the note stay.
// The SQL runs on the PC through pc-run (files on origin/main): supabase/limits-qa-mark.sql, limits-qa-due.sql.
// Usage: PW_CHANNEL=chrome node scripts/qa-limit.mjs [baseUrl]   then   node scripts/clean-qa-remote.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { statSync, mkdirSync } from 'node:fs';
const camFirst = async p => { if (await p.locator('.chat.in-thread .rec.live-tile').count()) { await p.locator('.rec.live-tile').click(); await p.waitForSelector('.chat.cam-open'); }
  await p.waitForSelector('.chat.cam-live', { timeout: 15000 }).catch(() => {}); };
const BASE = process.argv[2] || 'http://localhost:5188/';
const OUT = 'shots/limit'; mkdirSync(OUT, { recursive: true });
const sql = f => {
  const out = execFileSync('ssh', ['pc', `pwsh -NoProfile -File C:/Users/bowle/bin/pc-run.ps1 holler-sql ${f}`]).toString();
  const body = out.slice(out.indexOf('\n', out.indexOf('started')) + 1, out.lastIndexOf('pc-run:')).trim();
  if (!/^20\d /.test(body)) throw new Error(`${f} failed:\n${out}`);
  return JSON.parse(body.replace(/^\d+ /, '')).at(-1).report;
};
let pass = 0, fail = 0;
const check = (ok, name, extra = '') => { if (ok) pass++; else fail++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : extra); };

const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
{ const nc = b.newContext.bind(b); b.newContext = async (...a) => { const c = await nc(...a); await c.addInitScript(() => { try { localStorage.setItem('holler.releaseMs', '300'); } catch { /* */ } }); return c; }; }
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false, permissions: ['camera', 'microphone'], acceptDownloads: true };
const A = await (await b.newContext(phone)).newPage();
const B = await (await b.newContext(phone)).newPage();
const errs = [];
for (const [n, p] of [['A', A], ['B', B]]) p.on('pageerror', e => errs.push(`${n} pageerror: ${e.message}`));
// the chat as the server last sent it to Blake
let chatB = null;
B.on('response', async r => { if (r.url().includes('/rpc/holler_chat') && r.ok()) { try { chatB = await r.json(); } catch { /* */ } } });
const reloadB = async () => { chatB = null; await B.reload(); await B.waitForSelector('.chat-top', { timeout: 15000 }); for (let i = 0; i < 30 && !chatB; i++) await B.waitForTimeout(300); await B.waitForTimeout(600); return chatB; };
const head = async path => (await fetch(`${process.env.SB_URL}/storage/v1/object/public/holler/${path}`, { method: 'HEAD' })).status;

console.log('-- two QA people, a chat named ZZ limit test');
await A.goto(BASE); await A.fill('#nm', 'Avery QA'); await A.click("text=Let's go");
await A.click('button:has-text("Start a chat")'); await A.fill('#cn', 'ZZ limit test'); await A.click('text=Make it');
await A.waitForSelector('.code-big'); const code = (await A.textContent('.code-big')).trim(); await A.click('.sheet-head .icon-btn');
process.env.SB_URL = await A.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).find(u => u.includes('.supabase.co/'))?.split('/').slice(0, 3).join('/'));
await B.goto(BASE + '#/join/' + code); await B.fill('#nm', 'Blake QA'); await B.click('text=Join the chat'); await B.waitForSelector('.chat-top', { timeout: 15000 });

console.log('-- Avery sends a note and four 3-second hollers');
await A.waitForTimeout(1500);
await A.click('.side-btn:has-text("Note")'); await A.fill('textarea.field', 'this note must stay'); await A.click('.sheet .btn.primary');
for (let i = 0; i < 4; i++) {
  await camFirst(A); await A.click('.rec'); await A.waitForTimeout(3300); await A.click('.rec');
  let n = 0; for (let k = 0; k < 80 && n < i + 1; k++) { n = await A.locator('.thread .tile:not(.pending)').count(); if (n < i + 1) await A.waitForTimeout(500); }
  check(n === i + 1, `holler ${i + 1} sent`, `tiles ${n}`);
  await A.waitForTimeout(6500);   // past the undo window, and a clear gap between hollers
}
let chat = await reloadB();
const before = chat.polos.filter(p => p.kind === 'video');
check(before.length === 4 && chat.polos.some(p => p.kind === 'text'), 'Blake sees four hollers and the note', JSON.stringify(chat.polos.map(p => p.kind)));
check(await B.locator('.leaving-bar').count() === 0 && !(chat.leaving || []).length, 'nothing is leaving before the limit runs');
check(before.every(p => p.w === 720 && p.h === 1280), 'hollers are 720 wide', JSON.stringify(before.map(p => [p.w, p.h])));

console.log('-- the limit runs over the QA chat, keeping 5 seconds');
const r1 = sql('limits-qa-mark.sql');
const marked = Object.entries(r1.marked || {});
check(marked.length === 1 && marked[0][0] === chat.id, 'only the QA chat was marked', JSON.stringify(r1));
check(r1.removed.length === 0, 'nothing is removed on the day it is marked', JSON.stringify(r1.removed));
chat = await reloadB();
const leaving = chat.leaving || [];
const nLeave = leaving.length;
check(nLeave >= 1 && nLeave <= 3 && nLeave === marked[0]?.[1], `the oldest ${nLeave} are leaving`, JSON.stringify(r1));
check(leaving.every(p => p.kind === 'video') && !leaving.some(p => p.id === before.at(-1).id), 'the newest holler and the note are not leaving');
check(leaving.every(p => Math.abs(new Date(p.leavesAt) - Date.now() - 3 * 864e5) < 45 * 6e4), 'each leaves in 3 days');
check(await B.locator('.leaving-bar').count() === 1, 'the bar shows at the top of the chat');
const barText = (await B.locator('.leaving-bar b').textContent()) || '';
check(new RegExp(`^${nLeave} holler`).test(barText), 'the bar says how many', barText);
check(await B.locator('.thread .tile .tile-leave').count() === nLeave, 'leaving hollers carry a badge');
await B.screenshot({ path: `${OUT}/01-bar.png` });
await B.click('.leaving-bar'); await B.waitForSelector('.leaving-list li');
check(await B.locator('.leaving-list li').count() === nLeave && await B.locator('.leaving-list .leaving-save').count() === nLeave, 'the sheet lists each one with one button');
check((await B.locator('.leaving-save').first().textContent()).trim() === 'Save to camera roll', 'the button says Save to camera roll');
await B.waitForTimeout(500); await B.screenshot({ path: `${OUT}/02-sheet.png` });
const dl = B.waitForEvent('download', { timeout: 30000 }).catch(() => null);
await B.locator('.leaving-save').first().click();
const d = await dl;
const saved = d ? await d.path() : null;
check(!!saved && statSync(saved).size > 20000 && /\.mp4$/.test(d.suggestedFilename()), 'Save hands over the real video file', d ? `${d.suggestedFilename()} ${saved && statSync(saved).size}` : 'no download');
await B.waitForTimeout(700); await B.screenshot({ path: `${OUT}/03-after-save.png` });
check(await B.locator('.leaving-main em:has-text("saved from this phone")').count() === 1, 'the row remembers it was saved');
for (const p of leaving) check(await head(p.path) === 200, 'a leaving holler still plays');

console.log('-- three days later (made due now): taken out, and the files go');
const r2 = sql('limits-qa-due.sql');
check(r2.removed.length === nLeave && leaving.every(p => r2.removed.includes(p.id)), 'exactly the leaving ones were taken out', JSON.stringify(r2));
check(!r2.delete_error && r2.files_asked === nLeave * 2, 'storage was asked for their files (video and thumbnail each)', JSON.stringify({ e: r2.delete_error, due: r2.files_due, asked: r2.files_asked }));
chat = await reloadB();
const after = chat.polos.filter(p => p.kind === 'video');
check(after.length === 4 - nLeave && !after.some(p => leaving.some(l => l.id === p.id)), 'they are gone from the chat');
check(chat.polos.some(p => p.kind === 'text' && p.body === 'this note must stay'), 'the note is still there');
check(await B.locator('.leaving-bar').count() === 0, 'the bar is gone');
let gone = false; for (let i = 0; i < 20 && !gone; i++) { await B.waitForTimeout(1500); gone = (await Promise.all(leaving.flatMap(p => [head(p.path), head(p.thumb)]))).every(s => s >= 400); }
check(gone, 'their files are gone from storage');
check((await Promise.all(after.map(p => head(p.path)))).every(s => s === 200), 'the hollers that stayed still have their files');
await B.screenshot({ path: `${OUT}/04-after.png` });

console.log(JSON.stringify({ pass, fail, errs }, null, 1));
await b.close();
process.exit(fail ? 1 : 0);

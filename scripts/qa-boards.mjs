// Tic-Tac-Toe, Checkers, Seven Letters and Trivia, end to end with two fake people:
// a won Tic-Tac-Toe and a rematch, a few Checkers moves including a forced jump, a whole Seven Letters
// (real words from the game's own list, a fake word refused) and a whole Trivia. Then ALWAYS clean up:
// node scripts/clean-qa-remote.mjs
// Usage: PW_CHANNEL=chrome node scripts/qa-boards.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:5188/';
const OUT = 'shots/boards'; mkdirSync(OUT, { recursive: true });
const DICT = readFileSync('src/games/content/dict.ts', 'utf8').match(/DICT = "([^"]+)"/)[1].split(' ');
const fits = (w, rack) => { const l = [...rack]; for (const c of w) { const i = l.indexOf(c); if (i < 0) return false; l.splice(i, 1); } return true; };

const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
// one browser plays every person here and they share one fake camera, which sends no frames to anyone while another
// person's sleeping camera still holds it: each page lets go of the camera fast (a test hook; phones wait 90 s)
{ const nc = b.newContext.bind(b); b.newContext = async (...a) => { const c = await nc(...a); await c.addInitScript(() => { try { localStorage.setItem('holler.releaseMs', '300'); } catch { /* */ } }); return c; }; }
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'] };
const P = await Promise.all([0, 1].map(async () => (await b.newContext(phone)).newPage()));
const [A, B] = P; const N = ['A', 'B'];
const errs = [];
P.forEach((p, i) => {
  p.on('pageerror', e => errs.push(`${N[i]} pageerror: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(`${N[i]} console: ${m.text()}`); });
});
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });
const step = s => console.log('--', s);
const checks = [];
const check = (ok, what) => { checks.push([ok, what]); console.log(ok ? '  ok ' : '  FAIL', what); };
const back = async p => { while (await p.locator('.g-page .g-back').count()) { await p.click('.g-page .g-back'); await p.waitForTimeout(400); } };
const openTile = async (p, name, nth = 0) => { await back(p); await p.locator(`.g-chip:has-text("${name}")`).nth(nth).click(); await p.waitForSelector('.g-page'); await p.waitForTimeout(800); };
const status = p => p.textContent('.d-status').then(t => t.trim());
const waitStatus = async (p, txt) => { await p.waitForFunction(t => document.querySelector('.d-status')?.textContent?.includes(t), txt, { timeout: 20000 }); };
const play = async (p, name) => { await back(p); await p.click('.g-play-tile'); await p.waitForSelector('.g-opt'); await p.waitForTimeout(450); await p.locator('.g-opt').filter({ has: p.locator(`b:text-is("${name}")`) }).click(); await p.waitForTimeout(500); };

try {
  step('two people, one chat');
  await A.goto(BASE); await A.fill('#nm', 'ZZTestAvery'); await A.click('text=Let\'s go'); await A.waitForSelector('text=Start a chat');
  await A.click('button:has-text("Start a chat")'); await A.fill('#cn', 'ZZTest Boards'); await A.click('text=Make it');
  await A.waitForSelector('.code-big'); const code = (await A.textContent('.code-big')).trim(); await A.click('.sheet-head .icon-btn');
  await B.goto(BASE + '#/join/' + code); await B.fill('#nm', 'ZZTestBlake'); await B.click('text=Join the chat'); await B.waitForSelector('.chat-top', { timeout: 15000 });
  await A.waitForTimeout(2500);

  // ================= Tic-Tac-Toe =================
  step('Play sheet');
  await A.click('.g-play-tile'); await A.waitForSelector('.g-opt'); await A.waitForTimeout(450);
  for (const n of ['Seven Letters', 'Trivia', 'Checkers', 'Tic-Tac-Toe']) check(await A.locator(`.g-opt:has-text("${n}")`).count() === 1, `${n} in the Play sheet`);
  await A.locator('.g-opt:has-text("Tic-Tac-Toe")').scrollIntoViewIfNeeded(); await shot(A, '01-play-sheet');
  await A.click('.g-opt:has-text("Tic-Tac-Toe")'); await A.waitForTimeout(500); await shot(A, '02-ttt-start');
  await A.click('.btn.g-go:has-text("Start")'); await A.waitForSelector('.d-ttt');
  check(await status(A) === 'Your move', 'A moves first');
  const ttt = async (p, cell) => { await p.click(`[data-cell="${cell}"]`); await p.waitForTimeout(900); };
  await ttt(A, 0);
  check(await status(A) !== 'Your move', 'after the move it is their turn');
  await B.waitForSelector('.g-chip.turn:has-text("Tic-Tac-Toe")', { timeout: 20000 });
  await openTile(B, 'Tic-Tac-Toe'); await ttt(B, 4);
  await waitStatus(A, 'Your move'); check(true, 'A sees B\'s move without reloading');
  await ttt(A, 1);
  await waitStatus(B, 'Your move'); await ttt(B, 8);
  await waitStatus(A, 'Your move'); await ttt(A, 2);
  await waitStatus(A, 'You win'); await shot(A, '03-ttt-won');
  check(await A.locator('.d-cell.win').count() === 3, 'the winning line lights up');
  await waitStatus(B, 'wins'); await shot(B, '04-ttt-lost');
  await A.click('.btn.g-go:has-text("Rematch")'); await A.waitForTimeout(1200);
  check((await status(A)).includes('move') && !(await status(A)).startsWith('Your'), 'rematch: B goes first');

  // ================= Checkers =================
  step('Checkers');
  await play(A, 'Checkers'); await A.click('.btn.g-go:has-text("Start")'); await A.waitForSelector('.d-checkers'); await A.waitForTimeout(600);
  check(await A.locator('.d-pc').count() === 24, '24 pieces on the board');
  await shot(A, '05-checkers-start');
  const sq = async (p, i) => { await p.click(`[data-sq="${i}"]`); await p.waitForTimeout(250); };
  await sq(A, 42); check(await A.locator('.d-sq.to').count() === 2, 'a piece shows its two moves');
  await shot(A, '06-checkers-picked');
  await sq(A, 35); await A.waitForTimeout(900);
  await B.waitForSelector('.g-chip.turn:has-text("Checkers")', { timeout: 20000 });
  await openTile(B, 'Checkers'); await shot(B, '07-checkers-B-view');
  check(await B.locator('.d-checkers .d-sq').first().getAttribute('data-sq') === '63', 'B sees the board from their side');
  await sq(B, 21); await sq(B, 28); await B.waitForTimeout(900);
  await waitStatus(A, 'Your move');
  check(await A.locator('.d-hint:has-text("jump")').count() === 1, 'A is told a jump is a must');
  await sq(A, 44); check(await A.locator('.d-sq.to').count() === 0, 'a piece without the jump cannot be picked');
  await sq(A, 35); await sq(A, 21); await A.waitForTimeout(1000);
  check(await A.locator('.d-pc').count() === 23, 'the jump takes a piece');
  await shot(A, '08-checkers-jumped');
  await waitStatus(B, 'Your move'); await sq(B, 14); await sq(B, 28); await B.waitForTimeout(900);
  await waitStatus(A, 'Your move'); check(await A.locator('.d-pc').count() === 22, 'B jumps back');
  await A.click('.g-endgame'); await A.click('.g-endgame'); await A.waitForTimeout(1000);
  check((await status(A)).includes('gave up'), 'giving up ends it');
  await waitStatus(B, 'You win'); check(true, 'B is told they won');

  // ================= Seven Letters =================
  step('Seven Letters');
  await play(A, 'Seven Letters'); await shot(A, '09-words-start');
  await A.click('.seg button:has-text("1 min")'); await A.click('.btn.g-go:has-text("Start")'); await A.waitForSelector('.q-ready'); await A.waitForTimeout(500);
  await shot(A, '10-words-ready');
  await A.click('.btn.g-go:has-text("Start my go")'); await A.waitForSelector('.q-rack'); await A.waitForTimeout(600);
  const rack = (await A.locator('.q-rack .q-tile').allTextContents()).join('').toLowerCase();
  check(rack.length === 7, 'seven letters dealt');
  const mine = DICT.filter(w => fits(w, rack)).sort((x, y) => y.length - x.length).slice(0, 6);
  for (const w of mine) { await A.keyboard.type(w); await A.keyboard.press('Enter'); await A.waitForTimeout(250); }
  await A.keyboard.type('qqq'); await A.keyboard.press('Enter');
  await A.waitForTimeout(300); await shot(A, '11-words-go');
  check(await A.locator('.q-found p span').count() === mine.length, `${mine.length} real words taken, a fake one refused`);
  await A.click('text=I\'m done, hand it in'); await A.waitForSelector('.g-page .g-track'); await A.waitForTimeout(800);
  await B.waitForSelector('.g-chip.turn:has-text("7 Letters")', { timeout: 20000 });
  await openTile(B, '7 Letters');
  check(await B.locator('.g-lock').count() === 1, 'B cannot see A\'s words before playing');
  await B.click('.btn.g-go:has-text("Start my go")'); await B.waitForSelector('.q-rack'); await B.waitForTimeout(500);
  const rackB = (await B.locator('.q-rack .q-tile').allTextContents()).join('').toLowerCase();
  check([...rackB].sort().join('') === [...rack].sort().join(''), 'B gets the same letters');
  for (const w of DICT.filter(x => fits(x, rack) && x.length <= 4).slice(0, 4)) { await B.keyboard.type(w); await B.keyboard.press('Enter'); await B.waitForTimeout(250); }
  await B.click('text=I\'m done, hand it in'); await B.waitForTimeout(2500);
  await shot(B, '12-words-results');
  check(await B.locator('.g-board:has-text("Final scores")').count() === 1, 'final scores once both played');
  check(await B.locator('.q-person').count() >= 2, 'everyone\'s words show');

  // ================= Trivia =================
  step('Trivia');
  await play(A, 'Trivia'); await shot(A, '13-trivia-start');
  await A.click('.chip:has-text("Dance")'); await A.click('.btn.g-go:has-text("Start")'); await A.waitForSelector('.q-ready');
  const answerAll = async (p, i, pickRight) => {
    await p.click('.btn.g-go:has-text("Start my go")'); await p.waitForSelector('.q-opts');
    for (let k = 0; k < 10; k++) {
      await p.waitForSelector('.q-opt:not([disabled])', { timeout: 20000 });
      if (k === 0) await shot(p, `14-${N[i]}-question`);
      await p.locator('.q-opt').nth(pickRight ? 0 : 1).click();
      if (k === 0) { await p.waitForTimeout(300); await shot(p, `15-${N[i]}-answered`); }
      await p.waitForTimeout(1200);
    }
  };
  await answerAll(A, 0, true); await A.waitForSelector('.g-page .g-track', { timeout: 15000 }); await A.waitForTimeout(800);
  await B.waitForSelector('.g-chip.turn:has-text("Trivia")', { timeout: 20000 });
  await openTile(B, 'Trivia'); await answerAll(B, 1, false); await B.waitForTimeout(2500);
  await shot(B, '16-trivia-results');
  check(await B.locator('.g-board:has-text("Final scores")').count() === 1, 'trivia final scores');
  check(await B.locator('.q-review').count() === 10, 'all ten questions reviewed with answers');
  await back(B); await B.waitForTimeout(600); await shot(B, '17-strip');
} catch (e) {
  console.log('STOPPED:', e.message.split('\n')[0]);
  for (const [i, p] of P.entries()) await shot(p, `zz-${N[i]}-stopped`).catch(() => {});
}
console.log('\nchecks:', checks.filter(c => c[0]).length, 'of', checks.length, 'passed');
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();

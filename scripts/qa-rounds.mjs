// Poker Face and Charades Relay, end to end with three fake people and fake cameras:
// a whole Poker Face (three answers, the hidden truth, two votes, the results) and a whole Charades Relay
// (three acts, a wrong guess, right guesses, final scores). Then ALWAYS clean up: node scripts/clean-qa-remote.mjs
// Usage: PW_CHANNEL=chrome node scripts/qa-rounds.mjs [baseUrl]
import { chromium } from 'playwright';
// the room opens on its thread (11-27): the camera opens from the live tile. camFirst opens it before a step
// that uses the camera's own controls (the record button, the rail); it does nothing when the camera is already open.
const camFirst = async p => { if (await p.locator('.chat.in-thread .rec.live-tile').count()) { await p.locator('.rec.live-tile').click(); await p.waitForSelector('.chat.cam-open'); }
  await p.waitForSelector('.chat.cam-live', { timeout: 15000 }).catch(() => {}); };   // round two: the camera sleeps until it opens, so wait for it to be on
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:5188/';
const OUT = 'shots/rounds'; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
// one browser plays every person here and they share one fake camera, which sends no frames to anyone while another
// person's sleeping camera still holds it: each page lets go of the camera fast (a test hook; phones wait 90 s)
{ const nc = b.newContext.bind(b); b.newContext = async (...a) => { const c = await nc(...a); await c.addInitScript(() => { try { localStorage.setItem('holler.releaseMs', '300'); } catch { /* */ } }); return c; }; }
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'] };
const P = await Promise.all([0, 1, 2].map(async () => (await b.newContext(phone)).newPage()));
const [A, B, C] = P; const N = ['A', 'B', 'C'];
const errs = [];
P.forEach((p, i) => {
  p.on('pageerror', e => errs.push(`${N[i]} pageerror: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(`${N[i]} console: ${m.text()}`); });
});
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });
const step = s => console.log('--', s);
const checks = [];
const check = (ok, what) => { checks.push([ok, what]); console.log(ok ? '  ok ' : '  FAIL', what); };
const wait = ms => A.waitForTimeout(ms);
const back = async p => { if (await p.locator('.g-page').count()) await p.click('.g-page .g-back'); await p.waitForTimeout(400); };
const openTile = async (p, name) => { await back(p); await p.locator(`.g-chip:has-text("${name}")`).first().click(); await p.waitForSelector('.g-page'); await p.waitForTimeout(700); };

try {
  step('three people, one chat');
  await A.goto(BASE); await A.fill('#nm', 'ZZTestAvery'); await A.click('text=Let\'s go'); await A.waitForSelector('text=Start a chat');
  await A.click('button:has-text("Start a chat")'); await A.fill('#cn', 'ZZTest Rounds'); await A.click('text=Make it');
  await A.waitForSelector('.code-big'); const code = (await A.textContent('.code-big')).trim(); await A.click('.sheet-head .icon-btn');
  for (const [p, nm] of [[B, 'ZZTestBlake'], [C, 'ZZTestCasey']]) {
    await p.goto(BASE + '#/join/' + code); await p.fill('#nm', nm); await p.click('text=Join the chat'); await p.waitForSelector('.chat-top', { timeout: 15000 });
  }
  await wait(2500);

  // ================= Poker Face =================
  step('A starts Poker Face');
  await A.click('.g-play-tile'); await A.waitForSelector('.g-opt'); await A.waitForTimeout(450); await shot(A, '01-play-sheet');
  check(await A.locator('.g-opt:has-text("Poker Face")').count() === 1 && await A.locator('.g-opt:has-text("Charades Relay")').count() === 1, 'both new games in the Play sheet');
  await A.click('.g-opt:has-text("Poker Face")'); await A.waitForSelector('.g-secret.g-open'); await A.waitForTimeout(450); await shot(A, '02-poker-start');
  const q = (await A.textContent('.g-secret.g-open p')).trim();
  await A.click('.btn.g-go:has-text("Start")'); await A.waitForSelector('.g-banner');
  let truthCount = 0;
  const answer = async (p, i) => {
    await p.waitForSelector('.g-banner'); await p.waitForTimeout(600);
    const truth = await p.locator('.g-secret-mini').count() === 1; if (truth) truthCount++;
    await shot(p, `03-${N[i]}-poker-turn`);
    await camFirst(p); await p.click('.rec'); await p.waitForTimeout(2600); await camFirst(p); await p.click('.rec'); await p.waitForTimeout(7000);
  };
  await answer(A, 0);
  for (const [p, i] of [[B, 1], [C, 2]]) {
    step(`${N[i]} answers`);
    await p.waitForSelector('.g-chip.turn:has-text("Poker Face")', { timeout: 25000 });
    await openTile(p, 'Poker Face'); await shot(p, `04-${N[i]}-poker-page`);
    check((await p.textContent('.g-page .g-secret.g-open p')).trim() === q, `${N[i]} sees the question`);
    await p.click('.g-page .btn.g-go:has-text("Record your answer")');
    await answer(p, i);
  }
  check(truthCount === 1, 'exactly one person was handed the real answer');

  step('voting');
  await wait(4000);
  let votes = 0;
  for (const [p, i] of [[A, 0], [B, 1], [C, 2]]) {
    await openTile(p, 'Poker Face');
    const can = await p.locator('.btn.g-go:has-text("vote")').count();
    if (!can) { await shot(p, `05-${N[i]}-sits-out`); continue; }
    await p.click('.btn.g-go:has-text("vote")'); await p.waitForSelector('.g-rv-vid', { timeout: 15000 }); await p.waitForTimeout(1500); await shot(p, `06-${N[i]}-watching`);
    for (let k = 0; k < 4 && !(await p.locator('.g-pick').count()); k++) { await p.click('.g-rv-skip'); await p.waitForTimeout(900); }
    await p.waitForSelector('.g-pick'); await p.waitForTimeout(600); await shot(p, `07-${N[i]}-pick`);
    await p.locator('.g-pk:not([disabled])').first().click(); await p.click('.btn.g-go:has-text("Lock in")'); await p.waitForTimeout(2500);
    votes++;
    if (await p.locator('.g-reveal').count()) await p.click('.g-rv-x').catch(() => {});
    await p.waitForTimeout(800);
  }
  check(votes === 2, 'two people vote, the truth teller sits out');
  await wait(3000);
  await openTile(A, 'Poker Face'); await A.waitForTimeout(800); await shot(A, '08-A-poker-results');
  check(await A.locator('.g-board:has-text("Final scores")').count() === 1, 'final scores show');
  check(await A.locator('.g-page .g-box.truth').count() === 1, 'the real answer and who had it show');
  await A.click('.btn:has-text("Watch the answers again")'); await A.waitForSelector('.g-rv-vid'); await A.waitForTimeout(1200);
  for (let k = 0; k < 4 && !(await A.locator('.g-pick').count()); k++) { await A.click('.g-rv-skip'); await A.waitForTimeout(700); }
  await A.waitForTimeout(600); await shot(A, '09-A-who-lied');
  check(await A.locator('.g-pk.truth').count() === 1, 'the truth tile is marked');
  await A.click('.g-rv-x'); await back(A);

  // ================= Charades Relay =================
  step('A starts Charades Relay');
  await A.click('.g-play-tile'); await A.click('.g-opt:has-text("Charades Relay")');
  await A.click('.g-seg button:has-text("10 sec")'); await A.waitForTimeout(450); await shot(A, '10-charades-start');
  await A.click('.btn.g-go:has-text("Start")');
  const words = {};
  const actIt = async (p, i) => {
    await p.waitForSelector('.g-word'); await p.click('.g-word .chip'); await p.waitForTimeout(300);
    words[i] = (await p.textContent('.g-word p')).trim(); await shot(p, `11-${N[i]}-act-banner`);
    await camFirst(p); await p.click('.rec'); await p.waitForTimeout(1500);
    check(await p.locator('.g-word .chip').count() === 0, `${N[i]}: no Another word while recording`);
    await p.waitForTimeout(10500);
    check(await p.locator('.g-banner').count() === 0, `${N[i]}: act sent itself at 10 seconds`);
    await p.waitForTimeout(6000);
  };
  await actIt(A, 0);
  for (const [p, i] of [[B, 1], [C, 2]]) {
    await p.waitForSelector('.g-chip.turn:has-text("Charades")', { timeout: 25000 });
    await openTile(p, 'Charades'); await shot(p, `12-${N[i]}-charades-page`);
    await p.click('.g-page .btn.g-go:has-text("Act yours")');
    await actIt(p, i);
  }
  console.log('   words', JSON.stringify(words));

  step('guessing');
  await wait(3000);
  const guess = async (p, i, j, first) => {
    await openTile(p, 'Charades');
    const row = p.locator('.g-row', { hasText: `${['ZZTestAvery', 'ZZTestBlake', 'ZZTestCasey'][j]} acted` });
    await row.locator('.g-row-btn').click(); await p.waitForSelector('.g-know', { timeout: 15000 }); await p.waitForTimeout(1500);
    if (first) await shot(p, `13-${N[i]}-guessing`);
    if (first) {
      await p.click('.g-know'); await p.fill('#g-guess', 'zzz nothing'); await p.waitForTimeout(300); await shot(p, `14-${N[i]}-typing`);
      await p.click('.g-guessbar .btn.g-go'); await p.waitForTimeout(1500);
      check(await p.locator('.g-know').count() === 1, `${N[i]}: wrong guess keeps the clip going`);
    }
    await p.click('.g-know'); await p.fill('#g-guess', words[j].toLowerCase()); await p.click('.g-guessbar .btn.g-go');
    await p.waitForSelector('.g-result', { timeout: 10000 }); await p.waitForTimeout(400);
    if (first) await shot(p, `15-${N[i]}-got-it`);
    check(await p.locator('.g-result.ok').count() === 1, `${N[i]} got ${N[j]}'s word`);
    await p.click('.g-result .btn.g-go'); await p.waitForTimeout(800);
  };
  await guess(B, 1, 0, true);
  await guess(C, 2, 0, false);
  await guess(A, 0, 1, false);
  await guess(C, 2, 1, false);
  await guess(A, 0, 2, false);
  await openTile(B, 'Charades'); await shot(B, '16-B-before-last');
  check(await B.locator('.g-board:has-text("Scores so far")').count() === 1, 'live scores during the game');
  await guess(B, 1, 2, false);
  await wait(2500);
  await openTile(A, 'Charades'); await A.waitForTimeout(800); await shot(A, '17-A-final');
  check(await A.locator('.g-board:has-text("Final scores")').count() === 1, 'charades final scores');
  check(await A.locator('.g-board-row').count() === 3, 'three people on the board');
} catch (e) {
  console.log('STOPPED:', e.message.split('\n')[0]);
  for (const [i, p] of P.entries()) await shot(p, `zz-${N[i]}-stopped`).catch(() => {});
}
console.log('\nchecks:', checks.filter(c => c[0]).length, 'of', checks.length, 'passed');
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();

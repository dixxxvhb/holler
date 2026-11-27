// Holler Play, end to end with three fake people and fake cameras: a card and an answer (the stack),
// Film my reaction (sent, then played back in sync), and a whole game of Pass It On (act, one look, copy,
// guess, reveal, save). Then ALWAYS clean up: node scripts/clean-qa.mjs on the PC, or clean-qa-remote.mjs anywhere.
// Usage: node scripts/qa-play.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:5188/';
const OUT = 'shots/play'; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'] };
const [A, B, C] = await Promise.all([0, 1, 2].map(async () => (await b.newContext(phone)).newPage()));
const errs = [];
for (const [n, p] of [['A', A], ['B', B], ['C', C]]) {
  p.on('pageerror', e => errs.push(`${n} pageerror: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(`${n} console: ${m.text()}`); });
}
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });
const step = s => console.log('--', s);
const checks = [];
const check = (ok, what) => { checks.push([ok, what]); console.log(ok ? '  ok ' : '  FAIL', what); };
const send = async (p, ms = 2200) => { await p.click('.rec'); await p.waitForTimeout(ms); await p.click('.rec'); };

try {
  step('three people, one chat');
  await A.goto(BASE); await A.fill('#nm', 'ZZTestAvery'); await A.click('text=Let\'s go'); await A.waitForSelector('text=Start a chat');
  await A.click('button:has-text("Start a chat")'); await A.fill('#cn', 'ZZTest Play'); await A.click('text=Make it');
  await A.waitForSelector('.code-big'); const code = (await A.textContent('.code-big')).trim(); await A.click('.sheet-head .icon-btn');
  for (const [p, nm] of [[B, 'ZZTestBlake'], [C, 'ZZTestCasey']]) {
    await p.goto(BASE + '#/join/' + code); await p.fill('#nm', nm); await p.click('text=Join the chat'); await p.waitForSelector('.chat-top', { timeout: 15000 });
  }
  await A.waitForTimeout(2500);
  check(await A.locator('.g-play-tile').count() === 1, 'Play button beside the record button');
  await shot(A, '01-strip-play-tile');

  step('A records with a card');
  await A.click('.g-play-tile'); await A.waitForSelector('.g-opt'); await A.waitForTimeout(450); await shot(A, '02-play-sheet');
  await A.click('.g-opt:has-text("Give me a card")');
  await A.waitForSelector('.g-cardtools'); await A.waitForTimeout(600); await shot(A, '03-card-on');
  await A.click('.g-cardtools .chip:has-text("Guess")'); await A.waitForTimeout(300);
  await send(A); await A.waitForTimeout(6000);
  await shot(A, '04-card-sent');

  step('B answers the card');
  await B.waitForSelector('.new-pill', { timeout: 20000 }); await B.click('.new-pill', { force: true });
  await B.waitForSelector('.g-cardans'); await B.waitForTimeout(450); await shot(B, '05-B-answer-card');
  await B.click('.g-cardans'); await B.waitForTimeout(800);
  check(await B.locator('.rail-btn:has-text("Card")').count() === 1, 'answering puts the same card on');
  await send(B); await B.waitForTimeout(7000);
  await A.waitForTimeout(3000);
  check(await A.locator('.g-stack').count() === 1, 'two answers stack into one tile');
  await shot(A, '06-A-stack');

  step('C films a reaction to A\'s card holler');
  await C.waitForSelector('.new-pill', { timeout: 20000 }); await C.click('.new-pill', { force: true });
  await C.waitForSelector('.g-film'); await C.click('.g-film');
  await C.waitForTimeout(1200); await shot(C, '07-C-filming');
  check(await C.locator('.g-face').count() === 1, 'live face shows while filming');
  await C.waitForSelector('.g-after', { timeout: 20000 }); await shot(C, '08-C-after-end');
  await C.click('.g-after .btn'); await C.waitForSelector('.g-review'); await C.waitForTimeout(800); await shot(C, '09-C-review');
  await C.click('.g-review .btn.primary'); await C.waitForTimeout(500);
  await C.keyboard.press('Escape'); await C.waitForTimeout(8000);
  await A.waitForTimeout(4000);
  check(await A.locator('.g-tile-pip').count() >= 1, 'reaction tile shows the original in the corner');
  await shot(A, '10-A-reaction-tile');
  await A.locator('.tile:has(.g-tile-pip)').first().click(); await A.waitForTimeout(2500);
  check(await A.locator('.player .g-pip').count() === 1, 'reaction plays with the original small');
  await shot(A, '11-A-reaction-playing'); await A.keyboard.press('Escape'); await A.waitForTimeout(500);

  step('Pass It On: A starts and acts');
  await A.click('.g-play-tile'); await A.click('.g-opt:has-text("Pass It On")');
  await A.waitForSelector('.g-secret'); await A.click('.g-seg button:has-text("5 sec")'); await A.waitForTimeout(450); await shot(A, '12-start-sheet');
  await A.click('.btn.g-go:has-text("Start")'); await A.waitForSelector('.g-banner'); await shot(A, '13-A-turn');
  check(await A.locator('.g-secret-mini').count() === 1, 'starter sees the phrase over the camera');
  await A.click('.rec'); await A.waitForTimeout(2500); await shot(A, '14-A-acting');
  await A.waitForTimeout(5000);
  check(await A.locator('.g-banner').count() === 0, 'turn sent itself at 5 seconds');
  await A.waitForTimeout(6000); await shot(A, '15-A-after-turn');

  for (let k = 0; k < 2; k++) {
    // the order after the starter is shuffled, so find whoever is up
    let p = null, n = '';
    for (let w = 0; w < 40 && !p; w++) {
      for (const [q, m] of [[B, 'B'], [C, 'C']]) if (await q.locator('.g-tile.turn').count()) { p = q; n = m; }
      if (!p) await A.waitForTimeout(1000);
    }
    if (!p) throw new Error('nobody got the next turn');
    const role = k === 0 ? 'copy' : 'guess';
    step(`${n} takes a turn (${role})`);
    await shot(p, `16-${n}-your-turn`);
    await p.click('.g-tile.turn'); await p.waitForSelector('.g-page'); await p.waitForTimeout(450); await shot(p, `17-${n}-game-page`);
    check(await p.locator('.g-lock').count() >= 1, `${n}: earlier clips are locked`);
    await p.click('.g-page .btn.g-go'); await p.waitForSelector('.g-look-card'); await p.waitForTimeout(450); await shot(p, `18-${n}-one-look`);
    await p.click('.g-bigplay'); await p.waitForTimeout(1200); await shot(p, `18b-${n}-looking`);
    await p.waitForSelector('.g-banner', { timeout: 30000 }); await shot(p, `18c-${n}-copy-banner`);
    await p.click('.rec'); await p.waitForTimeout(6500);
    if (role === 'guess') {
      await p.waitForSelector('#g-guess'); await p.fill('#g-guess', 'a ghost buying jeans'); await shot(p, `19-${n}-guess`);
      await p.click('.btn.g-go:has-text("Send guess")');
    }
    await p.waitForTimeout(8000);
  }

  step('the reveal');
  await A.waitForTimeout(3000);
  await A.waitForSelector('.g-tile.over', { timeout: 30000 }); await shot(A, '20-A-reveal-tile');
  await A.click('.g-tile.over'); await A.waitForSelector('.g-rv-vid', { timeout: 15000 }); await A.waitForTimeout(1500); await shot(A, '21-A-reel');
  check(await A.locator('.g-rv-bars i').count() === 3, 'reel has three clips');
  await A.waitForSelector('.g-end', { timeout: 40000 }); await A.waitForTimeout(3000); await shot(A, '22-A-end');
  check((await A.textContent('.g-box:not(.truth) p'))?.includes('ghost buying jeans'), 'guess shows next to the phrase');
  await A.click('.g-end .btn:has-text("Save the reel")'); await A.waitForTimeout(1200);
  check(await A.locator('.g-end .btn:has-text("Reel saved")').count() === 1, 'reel saved');
  await shot(A, '23-A-saved');
} catch (e) {
  console.log('STOPPED:', e.message.split('\n')[0]);
  for (const [n, p] of [['A', A], ['B', B], ['C', C]]) await shot(p, `zz-${n}-stopped`).catch(() => {});
}
console.log('\nchecks:', checks.filter(c => c[0]).length, 'of', checks.length, 'passed');
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();

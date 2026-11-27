// Last Card end to end with three fake people: deal, hidden hands, turns passing, draws, wilds, the Last card
// call, a winner, everyone's leftover cards, then a 2-person game and leaving it. Then ALWAYS clean up:
// node scripts/clean-qa-remote.mjs
// Usage: PW_CHANNEL=chrome node scripts/qa-cards.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:5188/';
const OUT = 'shots/cards'; mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'] };
const P = await Promise.all([0, 1, 2].map(async () => (await b.newContext(phone)).newPage()));
const [A, B, C] = P; const N = ['A', 'B', 'C'];
const errs = [];
P.forEach((p, i) => {
  p.on('pageerror', e => errs.push(`${N[i]} pageerror: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(`${N[i]} console: ${m.text()}`); });
});
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
const step = s => console.log('--', s);
const checks = [];
const check = (ok, what) => { checks.push([ok, what]); console.log(ok ? '  ok ' : '  FAIL', what); };
const back = async p => { while (await p.locator('.g-page .g-back').count()) { await p.click('.g-page .g-back'); await p.waitForTimeout(400); } };
const openTile = async (p, nth = 0) => { await back(p); await p.locator('.g-chip:has-text("Last Card")').nth(nth).click(); await p.waitForSelector('.lc-page'); await p.waitForTimeout(700); };
const status = p => p.textContent('.d-status').then(t => t.trim());
const hand = p => p.$$eval('.lc-hand .lc-card', els => els.map(e => e.dataset.card));

/** Take one turn for whoever's page this is: play the first card that fits (calling Last card at two), else draw. */
async function turn(p, who, shots) {
  const cards = await hand(p);
  if (cards.length === 2 && await p.locator('.lc-call').count()) { await p.click('.lc-call'); await p.waitForTimeout(150); }
  const ok = p.locator('.lc-hand .lc-card.ok');
  if (await ok.count()) {
    await ok.first().click(); await p.waitForTimeout(250);
    if (await p.locator('.lc-color').count()) { if (shots.wild++ === 0) await shot(p, `05-${who}-wild-colors`); await p.locator('.lc-color').first().click(); }
    return 'play';
  }
  await p.click('.lc-deck'); await p.waitForTimeout(1200);
  if (await p.locator('.g-row-btns .btn.g-go:has-text("Play")').count()) {
    if (shots.drawn++ === 0) await shot(p, `06-${who}-drew-a-fit`);
    await p.click('.g-row-btns .btn.g-go'); await p.waitForTimeout(250);
    if (await p.locator('.lc-color').count()) await p.locator('.lc-color').first().click();
    return 'drew-play';
  }
  return 'drew';
}

try {
  step('three people, one chat');
  await A.goto(BASE); await A.fill('#nm', 'ZZTestAvery'); await A.click('text=Let\'s go'); await A.waitForSelector('text=Start a chat');
  await A.click('button:has-text("Start a chat")'); await A.fill('#cn', 'ZZTest Cards'); await A.click('text=Make it');
  await A.waitForSelector('.code-big'); const code = (await A.textContent('.code-big')).trim(); await A.click('.sheet-head .icon-btn');
  for (const [p, nm] of [[B, 'ZZTestBlake'], [C, 'ZZTestCasey']]) {
    await p.goto(BASE + '#/join/' + code); await p.fill('#nm', nm); await p.click('text=Join the chat'); await p.waitForSelector('.chat-top', { timeout: 15000 });
  }
  await A.waitForTimeout(2500);

  step('Play sheet and deal');
  await A.click('.g-play-tile'); await A.waitForSelector('.g-opt'); await A.waitForTimeout(450);
  const opt = A.locator('.g-opt').filter({ has: A.locator('b:text-is("Last Card")') });
  check(await opt.count() === 1, 'Last Card in the Play sheet');
  await opt.scrollIntoViewIfNeeded(); await shot(A, '01-play-sheet');
  await opt.click(); await A.waitForTimeout(500); await shot(A, '02-start');
  check(await A.locator('.sheet .chip.on').count() === 3, 'everyone is in by default');
  await A.click('.btn.g-go:has-text("Deal")'); await A.waitForSelector('.lc-page'); await A.waitForTimeout(900);
  check((await hand(A)).length === 7, 'seven cards dealt');
  check(await status(A) === 'Your turn', 'the dealer goes first');
  check(await A.locator('.lc-seat').count() === 3, 'three seats');
  await shot(A, '03-A-table');
  await B.waitForSelector('.g-chip:has-text("Last Card")', { timeout: 20000 }); await openTile(B);
  const hb = await hand(B); check(hb.length === 7, 'B has seven too');
  check(JSON.stringify(hb) !== JSON.stringify(await hand(A)), 'B sees their own hand, not A\'s');
  check(await B.locator('.lc-deck:disabled').count() === 1, 'B cannot draw on A\'s turn');
  await shot(B, '04-B-waiting');
  await C.waitForSelector('.g-chip:has-text("Last Card")', { timeout: 20000 }); await openTile(C);

  step('play it out');
  const pages = { A, B, C };
  const shots = { wild: 0, drawn: 0 };
  let moves = 0, plays = 0, draws = 0, lastWho = '', winner = null;
  for (; moves < 160; moves++) {
    let up = null;
    for (const k of Object.keys(pages)) { if (await pages[k].locator('.d-status.mine').count()) { up = k; break; } }
    if (!up) {
      if (await A.locator('.d-status:has-text("won")').count()) { winner = (await status(A)); break; }
      await A.waitForTimeout(800); continue;
    }
    const r = await turn(pages[up], up, shots);
    if (r === 'play' || r === 'drew-play') plays++; else draws++;
    lastWho = up;
    // wait for everyone to see the move
    await pages[up].waitForTimeout(900);
    if (await pages[up].locator('.d-status:has-text("won")').count()) { winner = await status(pages[up]); break; }
    if (moves === 4) { for (const k of Object.keys(pages)) await shot(pages[k], `07-${k}-mid`); }
  }
  console.log(`  (${moves} turns: ${plays} plays, ${draws} draws; ${winner || 'no winner yet'})`);
  check(plays > 3 && draws >= 0, 'turns went round with real plays');
  check(!!winner, 'someone ran out of cards and won');
  if (winner) {
    for (const k of Object.keys(pages)) { await pages[k].waitForTimeout(1500); await shot(pages[k], `08-${k}-end`); }
    check(await A.locator('.lc-left-row').count() >= 1, 'everyone\'s leftover cards show at the end');
    check(await A.locator('.btn.g-go:has-text("Deal again")').count() === 1, 'deal again offered');
  }
  const logTxt = await A.locator('.lc-page').textContent();
  check(/played|drew/.test(logTxt), 'the table says what happened');

  step('stacking on');
  await back(A); await A.click('.g-play-tile'); await A.waitForSelector('.g-opt'); await A.waitForTimeout(450);
  await A.locator('.g-opt').filter({ has: A.locator('b:text-is("Last Card")') }).click(); await A.waitForTimeout(500);
  check(await A.locator('.sheet .lbl:text-is("Stacking")').count() === 1, 'stacking choice in the deal sheet');
  await A.locator('.sheet .seg button:text-is("On")').click(); await A.waitForTimeout(200); await shot(A, '11-stack-start');
  await A.click('.btn.g-go:has-text("Deal")'); await A.waitForSelector('.lc-page'); await A.waitForTimeout(900);
  check((await A.textContent('.g-foot')).includes('Stacking is on'), 'the table says stacking is on');
  for (const p of [B, C]) {
    await back(p); await p.waitForSelector('.g-chip:not(.over):has-text("Last Card")', { timeout: 20000 });
    await p.locator('.g-chip:not(.over):has-text("Last Card")').first().click(); await p.waitForSelector('.lc-page'); await p.waitForTimeout(700);
  }
  let sawOwe = 0, sawTake = false, sawStacked = false, won2 = null;
  for (let m = 0; m < 200; m++) {
    let up = null;
    for (const k of Object.keys(pages)) { if (await pages[k].locator('.d-status.mine').count()) { up = k; break; } }
    if (!up) { if (await A.locator('.d-status:has-text("won")').count()) { won2 = await status(A); break; } await A.waitForTimeout(800); continue; }
    const p = pages[up];
    if (await p.locator('.lc-owe').count()) {
      if (!sawOwe++) await shot(p, `12-${up}-stacked-on-me`);
      const st = await status(p); if (!st.startsWith('Stack or take')) check(false, 'status says stack or take: ' + st);
    }
    await turn(p, up, shots); await p.waitForTimeout(900);
    const txt = await p.locator('.lc-page').textContent();
    if (/took the stack/.test(txt)) sawTake = true;
    if (/is stacked on/.test(txt)) sawStacked = true;
    if (await p.locator('.d-status:has-text("won")').count()) { won2 = await status(p); break; }
  }
  console.log(`  (stacks waited on someone ${sawOwe} times; ${won2 || 'no winner'})`);
  check(sawOwe > 0 && sawStacked, 'a Draw card waited as a stack instead of hitting straight away');
  check(sawTake, 'someone took a stack');
  check(!!won2, 'the stacking game finished');

  step('two people, then one leaves');
  await back(A); await A.click('.g-play-tile'); await A.waitForSelector('.g-opt'); await A.waitForTimeout(450);
  await A.locator('.g-opt').filter({ has: A.locator('b:text-is("Last Card")') }).click(); await A.waitForTimeout(500);
  await A.locator('.sheet .g-order-tools button.chip:has-text("ZZTestCasey")').click();
  await A.click('.btn.g-go:has-text("Deal")'); await A.waitForSelector('.lc-page'); await A.waitForTimeout(800);
  check(await A.locator('.lc-seat').count() === 2, 'a two-person game');
  await A.click('.g-endgame'); await A.click('.g-endgame'); await A.waitForTimeout(1500);
  check((await status(A)).includes('won'), 'leaving a 2-person game hands the other person the win');
  await shot(A, '09-left');
  await back(A); await A.waitForTimeout(500); await shot(A, '10-strip');
} catch (e) {
  console.log('STOPPED:', e.message.split('\n')[0]);
  for (const [i, p] of P.entries()) await shot(p, `zz-${N[i]}-stopped`).catch(() => {});
}
console.log('\nchecks:', checks.filter(c => c[0]).length, 'of', checks.length, 'passed');
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();

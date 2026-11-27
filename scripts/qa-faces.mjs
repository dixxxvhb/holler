// On The Spot and Don't Laugh, end to end with two fake people and fake cameras: both take an On The Spot go
// (questions appear only once recording starts, three taps, the clip sends itself), watch and see the answers;
// both record a Don't Laugh clip, one cracks (the I laughed button, since a fake camera has no face), one holds
// a straight face to the end, and the scores and faces show. Then ALWAYS: node scripts/clean-qa-remote.mjs
// Usage: PW_CHANNEL=chrome node scripts/qa-faces.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:5190/';
const OUT = 'shots/faces'; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
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
const openTile = async (p, name) => { await back(p); await p.locator(`.g-chip:has-text("${name}")`).first().click(); await p.waitForSelector('.g-page'); await p.waitForTimeout(900); };
const play = async (p, name) => { await back(p); await p.click('.g-play-tile'); await p.waitForSelector('.g-opt'); await p.waitForTimeout(450); await p.locator('.g-opt').filter({ has: p.locator(`b:text-is("${name}")`) }).click(); await p.waitForTimeout(500); };

const spotGo = async (p, i) => {
  await p.waitForSelector('.g-banner:has-text("Three questions")'); await shot(p, `02-${N[i]}-spot-ready`);
  check(await p.locator('.spot-opt').count() === 0, `${N[i]}: no question before recording`);
  await p.click('.rec');
  await p.waitForSelector('.spot-opt', { timeout: 15000 }); await p.waitForTimeout(1200); await shot(p, `03-${N[i]}-spot-q1`);
  for (let k = 0; k < 3; k++) {
    await p.waitForSelector('.spot-opt:not([disabled])', { timeout: 15000 });
    await p.locator('.spot-opt').nth(k % 4).click(); await p.waitForTimeout(1100);
  }
  await p.waitForTimeout(6000);
};

try {
  step('two people, one chat');
  await A.goto(BASE); await A.fill('#nm', 'ZZTestAvery'); await A.click('text=Let\'s go'); await A.waitForSelector('text=Start a chat');
  await A.click('button:has-text("Start a chat")'); await A.fill('#cn', 'ZZTest Faces'); await A.click('text=Make it');
  await A.waitForSelector('.code-big'); const code = (await A.textContent('.code-big')).trim(); await A.click('.sheet-head .icon-btn');
  await B.goto(BASE + '#/join/' + code); await B.fill('#nm', 'ZZTestBlake'); await B.click('text=Join the chat'); await B.waitForSelector('.chat-top', { timeout: 15000 });
  await A.waitForTimeout(2500);

  // ================= On The Spot =================
  step('On The Spot');
  await A.click('.g-play-tile'); await A.waitForSelector('.g-opt'); await A.waitForTimeout(450);
  check(await A.locator('.g-opt:has-text("On The Spot")').count() === 1 && await A.locator('.g-opt:has-text("Don\'t Laugh")').count() === 1, 'both new games in the Play sheet');
  await shot(A, '01-play-sheet');
  await A.click('.g-opt:has-text("On The Spot")'); await A.waitForTimeout(400);
  await A.click('.btn.g-go:has-text("Start")');
  await spotGo(A, 0);
  await B.waitForSelector('.g-chip.turn:has-text("On The Spot")', { timeout: 25000 });
  await openTile(B, 'On The Spot'); await shot(B, '04-B-spot-page');
  check(await B.locator('.g-row:has-text("ZZTestAvery") .btn:has-text("Watch")').count() === 1, 'B can watch A before going');
  await B.click('.btn.g-go:has-text("Take my go")');
  await spotGo(B, 1);
  await openTile(A, 'On The Spot'); await A.waitForTimeout(1500); await shot(A, '05-A-spot-done');
  check(await A.locator('.g-board:has-text("Final scores")').count() === 1, 'spot final scores');
  await A.locator('.g-row:has-text("ZZTestBlake") .btn:has-text("Watch")').click();
  await A.waitForSelector('.g-rv-vid'); await A.waitForTimeout(2500); await shot(A, '06-A-watching-B');
  await A.click('.g-rv-skip'); await A.waitForSelector('.spot-rev'); await A.waitForTimeout(400); await shot(A, '07-A-spot-answers');
  check(await A.locator('.spot-rev').count() === 3, 'three answers revealed');
  await A.click('.g-rv-x');

  // ================= Don't Laugh =================
  step('Don\'t Laugh');
  await play(A, 'Don\'t Laugh'); await A.click('.seg button:has-text("10 sec")'); await shot(A, '08-laugh-start');
  await A.click('.btn.g-go:has-text("Start")');
  await A.waitForSelector('.g-banner:has-text("Make them laugh")'); await shot(A, '09-A-laugh-turn');
  await A.click('.rec'); await A.waitForTimeout(13000);
  await B.waitForSelector('.g-chip.turn:has-text("Don\'t Laugh")', { timeout: 25000 });
  await openTile(B, 'Don\'t Laugh'); await B.click('.btn.g-go:has-text("Record mine")');
  await B.waitForSelector('.g-banner:has-text("Make them laugh")'); await B.click('.rec'); await B.waitForTimeout(13000);
  await openTile(B, 'Don\'t Laugh'); await shot(B, '10-B-laugh-page');
  step('B watches A\'s and holds it');
  await B.locator('.g-row:has-text("ZZTestAvery") .btn:has-text("Watch")').click();
  await B.waitForSelector('.l-ready'); await shot(B, '11-B-ready');
  await B.click('.l-ready .btn.g-go'); await B.waitForSelector('.l-gave', { timeout: 30000 }); await B.waitForTimeout(3000); await shot(B, '12-B-watching');
  await B.waitForSelector('.l-done', { timeout: 30000 }); await B.waitForTimeout(500); await shot(B, '13-B-straight-face');
  check(await B.locator('.l-done:has-text("Straight face")').count() === 1, 'a straight face to the end');
  await B.click('.l-done .btn.g-go');
  step('A watches B\'s and cracks');
  await openTile(A, 'Don\'t Laugh');
  await A.locator('.g-row:has-text("ZZTestBlake") .btn:has-text("Watch")').click();
  await A.waitForSelector('.l-ready'); await A.click('.l-ready .btn.g-go'); await A.waitForSelector('.l-gave', { timeout: 30000 });
  await A.waitForTimeout(2000); await A.click('.l-gave');
  await A.waitForSelector('.l-done', { timeout: 15000 }); await A.waitForTimeout(2500); await shot(A, '14-A-cracked');
  check(await A.locator('.l-done:has-text("You cracked")').count() === 1, 'cracking is caught');
  await A.click('.l-done .btn.g-go'); await A.waitForTimeout(6000);
  await openTile(A, 'Don\'t Laugh'); await A.waitForTimeout(1500); await shot(A, '15-A-laugh-final');
  check(await A.locator('.g-board:has-text("Final scores")').count() === 1, 'laugh final scores');
  check(await A.locator('.l-face.cracked').count() === 1 && await A.locator('.l-face').count() === 2, 'who cracked and who held it show');
  const faceClips = await A.locator('.l-face:not([disabled])').count();
  check(faceClips >= 1, `face clips arrived (${faceClips} of 2)`);
} catch (e) {
  console.log('STOPPED:', e.message.split('\n')[0]);
  for (const [i, p] of P.entries()) await shot(p, `zz-${N[i]}-stopped`).catch(() => {});
}
console.log('\nchecks:', checks.filter(c => c[0]).length, 'of', checks.length, 'passed');
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();

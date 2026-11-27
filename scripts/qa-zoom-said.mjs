// Zoom In and Who Said It, end to end with three fake people on iPhone-sized fake phones (Avery, Blake, and a
// Notes-mode phone with no camera). Zoom In: two film (typed answer, 5 s clip), the third joins as a guesser; the
// answer stays out of every holler and every payload until you've guessed; I know it stops the pull-out; Yes scores
// by the thirds rule; wrong guesses show only after you've done a clip; the end shows answers and guesses.
// Who Said It: everyone writes two, each matches the answers about themselves (prompts about others are skipped at
// 3 people), scores and fooled points add up, the end shows every prompt with its writers.
// Usage: PW_CHANNEL=chrome node scripts/qa-zoom-said.mjs [baseUrl]  -> shots/zoom-said/*.png
// Then ALWAYS clean the QA people (the batched cleaner the brief names).
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'fs';
const BASE = process.argv[2] || 'http://localhost:5188/';
const OUT = 'shots/zoom-said'; mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').trim().split(/\r?\n/).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const rpc = async (fn, body) => {
  const r = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(fn + ' ' + JSON.stringify(j)); return j;
};
const checks = [];
const check = (ok, what, extra = '') => { checks.push([!!ok, what]); console.log(ok ? '  ok  ' : '  FAIL', what, extra); };
const step = s => console.log('--', s);
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const errs = [];
const mk = async (name, notes) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'], userAgent: UA });
  await ctx.addInitScript(n => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    const put = () => { const s = document.createElement('style'); s.textContent = ':root{--safe-t:47px!important;--safe-b:34px!important}'; document.documentElement.appendChild(s); };
    if (document.documentElement) put(); else addEventListener('DOMContentLoaded', put);
    if (n) try { localStorage.setItem('holler.cam', 'off'); } catch { /* */ }
  }, notes);
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(`${name} pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|NotAllowedError/.test(m.text())) errs.push(`${name} console: ${m.text()}`); });
  return page;
};
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const back = async p => { while (await p.locator('.g-page .g-back').count()) { await p.locator('.g-page .g-back').first().click(); await p.waitForTimeout(400); } };
const openChip = async (p, name) => { await back(p); await p.locator(`.g-chip:has-text("${name}")`).first().click(); await p.waitForSelector('.g-page'); await p.waitForTimeout(1200); };
const until = async (f, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f(); if (v) return v; await new Promise(r => setTimeout(r, 800)); } return null; };
const scaleOf = async p => Number((await p.$eval('.z-vid', v => v.style.transform)).replace(/[^0-9.]/g, ''));

const A = await mk('A'), B = await mk('B'), C = await mk('C', true);
try {
  step('three people, one chat');
  await A.goto(BASE); await A.fill('#nm', 'Avery QA'); await A.click("text=Let's go");
  await A.click('button:has-text("Start a chat")'); await A.fill('#cn', 'QA Zoom Said'); await A.click('text=Make it');
  await A.waitForSelector('.code-big'); const code = (await A.textContent('.code-big')).trim(); await A.click('.sheet-head .icon-btn');
  await B.goto(BASE + '#/join/' + code); await B.fill('#nm', 'Blake QA'); await B.click('text=Join the chat'); await B.waitForSelector('.chat-top', { timeout: 15000 });
  await C.goto(BASE + '#/join/' + code); await C.fill('#nm', 'QA Bot'); await C.click('text=Join the chat'); await C.waitForSelector('.chat-top', { timeout: 15000 });
  const tok = {}; for (const [k, p] of [['A', A], ['B', B], ['C', C]]) tok[k] = await p.evaluate(() => localStorage.getItem('holler.token'));
  const home = await rpc('holler_home', { p_token: tok.A }); const chat = home.chats[0].id;
  const ids = {}; for (const k of ['A', 'B', 'C']) ids[k] = (await rpc('holler_home', { p_token: tok[k] })).me.id;
  check(await C.isVisible('.notes-mode'), 'C is a Notes-mode phone');
  await A.waitForTimeout(2500);

  // ================= Zoom In =================
  step('Zoom In: Avery starts and films');
  await A.click('.g-play-tile'); await A.waitForSelector('.g-opt'); await A.waitForTimeout(450);
  check(await A.locator('.g-opt:has(b:text-is("Zoom In"))').count() === 1 && await A.locator('.g-opt:has(b:text-is("Who Said It"))').count() === 1, 'both games in the Play sheet');
  await A.locator('.g-opt:has(b:text-is("Zoom In"))').click(); await A.waitForTimeout(500);
  await A.click('.sheet .btn.g-go:has-text("Start")');
  await A.waitForSelector('.g-page .z-film'); await A.waitForTimeout(500);
  await shot(A, '00-zoom-film-form');
  const zg = (await rpc('holler_chat', { p_token: tok.A, p_chat: chat })).games.find(g => g.kind === 'zoom'); const zid = zg.id;
  await A.fill('#z-word', 'the kettle'); await A.click('.z-film .btn.g-go');
  await A.waitForSelector('.z-target'); await A.waitForTimeout(1200);
  check(await A.isVisible('.g-banner:has-text("in the middle")') && await A.isVisible('.g-secret-mini:has-text("the kettle")'), 'recorder shows the line and your secret');
  await shot(A, '01-zoom-recorder-target');
  await A.click('button.rec'); await A.waitForTimeout(1500);
  check(await A.isVisible('.rec-hint:has-text("Sends itself at 5 seconds")'), 'fixed 5 second clip');
  const aIn = await until(async () => (await rpc('holler_game', { p_token: tok.A, p_game: zid })).filmed?.includes(ids.A), 40000);
  check(aIn, 'Avery\'s clip landed');
  const chatB0 = await rpc('holler_chat', { p_token: tok.B, p_chat: chat });
  const chatC0 = await rpc('holler_chat', { p_token: tok.C, p_chat: chat });
  check(!JSON.stringify(chatB0).includes('kettle') && !JSON.stringify(chatC0).includes('kettle'), 'answer not in anyone else\'s chat payload');
  const own = (await rpc('holler_game', { p_token: tok.A, p_game: zid })).shots[0];
  check(own.answer === 'the kettle' && own.clip && !('word' in (own.clip.effects?.game || {})) && !JSON.stringify(own.clip.effects).includes('kettle'), 'answer kept off the holler\'s effects');
  check(!chatB0.polos.some(p => p.game === zid), 'the clip is not in the strip');

  step('Blake films; dock marks his go');
  await B.waitForSelector('.g-chip.turn:has-text("Zoom In")', { timeout: 25000 });
  check(await B.locator('.g-chip.turn:has-text("Zoom In") em:has-text("Film yours")').count() === 1, 'Blake\'s dock says Film yours');
  await openChip(B, 'Zoom In');
  await B.fill('#z-word', 'my left shoe'); await B.click('.z-film .btn.g-go'); await B.waitForSelector('.z-target');
  await B.click('button.rec');
  check(await until(async () => (await rpc('holler_game', { p_token: tok.B, p_game: zid })).filmed?.includes(ids.B), 40000), 'Blake\'s clip landed');

  step('the Notes phone joins as a guesser');
  await C.waitForSelector('.g-chip.turn:has-text("Zoom In")', { timeout: 25000 });
  await openChip(C, 'Zoom In');
  check(await C.isVisible('.q-ready:has-text("No camera on this phone")'), 'Notes phone is offered Join as a guesser');
  await C.click('.q-ready .btn.g-go:has-text("Join as a guesser")'); await C.waitForTimeout(1500);
  check((await rpc('holler_game', { p_token: tok.C, p_game: zid })).skipped?.includes(ids.C), 'C is in as a guesser');
  check(!JSON.stringify(await rpc('holler_chat', { p_token: tok.C, p_chat: chat })).includes('kettle'), 'still no answer for C before guessing');

  step('C guesses Avery\'s, mid pull-out, and misses');
  await C.locator('.z-row:has-text("Avery") .btn.g-go').click();
  await C.waitForSelector('.z-ready .btn.g-go:not([disabled])', { timeout: 20000 }); await shot(C, '01b-zoom-ready'); await C.click('.z-ready .btn.g-go');
  await C.waitForSelector('.g-know'); await C.waitForTimeout(3500);
  const s1 = await scaleOf(C);
  await shot(C, '02-zoom-guess-pullout');
  check(s1 > 2 && s1 < 8, 'pulling out from 8x', `scale ${s1}`);
  await C.click('.g-know'); const s2 = await scaleOf(C); await C.waitForTimeout(1500); const s3 = await scaleOf(C);
  check(Math.abs(s2 - s3) < 0.01, 'I know it stops the zoom', `${s2} then ${s3}`);
  await C.fill('#z-guess', 'a teapot'); await C.click('.g-guessbar .btn.g-go');
  await C.waitForSelector('.z-result:has-text("the kettle")', { timeout: 15000 });
  await C.click('.z-result .btn:has-text("No")'); await C.waitForTimeout(1500);
  await C.click('.z-result .btn:has-text("Done")'); await C.waitForTimeout(500);
  const bBefore = (await rpc('holler_game', { p_token: tok.B, p_game: zid })).shots.find(s => s.who === ids.A);
  check(bBefore.guesses === null && bBefore.answer === null, 'Blake cannot see C\'s guess before guessing');

  step('Blake guesses Avery\'s early and gets it');
  await openChip(B, 'Zoom In');
  await B.locator('.z-row:has-text("Avery") .btn.g-go').click();
  await B.waitForSelector('.z-ready .btn.g-go:not([disabled])', { timeout: 20000 }); await B.click('.z-ready .btn.g-go');
  await B.waitForSelector('.g-know'); await B.waitForTimeout(2000); await B.click('.g-know');
  await B.fill('#z-guess', 'kettle'); await B.click('.g-guessbar .btn.g-go');
  await B.waitForSelector('.z-result:has-text("the kettle")', { timeout: 15000 }); await B.waitForTimeout(1200);
  check(await B.isVisible('.z-others .z-g:has-text("a teapot")'), 'after guessing, Blake sees C\'s wrong guess');
  await shot(B, '03-zoom-reveal-guesses');
  await B.click('.z-result .btn:has-text("Yes")'); await B.waitForSelector('.z-you:has-text("+3")', { timeout: 10000 });
  check(true, 'Yes early scores 3');
  await B.click('.z-result .btn:has-text("Done")');

  step('Avery guesses Blake\'s in the middle third, C waits it all out');
  await openChip(A, 'Zoom In');
  await A.locator('.z-row:has-text("Blake") .btn.g-go').click();
  await A.waitForSelector('.z-ready .btn.g-go:not([disabled])', { timeout: 20000 }); await A.click('.z-ready .btn.g-go');
  await A.waitForSelector('.g-know'); await A.waitForTimeout(9000); await A.click('.g-know');
  await A.fill('#z-guess', 'a shoe'); await A.click('.g-guessbar .btn.g-go');
  await A.waitForSelector('.z-result:has-text("my left shoe")', { timeout: 15000 });
  await A.click('.z-result .btn:has-text("Yes")'); await A.waitForSelector('.z-you:has-text("+2")', { timeout: 10000 });
  check(true, 'Yes in the middle third scores 2');
  await A.click('.z-result .btn:has-text("Done")');
  await openChip(C, 'Zoom In');
  await C.locator('.z-row:has-text("Blake") .btn.g-go').click();
  await C.waitForSelector('.z-ready .btn.g-go:not([disabled])', { timeout: 20000 }); await C.click('.z-ready .btn.g-go');
  await C.waitForSelector('.g-guessbar', { timeout: 30000 });
  check((await C.textContent('.g-guess-t')).includes('All the way out'), 'no tap: still asked to guess at 1x');
  await C.fill('#z-guess', 'a boot'); await C.click('.g-guessbar .btn.g-go');
  await C.waitForSelector('.z-result:has-text("my left shoe")', { timeout: 15000 });
  await C.click('.z-result .btn:has-text("Yes")'); await C.waitForSelector('.z-you:has-text("+1")', { timeout: 10000 });
  check(true, 'Yes at the end scores 1');
  await C.click('.z-result .btn:has-text("Done")');
  const zEnd = await until(async () => { const g = await rpc('holler_game', { p_token: tok.A, p_game: zid }); return g.status === 'done' ? g : null; }, 15000);
  check(zEnd, 'Zoom In is done once everyone did everything');

  step('the end screen');
  await openChip(A, 'Zoom In'); await A.waitForTimeout(800);
  const endTxt = await A.textContent('.g-page');
  check(endTxt.includes('the kettle') && endTxt.includes('my left shoe') && endTxt.includes('a teapot') && endTxt.includes('a boot'), 'end shows every answer and guess');
  check(await A.isVisible('.g-board:has-text("Final scores")') && await A.isVisible('.z-hard'), 'final scores and the hardest one');
  const pts = Object.fromEntries(await A.$$eval('.g-board-row', rs => rs.map(r => [r.querySelector('b').textContent, Number(r.querySelector('em').textContent)])));
  check(pts['Blake'] === 3 && pts['You'] === 2 && pts['QA'] === 1, 'scores by the thirds rule', JSON.stringify(pts));
  await shot(A, '04-zoom-end');
  await A.$eval('.g-page', el => { el.scrollTop = el.scrollHeight; }); await A.waitForTimeout(300); await shot(A, '04b-zoom-end-scores');
  await back(A); await back(B); await back(C);

  // ================= Who Said It =================
  step('Who Said It: Avery starts');
  await A.click('.g-play-tile'); await A.waitForSelector('.g-opt'); await A.waitForTimeout(450);
  await A.locator('.g-opt:has(b:text-is("Who Said It"))').click(); await A.waitForTimeout(500);
  await A.click('.sheet .btn.g-go:has-text("Start")');
  await A.waitForSelector('.s-write'); await A.waitForTimeout(500);
  await shot(A, '05a-said-write-empty');
  const sid = (await rpc('holler_chat', { p_token: tok.A, p_chat: chat })).games.find(g => g.kind === 'said').id;
  const sg0 = await rpc('holler_game', { p_token: tok.A, p_game: sid });
  check(sg0.boards.find(x => x.about === ids.A).prompt === null && sg0.boards.find(x => x.about === ids.B).prompt, 'Avery can\'t see the prompt about Avery');
  const W = { // text -> writer, so the matching below knows the truth
    'Bakes bread at midnight': 'A', 'Talks to the toaster': 'A', 'Wins every board game': 'B', 'Owns forty hats': 'B',
    'Dances in the grocery store': 'C', 'Knows every song from Encanto': 'C' };
  const write = async (p, mine) => {
    const boxes = p.locator('.s-w');
    for (let i = 0; i < await boxes.count(); i++) {
      const who = await boxes.nth(i).getAttribute('class') && await boxes.nth(i).locator('.s-w-head b').textContent();
      const text = who.includes('Avery') ? mine.A : who.includes('Blake') ? mine.B : mine.C;
      await boxes.nth(i).locator('textarea').fill(text);
    }
  };
  await write(A, { B: 'Bakes bread at midnight', C: 'Talks to the toaster' });
  await shot(A, '05-said-write');
  await A.click('.s-write .btn.g-go'); await A.waitForSelector('.s-wait'); await A.waitForTimeout(500);
  await B.waitForSelector('.g-chip.turn:has-text("Who Said It")', { timeout: 25000 });
  await openChip(B, 'Who Said It'); await write(B, { A: 'Wins every board game', C: 'Owns forty hats' });
  await B.click('.s-write .btn.g-go'); await B.waitForSelector('.s-wait');
  check(!JSON.stringify(await rpc('holler_chat', { p_token: tok.C, p_chat: chat })).includes('Bakes bread'), 'answers hidden while writing');
  await C.waitForSelector('.g-chip.turn:has-text("Who Said It")', { timeout: 25000 });
  await openChip(C, 'Who Said It'); await write(C, { A: 'Dances in the grocery store', B: 'Knows every song from Encanto' });
  await C.click('.s-write .btn.g-go'); await C.waitForTimeout(2000);
  const sg1 = await rpc('holler_game', { p_token: tok.C, p_game: sid });
  check(sg1.phase === 'guess' && sg1.todo.length === 3, 'everyone wrote: on to guessing', `${sg1.phase} ${sg1.todo.length}`);

  const match = async (p, name, wrong) => {
    await openChip(p, 'Who Said It');
    check(await p.locator('.s-cta .btn:has-text("Match them")').count() === 1, `${name}: only the prompt about them to match (3 people)`);
    await p.click('.s-cta .btn:has-text("Match them")'); await p.waitForSelector('.s-match .s-face');
    const items = p.locator('.s-match .s-ans');
    const n = await items.count(); const writers = [];
    for (let i = 0; i < n; i++) writers.push(W[(await items.nth(i).locator('p').textContent()).replace(/[“”]/g, '')]);
    const pickOrder = wrong ? [writers[1], writers[0]] : writers;
    const first = { A: 'Avery', B: 'Blake', C: 'QA' };
    for (let i = 0; i < n; i++) { await items.nth(i).locator(`.s-face:has(b:text-is("${first[pickOrder[i]]}"))`).click(); await p.waitForTimeout(250); }
    return n;
  };
  step('each matches the answers about them; C gets both wrong');
  await match(A, 'Avery'); await shot(A, '06-said-matching');
  await A.click('.s-match .btn.g-go:has-text("Lock it in")'); await A.waitForSelector('.s-score', { timeout: 15000 }); await A.waitForTimeout(600);
  check((await A.textContent('.s-score')).includes('2 of 2'), 'Avery matched 2 of 2');
  await shot(A, '07-said-reveal');
  await A.click('.s-match .btn.g-go:has-text("Done")');
  await match(B, 'Blake'); await B.click('.s-match .btn.g-go:has-text("Lock it in")'); await B.waitForSelector('.s-score', { timeout: 15000 }); await B.click('.s-match .btn.g-go:has-text("Done")');
  await match(C, 'C', true); await C.click('.s-match .btn.g-go:has-text("Lock it in")'); await C.waitForSelector('.s-score', { timeout: 15000 });
  check((await C.textContent('.s-score')).includes('0 of 2'), 'C matched 0 of 2');
  await C.click('.s-match .btn.g-go:has-text("Done")');
  const sEnd = await until(async () => { const g = await rpc('holler_game', { p_token: tok.A, p_game: sid }); return g.status === 'done' ? g : null; }, 15000);
  check(sEnd, 'Who Said It is done');
  const sc = sEnd?.scores || {};
  check(sc[ids.A]?.right === 2 && sc[ids.B]?.right === 2 && sc[ids.C]?.right === 0 && sc[ids.A]?.fooled === 1 && sc[ids.B]?.fooled === 1 && sc[ids.C]?.fooled === 0,
    'right and fooled add up', JSON.stringify(Object.fromEntries(Object.entries(sc).map(([k, v]) => [Object.keys(ids).find(x => ids[x] === k), v]))));

  step('the end screen');
  await openChip(A, 'Who Said It'); await A.waitForTimeout(800);
  const sTxt = await A.textContent('.g-page');
  check(Object.keys(W).every(t => sTxt.includes(t)) && (await A.locator('.s-board').count()) === 3 && (await A.locator('.s-by').count()) === 6, 'end shows every prompt, every answer and its writer');
  check(await A.isVisible('.g-board:has-text("Final scores")'), 'final scores');
  await shot(A, '08-said-end');
  await A.$eval('.g-page', el => { el.scrollTop = el.scrollHeight / 2; }); await A.waitForTimeout(300); await shot(A, '08b-said-end-middle');
  await A.$eval('.g-page', el => { el.scrollTop = el.scrollHeight; }); await A.waitForTimeout(300); await shot(A, '08c-said-end-scores');

  step('the dock');
  await back(A); await A.waitForTimeout(600);
  check(await A.locator('.g-chip:has-text("Zoom In")').count() >= 1 && await A.locator('.g-chip:has-text("Who Said It")').count() >= 1, 'dock shows both games');
  check(await A.locator('.g-chip.turn:has-text("Zoom In"), .g-chip.turn:has-text("Who Said It")').count() === 0, 'nothing marked your go once both are over');
  await shot(A, '09-dock');
} catch (e) {
  console.log('STOPPED:', e.message.split('\n')[0]);
  for (const [n, p] of [['A', A], ['B', B], ['C', C]]) await shot(p, `zz-${n}-stopped`).catch(() => {});
}
const failed = checks.filter(c => !c[0]).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();
process.exit(failed || errs.length ? 1 : 0);

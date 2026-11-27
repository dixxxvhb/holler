// Charades: the smarter answer check and the actor's Count it, end to end with three fake people and fake cameras.
// Each person acts a real 10 s clip through the app; the word is swapped on the way to the server (a page route on
// holler_finish_polo) so the acts are known: Thriller dance, Dancing with the Stars, Floss. Then typed guesses
// (one through the guess screen, the rest through the same RPC the screen uses) check what counts as right, one
// guesser misses all three tries, and the actor counts that near miss from their own clip and the game page.
// Usage: PW_CHANNEL=chrome node scripts/qa-charades-match.mjs [baseUrl]  -> shots/charades/*.png
// Then ALWAYS clean the QA people (the batched cleaner).
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'fs';
const BASE = process.argv[2] || 'http://localhost:5188/';
const OUT = 'shots/charades'; mkdirSync(OUT, { recursive: true });
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
const mk = async name => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'], userAgent: UA });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    const put = () => { const s = document.createElement('style'); s.textContent = ':root{--safe-t:47px!important;--safe-b:34px!important}'; document.documentElement.appendChild(s); };
    if (document.documentElement) put(); else addEventListener('DOMContentLoaded', put);
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(`${name} pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|NotAllowedError/.test(m.text())) errs.push(`${name} console: ${m.text()}`); });
  return page;
};
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const back = async p => { while (await p.locator('.g-page .g-back').count()) { await p.locator('.g-page .g-back').first().click(); await p.waitForTimeout(400); } };
const openChip = async (p, name) => { await back(p); await p.locator(`.g-chip:has-text("${name}")`).first().click(); await p.waitForSelector('.g-page'); await p.waitForTimeout(1200); };
const until = async (f, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f(); if (v) return v; await new Promise(r => setTimeout(r, 800)); } return null; };
// the act's word goes to the server as this, whatever the app dealt
const actAs = async (p, word) => {
  await p.route('**/rest/v1/rpc/holler_finish_polo', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.p_effects?.game?.word) body.p_effects.game.word = word;
    await route.continue({ postData: JSON.stringify(body) });
  });
};

const A = await mk('A'), B = await mk('B'), C = await mk('C');
try {
  step('three people, one chat');
  await A.goto(BASE); await A.fill('#nm', 'Avery QA'); await A.click("text=Let's go");
  await A.click('button:has-text("Start a chat")'); await A.fill('#cn', 'QA Charades'); await A.click('text=Make it');
  await A.waitForSelector('.code-big'); const code = (await A.textContent('.code-big')).trim(); await A.click('.sheet-head .icon-btn');
  for (const [p, nm] of [[B, 'Blake QA'], [C, 'QA Bot']]) {
    await p.goto(BASE + '#/join/' + code); await p.fill('#nm', nm); await p.click('text=Join the chat'); await p.waitForSelector('.chat-top', { timeout: 15000 });
  }
  const tok = {}; for (const [k, p] of [['A', A], ['B', B], ['C', C]]) tok[k] = await p.evaluate(() => localStorage.getItem('holler.token'));
  const chat = (await rpc('holler_home', { p_token: tok.A })).chats[0].id;
  const ids = {}; for (const k of ['A', 'B', 'C']) ids[k] = (await rpc('holler_home', { p_token: tok[k] })).me.id;
  await A.waitForTimeout(2500);

  step('everyone acts one (10 s)');
  await actAs(A, 'Thriller dance'); await actAs(B, 'Dancing with the Stars'); await actAs(C, 'Floss');
  await A.click('.g-play-tile'); await A.click('.g-opt:has-text("Charades Relay")');
  await A.click('.g-seg button:has-text("10 sec")'); await A.waitForTimeout(450);
  await A.click('.btn.g-go:has-text("Start")');
  const act = async p => { await p.waitForSelector('.g-word'); await p.click('.rec'); await p.waitForTimeout(12000); await p.waitForTimeout(5000); };
  await act(A);
  const gid = (await rpc('holler_chat', { p_token: tok.A, p_chat: chat })).games.find(g => g.kind === 'charades').id;
  for (const p of [B, C]) {
    await p.waitForSelector('.g-chip.turn:has-text("Charades")', { timeout: 25000 });
    await openChip(p, 'Charades'); await p.click('.g-page .btn.g-go:has-text("Act yours")'); await act(p);
  }
  const acted = await until(async () => { const g = await rpc('holler_game', { p_token: tok.A, p_game: gid }); return (g.acted || []).length === 3 ? g : null; }, 40000);
  check(acted, 'all three acts are in');
  check((await rpc('holler_game', { p_token: tok.A, p_game: gid })).acts.find(a => a.who === ids.A).word === 'Thriller dance', 'Avery\'s act is Thriller dance');

  step('a typed guess on the guess screen: thriller for Thriller dance');
  await openChip(B, 'Charades');
  await B.locator('.g-row', { hasText: 'Avery acted' }).locator('.g-row-btn').click();
  await B.waitForSelector('.g-know:not([disabled])', { timeout: 20000 }); await B.waitForTimeout(1200);
  await B.click('.g-know'); await B.fill('#g-guess', 'dance'); await B.click('.g-guessbar .btn.g-go'); await B.waitForTimeout(1500);
  check(await B.locator('.g-result').count() === 0, 'dance alone is not it (1 try used)');
  await B.click('.g-know'); await B.fill('#g-guess', 'thriller'); await shot(B, '01-guess-typed');
  await B.click('.g-guessbar .btn.g-go');
  await B.waitForSelector('.g-result', { timeout: 10000 }); await B.waitForTimeout(500);
  check(await B.locator('.g-result.ok').count() === 1, 'thriller counts for Thriller dance');
  await shot(B, '02-guess-right');
  await B.click('.g-result .btn.g-go'); await B.waitForTimeout(600);

  step('the match table, through the same RPC the guess screen uses');
  const G = async (k, actor, text) => rpc('holler_game_guess', { p_token: tok[k], p_game: gid, p_actor: ids[actor], p_text: text, p_t: 2 });
  const table = [
    ['C', 'A', 'michael jackson', false], ['C', 'A', 'moonwalk', false], ['C', 'A', 'mj', false],
    ['A', 'B', 'stars', false], ['A', 'B', 'dancing with the starz', true],
    ['C', 'B', 'dancing stars', true],
    ['A', 'C', 'the floss', true], ['B', 'C', 'flossing', true],
  ];
  for (const [k, actor, text, want] of table) {
    const r = await G(k, actor, text);
    check(r.ok === want, `${JSON.stringify(text)} for ${actor === 'A' ? 'Thriller dance' : actor === 'B' ? 'Dancing with the Stars' : 'Floss'}: ${want ? 'right' : 'not right'}`);
  }
  let g = await rpc('holler_game', { p_token: tok.C, p_game: gid });
  const cOnA = g.acts.find(a => a.who === ids.A).mine;
  check(cOnA.done && !cOnA.ok && cOnA.text === 'mj', 'C is out of tries on Avery\'s');
  check(g.status === 'done', 'everyone has done everything: the game is done', g.status);

  step('Count it: only the actor');
  const notActor = await rpc('holler_charades_count', { p_token: tok.B, p_game: gid, p_guesser: ids.C }).then(() => 'no error', e => e.message);
  // the RPC only ever touches the caller's own act: Blake's call reaches his act (where C already got it), never Avery's
  check(/already counts/.test(notActor) && !(await rpc('holler_game', { p_token: tok.C, p_game: gid })).acts.find(a => a.who === ids.A).mine.ok,
    'Blake cannot count a guess on Avery\'s act (his call only reaches his own)', notActor);

  step('the actor sees the near miss on their own clip and counts it');
  await back(A); await openChip(A, 'Charades');
  check(await A.locator('.g-row', { hasText: 'You acted' }).locator('.c-miss:has-text("mj")').count() === 1, 'game page: C\'s last guess with Count it');
  await shot(A, '03-actor-page-near-miss');
  await A.locator('.g-row', { hasText: 'You acted' }).locator('.g-thumb').click();
  await A.waitForSelector('.g-result .c-miss', { timeout: 25000 }); await A.waitForTimeout(500);
  await shot(A, '04-actor-own-clip-count-it');
  await A.click('.g-result .c-count'); await A.waitForTimeout(1500);
  check(await A.locator('.g-result .c-miss').count() === 0, 'the near miss is counted and goes away');
  await A.click('.g-result .btn.g-go:has-text("Done")'); await A.waitForTimeout(800);
  g = await rpc('holler_game', { p_token: tok.C, p_game: gid });
  const counted = g.acts.find(a => a.who === ids.A).mine;
  check(counted.ok && counted.counted && counted.t === 10, 'C now counts as right, at the slowest time', JSON.stringify(counted));
  const again = await rpc('holler_charades_count', { p_token: tok.A, p_game: gid, p_guesser: ids.C }).then(() => 'no error', e => e.message);
  check(/already counts/.test(again), 'no counting twice');

  step('everyone sees it counted');
  await openChip(C, 'Charades'); await C.waitForTimeout(600);
  check(await C.locator('.g-row', { hasText: 'Avery acted' }).locator('text=Counted by Avery').count() >= 1, 'C sees Counted by Avery');
  await shot(C, '05-guesser-counted');
  await openChip(B, 'Charades'); await B.waitForTimeout(600);
  check(await B.locator('.g-row', { hasText: 'Avery acted' }).locator('.z-g:has-text("counted by Avery")').count() === 1, 'B sees QA counted by Avery');
  await openChip(A, 'Charades'); await A.waitForTimeout(600);
  const pts = Object.fromEntries(await A.$$eval('.g-board-row', rs => rs.map(r => [r.querySelector('b').textContent, Number(r.querySelector('em').textContent)])));
  // A: thriller by B (1) + count C (1) actor points, guessed starz (pts) and floss (pts); C: dancing stars + counted 1 ...
  check(Object.keys(pts).length === 3 && pts['QA'] >= 1, 'final board has the counted point', JSON.stringify(pts));
  await shot(A, '06-actor-end');
  await A.$eval('.g-page', el => { el.scrollTop = el.scrollHeight; }); await A.waitForTimeout(300); await shot(A, '06b-actor-end-scores');
} catch (e) {
  console.log('STOPPED:', e.message.split('\n')[0]);
  for (const [n, p] of [['A', A], ['B', B], ['C', C]]) await shot(p, `zz-${n}-stopped`).catch(() => {});
}
const failed = checks.filter(c => !c[0]).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await b.close();
process.exit(failed || errs.length ? 1 : 0);

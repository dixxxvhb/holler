// Every look on a real face: shoots each one at full size from Holler's real camera code (scripts/measure.html on
// the dev server), then lays them out as labelled contact sheets. The green test feed is useless for judging looks.
// Usage: PW_CHANNEL=chrome node scripts/look-sheet.mjs <face.y4m> <outDir> [perSheet=12] [id,id,... to shoot only those]
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
const [Y4M, OUT, PER = '12', ONLY = ''] = process.argv.slice(2);
if (!Y4M || !OUT) { console.error('usage: look-sheet.mjs <face.y4m> <outDir> [perSheet] [ids]'); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:5188/';
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', `--use-file-for-fake-video-capture=${Y4M}`] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera', 'microphone'] });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('pageerror', e.message));
p.on('console', m => { if (/webgl off|shader|cutout off/i.test(m.text())) console.log('warn', m.text().slice(0, 200)); });
await p.goto(BASE + 'scripts/measure.html?looks'); await p.waitForFunction(() => window.ready);
let looks = await p.evaluate(async () => (await import('/src/lib/looks.ts')).LOOKS);
if (ONLY) looks = looks.filter(l => ONLY.split(',').includes(l.id));
let segSeen = false;
for (const l of looks) {
  // the cutout model downloads the first time; trails need a moment to build up
  const wait = l.seg ? (segSeen ? 1800 : 12000) : l.history ? 2200 : 900;
  if (l.seg) segSeen = true;
  // FACE=x,y (0..1 from the top left of the picture) puts the warps on the face, where a person would drag them
  const data = await p.evaluate(([id, w, amt, ctr]) => window.shot(id, w, amt, ctr), [l.id, wait, l.amt, process.env.FACE ? process.env.FACE.split(',').map(Number) : null]);
  writeFileSync(`${OUT}/${l.id}.jpg`, Buffer.from(data, 'base64'));
  console.log('shot', l.id);
}
writeFileSync(`${OUT}/looks.json`, JSON.stringify(looks));
// contact sheets
const sp = await (await b.newContext({ viewport: { width: 1480, height: 900 }, deviceScaleFactor: 1 })).newPage();
const per = Number(PER); let n = 0;
for (let i = 0; i < looks.length; i += per) {
  const part = looks.slice(i, i + per);
  const cells = part.map(l => `<figure><img src="data:image/jpeg;base64,${readFileSync(`${OUT}/${l.id}.jpg`).toString('base64')}"><figcaption><b>${l.label}</b> <i>${l.kind}</i></figcaption></figure>`).join('');
  await sp.setContent(`<style>body{margin:0;background:#15121c;font:600 22px system-ui;color:#f7f6fb}main{display:grid;grid-template-columns:repeat(${Math.min(6, part.length)},1fr);gap:10px;padding:10px}figure{margin:0}img{width:100%;display:block;border-radius:10px}figcaption{padding:6px 2px 10px}i{font-weight:400;opacity:.6;font-size:16px}</style><main>${cells}</main>`);
  await sp.waitForTimeout(400);
  const file = `${OUT}/sheet-${++n}.jpg`;
  await sp.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 86 });
  console.log('sheet', file);
}
await b.close();

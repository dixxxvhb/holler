// How big is a minute of video? Runs Holler's real recorder (scripts/measure.html on the dev server) against a
// real face clip at each bitrate, saves every take, and prints megabytes per minute.
// Usage: PW_CHANNEL=chrome node scripts/measure.mjs <face.y4m> <outDir> [seconds=30] [bits,bits,...]
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const [Y4M, OUT, SEC = '30', BITS = '1200000,1500000,2000000,2500000'] = process.argv.slice(2);
if (!Y4M || !OUT) { console.error('usage: measure.mjs <face.y4m> <outDir> [seconds] [bits,...]'); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:5188/';
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--use-file-for-fake-video-capture=${Y4M}`] });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera', 'microphone'] })).newPage();
p.on('pageerror', e => console.log('pageerror', e.message));
p.on('console', m => { if (/webgl off|shader|voice off/i.test(m.text())) console.log('warn', m.text().slice(0, 200)); });
const rows = [];
for (const bits of BITS.split(',').map(Number)) {
  // a fresh page per take: each one starts from a cold recorder, like a real holler
  await p.goto(BASE + 'scripts/measure.html?' + bits); await p.waitForFunction(() => window.ready);
  const r = await Promise.race([p.evaluate(([bb, s]) => window.take(bb, s), [bits, Number(SEC)]), new Promise(res => setTimeout(() => res(null), (Number(SEC) + 40) * 1000))]);
  if (!r) { console.log(JSON.stringify({ asked_kbps: bits / 1000, hung: true })); continue; }
  const ext = r.mime.includes('webm') ? 'webm' : 'mp4';
  writeFileSync(`${OUT}/take-${bits}.${ext}`, Buffer.from(r.data, 'base64'));
  const mbMin = r.bytes / 1e6 / r.sec * 60;
  rows.push({ asked_kbps: bits / 1000, got_kbps: Math.round(r.bytes * 8 / r.sec / 1000), mb_per_min: +mbMin.toFixed(2), min_to_50mb: +(50 / mbMin).toFixed(2), sec: +r.sec.toFixed(1), size: `${r.w}x${r.h}`, cam: r.cam.join('x'), mime: r.mime, gl: r.gl });
  console.log(JSON.stringify(rows.at(-1)));
}
await b.close();

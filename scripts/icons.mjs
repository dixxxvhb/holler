import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/icon.svg', 'utf8');
const b = await chromium.launch();
const p = await b.newPage();
for (const s of [180, 192, 512]) {
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<style>html,body{margin:0;background:#120d0b}</style>${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}`);
  await p.screenshot({ path: `public/icon-${s}.png` });
}
await b.close();

// Contact sheet of layout screenshots for one device (no Python needed): node scripts/sheet.mjs <se|mini|i15|max> out.png
import { chromium } from 'playwright'; import { readdirSync, readFileSync } from 'fs';
const [dev, out] = process.argv.slice(2); const dir = 'shots/layout';
const num = f => parseInt(f.replace(/^[^-]+-(safari-)?/, ''));
const fs = readdirSync(dir).filter(f => f.startsWith(dev + '-')).sort((a, b) => (a.includes('safari') - b.includes('safari')) || num(a) - num(b) || a.localeCompare(b));
const html = `<body style="margin:0;display:flex;flex-wrap:wrap;gap:6px;width:1600px;font:12px sans-serif">${fs.map(f => `<div><img src="data:image/png;base64,${readFileSync(dir + '/' + f).toString('base64')}" style="width:260px;display:block"><div>${f}</div></div>`).join('')}</body>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 600 } }); await p.setContent(html); await p.screenshot({ path: out, fullPage: true }); await b.close();

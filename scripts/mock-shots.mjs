// Screenshots of each phone in a mockup page. Usage: node scripts/mock-shots.mjs <file.html> <outDir>
import { chromium } from 'playwright';
import { resolve } from 'path';
const [,, file, out] = process.argv;
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
const p = await b.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 1 });
await p.goto('file://' + resolve(file)); await p.waitForTimeout(1500);
const els = await p.$$('.ph');
for (let i = 0; i < els.length; i++) await els[i].screenshot({ path: `${out}/m${i + 1}.png` });
await b.close();

// PROTOTYPE QA: real-browser pass (Playwright). Screenshots into shots/, console errors, sideways scroll, 12px floor.
// Playwright is borrowed from another prototype's node_modules; set PLAYWRIGHT_PKG to use your own package.json.
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_PKG || 'D:/Claude Os/crash course skill/.claude/worktrees/stack-bakeoff/prototypes/stack-bakeoff/bench/package.json');
const { chromium } = require('playwright');
import { pathToFileURL } from 'node:url';
const url = pathToFileURL(process.cwd() + '/dist/stl-scl-live.html').href;
const browser = await chromium.launch();
const errors = [];
for (const [name, vp] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 375, height: 812 }]]) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${name} console ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `shots/${name}-full.png`, fullPage: true });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  if (sw > vp.width) errors.push(`${name}: page scrolls sideways (${sw}px)`);
  // walkthrough 1 on STL
  await page.locator('#stl .tabs button', { hasText: 'FC105 clamps' }).click();
  for (let i = 0; i < 4; i++) await page.locator('#stl .walk-steps li.next button').click();
  await page.locator('#stl').scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await page.locator('#stl .trace').screenshot({ path: `shots/${name}-stl-ruling-trace.png` });
  await page.locator('#stl .run-grid').screenshot({ path: `shots/${name}-stl-fc105.png` });
  // SCL walkthrough full
  await page.locator('#scl .tabs button', { hasText: 'full' }).click();
  for (let i = 0; i < 4; i++) await page.locator('#scl .walk-steps li.next button').click();
  await page.waitForTimeout(900);
  await page.locator('#scl .run-grid').screenshot({ path: `shots/${name}-scl-full.png` });
  await page.locator('#scl .code-box').scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  await page.screenshot({ path: `shots/${name}-scl-viewport.png` });
  console.log(name, 'current SCL line visible:', await page.evaluate(() => { const b = document.querySelector('#scl .code-box'), l = b.querySelector('li.cur'); if (!l) return 'none'; const r = l.getBoundingClientRect(), R = b.getBoundingClientRect(); return l.dataset.line + ' ' + (r.top >= R.top && r.bottom <= R.bottom); }));
  // float toggle
  await page.locator('[data-realmode="exact"]').click();
  await page.locator('#scl .result-box').screenshot({ path: `shots/${name}-scl-rack-exact.png` });
  await page.locator('#gate').screenshot({ path: `shots/${name}-gate.png` });
  // smallest font
  const small = await page.evaluate(() => { let min = 99, at = ''; for (const e of document.querySelectorAll('body *')) { if (!e.childNodes.length || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const fs = parseFloat(getComputedStyle(e).fontSize); if (fs < min) { min = fs; at = e.className?.baseVal ?? e.className; } } return [min, at]; });
  console.log(name, 'min font', small);
  await page.close();
}
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no console errors');

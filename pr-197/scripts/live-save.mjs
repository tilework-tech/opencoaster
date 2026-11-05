// Live check, part 1: in the session browser's existing profile (left behind by the old worker),
// load the new deploy, wait for the worker to take control, and save a park through the game UI.
// Part 2 (`load` argument): open Load game and load that park again.
// Usage: node live-save.mjs <url> <out-dir> [save|load]
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.env.HOME + '/.nori/browser-scripts/');
const { chromium } = require('playwright-core');

const [url, out, mode = 'save'] = process.argv.slice(2);
const SAVE_NAME = 'Live reload check';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
let workerRequests = 0;
const statuses = {};
context.on('response', (response) => {
  if (!response.url().startsWith(new URL(url).origin)) return;
  if (response.request().serviceWorker()) workerRequests++;
  const key = `${response.request().serviceWorker() ? 'sw' : 'page'}:${response.status()}`;
  statuses[key] = (statuses[key] ?? 0) + 1;
});
const page = context.pages()[0] ?? (await context.newPage());
const started = Date.now();
const result = { mode };

if (mode === 'save') {
  const response = await page.goto(url);
  result.navigation = response?.status();
  await page
    .waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 120000 })
    .then(
      () => (result.controlledAfterMs = Date.now() - started),
      () => (result.controlledAfterMs = 'not controlled within 120 s'),
    );
  result.installRequests = workerRequests;
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await page.getByRole('button', { name: 'Save / Load' }).first().click();
  await page.getByRole('textbox', { name: 'Save name' }).fill(SAVE_NAME);
  await page.getByRole('button', { name: 'Save to new slot' }).click();
  await page.getByText('Game saved.').waitFor({ timeout: 30000 });
  result.saved = SAVE_NAME;
  await page.screenshot({ path: `${out}/live-saved.png` });
  await page.getByRole('button', { name: 'Back to title' }).click();
} else {
  await page.goto(url);
  await page.getByRole('button', { name: 'Load game' }).click();
  await page.getByText(SAVE_NAME).first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${out}/live-load-list.png` });
  const row = page.locator('*', { hasText: SAVE_NAME }).locator('button', { hasText: /^Load$/ });
  await row.first().click();
  await page.locator('.hud').waitFor({ timeout: 60000 });
  await page.waitForTimeout(5000);
  result.loaded = SAVE_NAME;
  await page.screenshot({ path: `${out}/live-loaded-park.png` });
}
result.state = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const sizes = {};
  for (const key of await caches.keys()) sizes[key] = (await (await caches.open(key)).keys()).length;
  return { controlled: Boolean(navigator.serviceWorker.controller), active: reg?.active?.state, caches: sizes };
});
result.statuses = statuses;
console.log(JSON.stringify(result));
writeFileSync(`${out}/live-${mode}.json`, JSON.stringify(result, null, 2));
await browser.close();

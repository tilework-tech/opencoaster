// Live reload probe: one clean first visit, then ordinary reloads, a hard reload and a tab reopen
// in the same profile. Records every response (page and service worker) by status, console errors
// and service worker state. Usage: node reload-probe.mjs <url> <out-dir> [--keep-storage]
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.env.HOME + '/.nori/browser-scripts/');
const { chromium } = require('playwright-core');

const [url = 'https://opencoaster.noriagentic.com/', out = '.', ...flags] = process.argv.slice(2);
const keepStorage = flags.includes('--keep-storage');
const settleMs = Number(process.env.SETTLE_MS ?? 45000);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
const origin = new URL(url).origin;
const log = [];
const note = (entry) => {
  log.push({ t: new Date().toISOString(), ...entry });
  console.log(JSON.stringify(entry));
};

let phase = 'setup';
const stats = {};
const bump = (key) => {
  stats[phase] ??= {};
  stats[phase][key] = (stats[phase][key] ?? 0) + 1;
};
const blocked = [];
const watchResponse = (response) => {
  if (!response.url().startsWith(origin)) return;
  const sw = Boolean(response.request().serviceWorker());
  bump(`${sw ? 'sw' : 'page'}:${response.status()}${response.fromServiceWorker() ? ':fromSW' : ''}`);
  if (response.status() >= 400 && blocked.length < 40)
    blocked.push({ phase, status: response.status(), url: response.url(), sw, headers: response.headers() });
};
const watchFailure = (request) => {
  if (!request.url().startsWith(origin)) return;
  bump(`${request.serviceWorker() ? 'sw' : 'page'}:failed:${request.failure()?.errorText}`);
};
context.on('response', watchResponse);
context.on('requestfailed', watchFailure);

async function swState(page) {
  return page
    .evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const keys = await caches.keys();
      const sizes = {};
      for (const key of keys) sizes[key] = (await (await caches.open(key)).keys()).length;
      return {
        controlled: Boolean(navigator.serviceWorker.controller),
        active: reg?.active?.state ?? null,
        waiting: reg?.waiting?.state ?? null,
        installing: reg?.installing?.state ?? null,
        caches: sizes,
        saves: await new Promise((resolve) => {
          const open = indexedDB.open('opencoaster-saves');
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('slots')) return resolve(-1);
            const req = db.transaction('slots').objectStore('slots').count();
            req.onsuccess = () => resolve(req.result);
          };
          open.onerror = () => resolve('error');
        }),
      };
    })
    .catch((error) => ({ error: String(error) }));
}

async function visit(page, label, action) {
  phase = label;
  const consoleErrors = [];
  const onConsole = (m) => m.type() === 'error' && consoleErrors.push(m.text());
  const onError = (e) => consoleErrors.push(`pageerror: ${e.message}`);
  page.on('console', onConsole);
  page.on('pageerror', onError);
  let status = null;
  let title = null;
  try {
    const response = await action();
    status = response?.status() ?? null;
  } catch (error) {
    status = `nav-error: ${error.message.split('\n')[0]}`;
  }
  await page.waitForTimeout(settleMs);
  title = await page.title().catch(() => null);
  const body = await page.evaluate(() => document.body?.innerText.slice(0, 200)).catch(() => null);
  await page.screenshot({ path: `${out}/${label}.png` }).catch(() => {});
  page.off('console', onConsole);
  page.off('pageerror', onError);
  note({ label, status, title, body, sw: await swState(page), consoleErrors: consoleErrors.slice(0, 10), requests: stats[label] });
}

let page = context.pages()[0] ?? (await context.newPage());
if (!keepStorage) {
  const cdp = await context.newCDPSession(page);
  await page.goto('about:blank');
  await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
  note({ label: 'cleared', origin });
}
await visit(page, 'first-visit', () => page.goto(url, { waitUntil: 'load' }));
for (let i = 1; i <= 3; i++) await visit(page, `reload-${i}`, () => page.reload({ waitUntil: 'load' }));
await visit(page, 'hard-reload', async () => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const r = await page.reload({ waitUntil: 'load' });
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  return r;
});
await page.close();
page = await context.newPage();
await visit(page, 'reopen-tab', () => page.goto(url, { waitUntil: 'load' }));

writeFileSync(`${out}/probe-log.json`, JSON.stringify({ url, log, stats, blocked }, null, 2));
await browser.close();

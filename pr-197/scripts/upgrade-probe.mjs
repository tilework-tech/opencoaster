// Old-worker -> new-deploy upgrade probe on a Pages-like server (subpath, no COOP/COEP).
// A persistent profile first loads the OLD build until its worker controls the page (or a deadline
// passes, as on the live site), with a saved park in IndexedDB. The server then switches to the NEW
// build, and the probe reloads repeatedly, recording worker downloads, caches and the save.
// Usage: node upgrade-probe.mjs <old-dist> <new-dist> <out-dir>   (run from the repo root)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const [oldDist, newDist, out] = process.argv.slice(2).map((p) => resolve(p));
const port = 4179;
const base = `http://127.0.0.1:${port}/opencoaster/`;
const work = mkdtempSync(join(tmpdir(), 'oc-upgrade-'));
const current = join(work, 'current');
const serve = (dir) => {
  rmSync(current, { force: true });
  symlinkSync(dir, current);
};
serve(oldDist);
const server = spawn('node', ['tools/serve-subpath.mjs', current, String(port), '/opencoaster/'], {
  stdio: 'inherit',
});
await new Promise((r) => setTimeout(r, 1000));

const context = await chromium.launchPersistentContext(join(work, 'profile'), {
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = context.pages()[0] ?? (await context.newPage());
let downloads = 0;
let networkStatuses = {};
context.on('request', (request) => {
  if (request.serviceWorker()) downloads++;
});
context.on('response', (response) => {
  const key = `${response.request().serviceWorker() ? 'sw' : 'page'}:${response.status()}${response.fromServiceWorker() ? ':fromSW' : ''}`;
  networkStatuses[key] = (networkStatuses[key] ?? 0) + 1;
});
const state = () =>
  page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sizes = {};
    for (const key of await caches.keys())
      sizes[key] = await (await caches.open(key)).keys().then((k) => k.length, (e) => `keys() failed: ${e.message}`);
    const save = await new Promise((resolve) => {
      const open = indexedDB.open('opencoaster-saves');
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('slots')) return resolve(null);
        const get = db.transaction('slots').objectStore('slots').get('upgrade-park');
        get.onsuccess = () => resolve(get.result ? [...get.result.bytes] : null);
      };
    });
    return {
      controlled: Boolean(navigator.serviceWorker.controller),
      active: reg?.active?.state ?? null,
      installing: reg?.installing?.state ?? null,
      caches: sizes,
      save,
      settings: localStorage.getItem('opencoaster.settings.v1'),
    };
  });
const log = [];
const record = async (label, extra = {}) => {
  const entry = { label, downloads, network: networkStatuses, ...(await state()), ...extra };
  log.push(entry);
  console.log(JSON.stringify(entry));
  await page.screenshot({ path: join(out, `upgrade-${label}.png`), timeout: 90000 }).catch(() => {});
  downloads = 0;
  networkStatuses = {};
};

await page.goto(base);
await page.evaluate(async () => {
  localStorage.setItem('opencoaster.settings.v1', '{"upgrade":true}');
  await new Promise((resolve, reject) => {
    const open = indexedDB.open('opencoaster-saves', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('slots', { keyPath: 'id' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('slots', 'readwrite');
      tx.objectStore('slots').put({
        id: 'upgrade-park', name: 'Upgrade park', savedAt: Date.now(), scenarioId: 'sandbox',
        tick: 0, cash: 0, loan: 0, bytes: new Uint8Array([9, 8, 7]),
      });
      tx.oncomplete = resolve;
    };
  });
});
const deadline = Date.now() + Number(process.env.OLD_INSTALL_MS ?? 240000);
while (Date.now() < deadline && !(await state()).controlled) await page.waitForTimeout(2000);
await record('old-build');

serve(newDist);
for (let i = 1; i <= 4; i++) {
  const started = Date.now();
  const nav = await page.reload({ timeout: 120000 }).catch((e) => e.message);
  const titleShown = await page
    .getByRole('button', { name: 'Load game' })
    .waitFor({ timeout: 120000 })
    .then(() => Date.now() - started, (e) => `not shown: ${e.message.split('\n')[0]}`);
  const text = await page.evaluate(() => document.body.innerText.slice(0, 160)).catch((e) => e.message);
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    const s = await state();
    if (s.controlled && !s.installing) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForLoadState('networkidle');
  await record(`new-build-reload-${i}`, { nav: typeof nav === 'string' ? nav : nav?.status(), titleShownMs: titleShown, text });
}
await page.getByRole('button', { name: 'Load game' }).click();
await page.getByText('Upgrade park').waitFor();
await record('load-game-lists-save');

writeFileSync(join(out, 'upgrade-log.json'), JSON.stringify(log, null, 2));
await context.close();
server.kill();
rmSync(work, { recursive: true, force: true });

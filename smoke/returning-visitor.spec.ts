import { expect, test } from '@playwright/test';

const SAVE = { id: 'returning-park', name: 'Returning park', bytes: [7, 1, 2, 3] };

// The production worker installs once, then repeat visits load from it. The dev server's worker
// only precaches the shell, so this runs against the production build (pnpm smoke:subpath).
test('a returning visitor reloads from the installed worker and keeps their saved parks', async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(new URL(baseURL ?? '/').pathname === '/', 'production build only');
  test.setTimeout(90_000);
  const base = new URL(baseURL ?? '/');

  // A visitor from an earlier build: a saved park, settings and that build's worker cache.
  await page.goto(base.origin);
  await page.evaluate(
    async ({ save, scope }) => {
      localStorage.setItem('opencoaster.settings.v1', '{"returning":true}');
      const old = await caches.open('opencoaster-static-old');
      await old.put(new URL(scope, location.href).href, new Response('old shell'));
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('opencoaster-saves', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('slots', { keyPath: 'id' });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('slots', 'readwrite');
          tx.objectStore('slots').put({
            id: save.id,
            name: save.name,
            savedAt: Date.now(),
            scenarioId: 'sandbox',
            tick: 0,
            cash: 0,
            loan: 0,
            bytes: new Uint8Array(save.bytes),
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { save: SAVE, scope: base.pathname },
  );

  const workerDownloads: string[] = [];
  const pageNetworkLoads: string[] = [];
  const failures: string[] = [];
  context.on('request', (request) => {
    if (request.serviceWorker()) workerDownloads.push(request.url());
  });
  context.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
    const request = response.request();
    if (
      !request.serviceWorker() &&
      request.resourceType() !== 'document' &&
      !response.fromServiceWorker()
    )
      pageNetworkLoads.push(response.url());
  });

  await page.goto(base.href);
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      timeout: 60_000,
    })
    .toBe(true);
  // The precache holds the bundle, shell, atlas and icons, not the per-sprite packer inputs.
  expect(workerDownloads).toContain(`${base.href}sprites/manifest.json`);
  expect(workerDownloads.length).toBeLessThan(1000);

  await page.waitForLoadState('networkidle');
  for (let reload = 0; reload < 3; reload++) {
    workerDownloads.length = 0;
    pageNetworkLoads.length = 0;
    await page.reload();
    await expect(page.getByRole('button', { name: 'Load game' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    expect(workerDownloads.filter((url) => url !== base.href)).toEqual([]);
    expect(pageNetworkLoads.filter((url) => !url.endsWith('/service-worker.js'))).toEqual([]);
  }

  const storage = await page.evaluate(async (id) => {
    const save = await new Promise<{ name: string; bytes: Uint8Array } | undefined>(
      (resolve, reject) => {
        const open = indexedDB.open('opencoaster-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('slots').objectStore('slots').get(id);
          get.onerror = () => reject(get.error);
          get.onsuccess = () => resolve(get.result as { name: string; bytes: Uint8Array });
        };
      },
    );
    return {
      save: save && { name: save.name, bytes: [...save.bytes] },
      settings: localStorage.getItem('opencoaster.settings.v1'),
      caches: (await caches.keys()).filter((key) => key.startsWith('opencoaster-static-')).length,
    };
  }, SAVE.id);
  expect(storage).toEqual({
    save: { name: SAVE.name, bytes: SAVE.bytes },
    settings: '{"returning":true}',
    caches: 1,
  });
  await page.getByRole('button', { name: 'Load game' }).click();
  await expect(page.getByText(SAVE.name)).toBeVisible();
  expect(failures.filter((failure) => !failure.endsWith(`${base.origin}/`))).toEqual([]);
});

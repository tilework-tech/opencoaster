import { expect, test } from '@playwright/test';

test('loads every asset, the manifest and the service worker from the deployed base', async ({
  page,
}) => {
  const failedResponses: string[] = [];
  const spriteResponses: string[] = [];
  const pageErrors: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
    if (response.url().includes('/sprites/')) spriteResponses.push(response.url());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('./');
  const base = page.url();

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).not.toBeNull();
  const manifestUrl = new URL(manifestHref ?? '', base).href;
  const manifestResponse = await page.request.get(manifestUrl);
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as {
    start_url: string;
    scope: string;
    icons: { src: string }[];
  };
  expect(new URL(manifest.start_url, manifestUrl).href).toBe(base);
  expect(new URL(manifest.scope, manifestUrl).href).toBe(base);
  for (const icon of manifest.icons) {
    expect((await page.request.get(new URL(icon.src, manifestUrl).href)).ok()).toBe(true);
  }

  const appleIconHref = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect((await page.request.get(new URL(appleIconHref ?? '', base).href)).ok()).toBe(true);

  await page.getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.locator('.hud')).toContainText('WebGL2', { timeout: 20_000 });
  expect(spriteResponses).toEqual(
    expect.arrayContaining([`${base}sprites/manifest.json`, `${base}sprites/atlas/world-0.png`]),
  );

  // The dev server's worker only precaches the shell; production builds precache every sprite page.
  if (new URL(base).pathname !== '/') {
    const spriteManifest = (await (
      await page.request.get(`${base}sprites/manifest.json`)
    ).json()) as { pages: { file: string }[] };
    const workerSource = await (await page.request.get(`${base}service-worker.js`)).text();
    for (const atlasPage of spriteManifest.pages)
      expect(workerSource).toContain(`sprites/${atlasPage.file}`);
  }

  const serviceWorkerScope = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).scope,
  );
  expect(serviceWorkerScope).toBe(base);

  expect(failedResponses).toEqual([]);
  expect(pageErrors).toEqual([]);
});

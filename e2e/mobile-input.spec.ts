import { readFile } from 'node:fs/promises';
import { devices, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

const mobileProfiles = [
  { name: 'iPhone 15', device: devices['iPhone 15'] },
  { name: 'Pixel 8', device: devices['Pixel 8'] },
] as const;

async function dispatchTouches(
  cdp: CdpSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: Array<{ id: number; x: number; y: number }>,
): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((point) => ({
      ...point,
      radiusX: 1,
      radiusY: 1,
      force: 1,
    })),
  });
}

async function exportCurrentSave(page: Page): Promise<Buffer> {
  const closeButtons = page.locator('.ui-window button[aria-label^="Close"]');
  while (await closeButtons.count()) await closeButtons.first().click();
  await page.getByRole('button', { name: 'Game options' }).click();
  await page.getByRole('button', { name: 'Save, load and quit…' }).click();
  const exportPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export save file' }).click();
  const download = await exportPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('Save export did not produce a downloadable file');
  const bytes = await readFile(downloadPath);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Close Game options' }).click();
  return bytes;
}

async function savedGuestPoint(page: Page): Promise<{ x: number; y: number }> {
  const bounds = await page.locator('#game').boundingBox();
  if (!bounds) throw new Error('Game viewport is missing');
  const bytes = await exportCurrentSave(page);
  const point = await page.evaluate(
    async ({ base64, width, height }) => {
      const binary = atob(base64);
      const saveBytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const saveModulePath = '/src/save/save.ts';
      const projectionModulePath = '/src/render/projection.ts';
      const [{ deserialize }, { project, TILE_H }] = await Promise.all([
        import(saveModulePath),
        import(projectionModulePath),
      ]);
      const world = deserialize(saveBytes);
      const position = new Float64Array(2);
      const cameraY = (world.map.height * TILE_H) / 2;
      for (let guest = 0; guest < world.guests.count; guest++) {
        project(
          world.guests.cols.x[guest],
          world.guests.cols.y[guest],
          world.guests.cols.z[guest],
          world.map.width,
          world.map.height,
          0,
          position,
        );
        const x = width / 2 + position[0];
        const y = height / 2 + position[1] - cameraY;
        if (x >= 0 && x < width && y >= 0 && y < height) return { x, y };
      }
      throw new Error('No guest is visible in the initial mobile viewport');
    },
    { base64: bytes.toString('base64'), width: bounds.width, height: bounds.height },
  );
  return { x: bounds.x + point.x, y: bounds.y + point.y };
}

function tileAt(status: string): string {
  const match = status.match(/placement requested at (-?\d+), (-?\d+)\./);
  if (!match) throw new Error(`Path placement did not report a tile: ${status}`);
  return `${match[1]},${match[2]}`;
}

async function savedPathCount(page: Page): Promise<number> {
  const bytes = await exportCurrentSave(page);
  const pathCount = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const saveBytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const saveModulePath = '/src/save/save.ts';
    const mapModulePath = '/src/worker/map-data.ts';
    const [{ deserialize }, { extractMapData }] = await Promise.all([
      import(saveModulePath),
      import(mapModulePath),
    ]);
    return extractMapData(deserialize(saveBytes).map).pathCount;
  }, bytes.toString('base64'));
  return pathCount;
}

for (const { name, device } of mobileProfiles) {
  test(`${name} supports touch camera controls and path building`, async ({
    browser,
  }, testInfo) => {
    const { defaultBrowserType: _browserType, ...options } = device;
    void _browserType;
    const context = await browser.newContext({ ...options, serviceWorkers: 'allow' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);

    await page.goto('/');
    await expect(page.locator('.title-heading')).toBeVisible();
    await page.getByRole('button', { name: 'Sandbox' }).click();
    await expect(page.locator('.hud')).toContainText(/guests 1000/, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    await page.getByRole('button', { name: 'Park', exact: true }).click();
    const selectPathTool = async () => {
      await page.getByRole('button', { name: 'Footpaths' }).click();
    };
    await selectPathTool();
    const holdTarget = await savedGuestPoint(page);
    await dispatchTouches(cdp, 'touchStart', [{ id: 6, ...holdTarget }]);
    await page.waitForTimeout(600);
    await dispatchTouches(cdp, 'touchEnd', []);
    await expect(page.locator('.ui-window.kind-guest')).toContainText(/tile \d+, \d+/);
    const closeButtons = page.locator('.ui-window button[aria-label^="Close"]');
    while (await closeButtons.count()) await closeButtons.first().click();
    await page.getByRole('button', { name: 'Resume' }).click();
    await selectPathTool();

    const bounds = await page.locator('#game').boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error('Game viewport is missing');
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const placePath = async (point = center) => {
      await dispatchTouches(cdp, 'touchStart', [{ id: 1, ...point }]);
      await dispatchTouches(cdp, 'touchEnd', []);
      const status = page.locator('.tool-status');
      await expect(status).toContainText('Path placement requested');
      return status.innerText();
    };
    const initialPlacement = tileAt(await placePath());

    await page.getByRole('button', { name: 'Close Footpaths' }).click();
    await dispatchTouches(cdp, 'touchStart', [{ id: 2, ...center }]);
    await dispatchTouches(cdp, 'touchMove', [{ id: 2, x: center.x + 36, y: center.y + 24 }]);
    await dispatchTouches(cdp, 'touchEnd', []);
    await selectPathTool();
    const afterPan = tileAt(await placePath());
    expect(afterPan).not.toBe(initialPlacement);

    const zoomProbe = { x: center.x + 80, y: center.y + 40 };
    const beforeZoom = tileAt(await placePath(zoomProbe));
    const pinchStart = [
      { id: 3, x: center.x - 70, y: center.y - 40 },
      { id: 4, x: center.x + 10, y: center.y - 40 },
    ];
    await dispatchTouches(cdp, 'touchStart', pinchStart);
    await dispatchTouches(cdp, 'touchMove', [
      { id: 3, x: center.x - 120, y: center.y - 40 },
      { id: 4, x: center.x + 20, y: center.y - 40 },
    ]);
    await dispatchTouches(cdp, 'touchEnd', []);
    const afterZoom = tileAt(await placePath(zoomProbe));
    expect(afterZoom).not.toBe(beforeZoom);

    const beforePaint = tileAt(await placePath());
    await dispatchTouches(cdp, 'touchStart', [{ id: 5, ...center }]);
    await dispatchTouches(cdp, 'touchMove', [{ id: 5, x: center.x + 24, y: center.y + 12 }]);
    await dispatchTouches(cdp, 'touchMove', [{ id: 5, x: center.x + 42, y: center.y + 20 }]);
    await dispatchTouches(cdp, 'touchEnd', []);
    const afterPaint = tileAt(await page.locator('.tool-status').innerText());
    expect(afterPaint).not.toBe(beforePaint);

    const rotationBefore = await page.locator('.hud').innerText();
    const rotationMatch = rotationBefore.match(/\brot (\d)\b/);
    expect(rotationMatch).not.toBeNull();
    const initialRotation = Number(rotationMatch?.[1]);
    expect(initialRotation).toBeGreaterThanOrEqual(0);
    expect(initialRotation).toBeLessThanOrEqual(3);
    await page.locator('[data-action="rotate"]').click();
    await expect
      .poll(async () => {
        const text = await page.locator('.hud').innerText();
        return Number(text.match(/\brot (\d)\b/)?.[1]);
      })
      .toBe((initialRotation + 1) % 4);

    const renderScale = await page.locator('#game').evaluate((canvas) => {
      return canvas.width / canvas.getBoundingClientRect().width;
    });
    expect(renderScale).toBeLessThanOrEqual(2.01);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain(
      'viewport-fit=cover',
    );
    expect(await savedPathCount(page)).toBeGreaterThan(0);

    const screenshot = testInfo.outputPath(`${name.toLowerCase().replaceAll(' ', '-')}-park.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach(`${name} park after touch gestures`, {
      path: screenshot,
      contentType: 'image/png',
    });
    await context.close();
  });
}

test('mobile viewport resizes, pauses while hidden, and resumes on return', async ({ browser }) => {
  const { defaultBrowserType: _browserType, ...options } = devices['Pixel 8'];
  void _browserType;
  const context = await browser.newContext({ ...options });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();

  await page.evaluate(() => {
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => visibility === 'hidden',
    });
    (
      window as Window & { setTestVisibility?: (value: DocumentVisibilityState) => void }
    ).setTestVisibility = (value) => {
      visibility = value;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });

  const tick = async () => {
    const hud = await page.locator('.hud').innerText();
    const match = hud.match(/\btick (\d+)\b/);
    if (!match) throw new Error('Simulation tick is missing from the HUD');
    return Number(match[1]);
  };
  await expect(page.locator('.hud')).toContainText(/\btick \d+\b/, { timeout: 20_000 });
  await expect.poll(tick).toBeGreaterThan(0);
  await page.evaluate(() => {
    (
      window as Window & { setTestVisibility: (value: DocumentVisibilityState) => void }
    ).setTestVisibility('hidden');
  });
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');
  await page.waitForTimeout(1_500);
  const pausedTick = await tick();
  await page.waitForTimeout(500);
  expect(await tick()).toBe(pausedTick);

  await page.evaluate(() => {
    (
      window as Window & { setTestVisibility: (value: DocumentVisibilityState) => void }
    ).setTestVisibility('visible');
  });
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
  await expect.poll(tick).toBeGreaterThan(pausedTick);

  const beforeResize = await page.locator('#game').boundingBox();
  await page.setViewportSize({ width: 915, height: 412 });
  await expect.poll(async () => (await page.locator('#game').boundingBox())?.width).toBe(915);
  await expect.poll(async () => (await page.locator('#game').boundingBox())?.height).toBe(412);
  const toolbar = await page.locator('.game-toolbar').boundingBox();
  expect(toolbar).not.toBeNull();
  expect(toolbar!.x).toBeGreaterThanOrEqual(0);
  expect(toolbar!.y).toBeGreaterThanOrEqual(0);
  expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(915);
  expect(beforeResize?.height).toBeGreaterThan(0);
  await context.close();
});

test('mobile-emulated rendering reports frame rate with 2,000 guests', async ({ browser }) => {
  const { defaultBrowserType: _browserType, ...options } = devices['Pixel 8'];
  void _browserType;
  const context = await browser.newContext({ ...options });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.locator('.hud')).toContainText(/guests 1000/);
  await page.getByRole('button', { name: 'Game options' }).click();
  await page.getByRole('button', { name: 'Guests +1,000' }).click();
  await expect(page.locator('.hud')).toContainText(/guests 2000/, { timeout: 30_000 });

  const samples = await page.evaluate(async () => {
    const hud = document.querySelector('.hud');
    if (!hud) throw new Error('Performance HUD is missing');
    const values: number[] = [];
    await new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        const match = hud.textContent?.match(/\bfps (\d+)\b/);
        if (match) values.push(Number(match[1]));
        if (values.length >= 100) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(hud, { childList: true, characterData: true, subtree: true });
      window.setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 10_000);
    });
    return values;
  });
  expect(samples.length).toBeGreaterThanOrEqual(30);
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (fraction: number) => sorted[Math.ceil(fraction * sorted.length) - 1];
  console.log(
    `Pixel 8 emulation, 2,000 guests: ${samples.length} FPS samples; ` +
      `p50 ${percentile(0.5)} p95 ${percentile(0.95)} p99 ${percentile(0.99)} max ${sorted.at(-1)}`,
  );
  await context.close();
});

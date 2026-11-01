import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';
import sharp from 'sharp';
import { project } from '../src/render/projection';
import type { Rotation } from '../src/render/projection';
import { TILE_UNITS, Z_STEP } from '../src/sim/core/constants';
import { README_PARKS } from './support/readme-parks';
import type { ReadmeView } from './support/readme-parks';

/**
 * Captures the README screenshots: each developed park is built in Node with the real
 * simulation, imported through the title screen's Import save file control, run briefly so rides
 * and guests animate, then framed and captured at 1280x800 with the WebGL2 renderer.
 *
 * Runs only when README_SHOT_DIR names the output directory. Regenerate with
 *
 *   README_SHOT_DIR=docs/screenshots/readme pnpm exec playwright test \
 *     --config=playwright.e2e.config.ts e2e/readme-screenshots.spec.ts
 *
 * README_SHOTS=midway or README_SHOTS=riverside limits the run to one park. Needs the dev server
 * on port 4173 (the Playwright config starts or reuses it); takes about 90 seconds.
 */
const shotDir = process.env.README_SHOT_DIR;
const only = process.env.README_SHOTS?.split(',');

interface SimWindow {
  __sim: {
    latest: { cars: { data: Int32Array; count: number } };
    map: { width: number; height: number };
    setSpeed(multiplier: number): void;
    setPaused(paused: boolean): void;
  };
  __camera: { x: number; y: number; zoom: number; rotation: number };
}

/** Resolves once every sprite page the renderer asked for has arrived and nothing new is pending. */
function spriteIdleTracker(page: Page): () => Promise<void> {
  let pending = 0;
  let lastActivity = Date.now();
  const isSprite = (request: Request) => /\/sprites\//.test(request.url());
  page.on('request', (request) => {
    if (!isSprite(request)) return;
    pending++;
    lastActivity = Date.now();
  });
  const done = (request: Request) => {
    if (!isSprite(request)) return;
    pending--;
    lastActivity = Date.now();
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return async () => {
    const deadline = Date.now() + 90_000;
    while (pending > 0 || Date.now() - lastActivity < 2_000) {
      if (Date.now() > deadline) throw new Error('sprite pages did not finish loading');
      await page.waitForTimeout(200);
    }
  };
}

/** True when a car of `rideId` is inside the tile box. */
async function trainIn(page: Page, train: NonNullable<ReadmeView['train']>): Promise<boolean> {
  return page.evaluate(({ rideId, box, minLevel }) => {
    const { cars } = (window as unknown as SimWindow).__sim.latest;
    for (let i = 0; i < cars.count; i++) {
      if (cars.data[i * 4 + 3]! >>> 16 !== rideId) continue;
      const x = cars.data[i * 4]! / 256;
      const y = cars.data[i * 4 + 1]! / 256;
      const level = cars.data[i * 4 + 2]! / 64;
      if (x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3] && level >= (minLevel ?? 0))
        return true;
    }
    return false;
  }, train);
}

async function aim(page: Page, view: ReadmeView): Promise<void> {
  const { width, height, rotation } = await page.evaluate(() => {
    const w = window as unknown as SimWindow;
    return { width: w.__sim.map.width, height: w.__sim.map.height, rotation: w.__camera.rotation };
  });
  const at = new Float64Array(2);
  const [x, y, level] = view.focus;
  project(
    x * TILE_UNITS + TILE_UNITS / 2,
    y * TILE_UNITS + TILE_UNITS / 2,
    level * Z_STEP,
    width,
    height,
    rotation as Rotation,
    at,
  );
  await page.evaluate(
    ([cx, cy, zoom]) => {
      const camera = (window as unknown as SimWindow).__camera;
      camera.x = cx!;
      camera.y = cy!;
      camera.zoom = zoom!;
    },
    [at[0], at[1], view.zoom],
  );
}

test.use({
  viewport: { width: 1280, height: 800 },
  launchOptions: {
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
      // Software 2D canvases free the scratch canvases the WebGL2 renderer uploads each sprite
      // page through; GPU-backed ones linger and push a software-GL browser past 4 GB.
      '--disable-accelerated-2d-canvas',
      '--disable-gpu-rasterization',
    ],
  },
});

for (const [name, build] of Object.entries(README_PARKS)) {
  test(`README screenshot: ${name}`, async ({ page }) => {
    test.skip(!shotDir, 'set README_SHOT_DIR to capture the README screenshots');
    test.skip(only !== undefined && !only.includes(name), `${name} not in README_SHOTS`);
    test.setTimeout(600_000);
    mkdirSync(shotDir!, { recursive: true });
    const park = build();
    const spritesIdle = spriteIdleTracker(page);

    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import save file' }).click();
    await (
      await chooser
    ).setFiles({
      name: `${name}.ocsave`,
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(park.save),
    });
    await expect(page.locator('.game-toolbar')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.hud')).toContainText('WebGL2', { timeout: 60_000 });
    const closeButtons = page.locator('.ui-window button[aria-label^="Close"]');
    while (await closeButtons.count()) await closeButtons.first().click();

    await page.evaluate(() => (window as unknown as SimWindow).__sim.setSpeed(1));
    await aim(page, park.views[0]!);
    await page.mouse.move(640, 790);
    await page.waitForTimeout(4_000);

    for (const view of park.views) {
      const sim = (paused: boolean) =>
        page.evaluate((p) => (window as unknown as SimWindow).__sim.setPaused(p), paused);
      await sim(false);
      await aim(page, view);
      if (view.train)
        await expect
          .poll(() => trainIn(page, view.train!), { timeout: 120_000, intervals: [50] })
          .toBe(true);
      await sim(true);
      await page.waitForTimeout(1_500);
      await spritesIdle();
      await page.waitForTimeout(1_500);
      const png = await page.screenshot({ timeout: 300_000 });
      const out = `${shotDir}/${view.name}.png`;
      await sharp(png).png({ compressionLevel: 9, effort: 10 }).toFile(out);
      const stats = await sharp(png).stats();
      expect(stats.channels[0]!.stdev, `${view.name} is not blank`).toBeGreaterThan(10);
    }
  });
}

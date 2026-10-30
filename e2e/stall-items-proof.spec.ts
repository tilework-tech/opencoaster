import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from './support/test';
import type { Page, TestInfo } from './support/test';
import { STALL_CENTRE, stallScene } from './support/stall-scene';
import { serialize } from '../src/save/save';
import { RideType } from '../src/sim/rides/ride-types';
import { WeatherKind } from '../src/sim/weather/weather';
import { centerCameraOn, createStarterWorld, startStarterPark } from './footpath-helpers';

/**
 * Proof capture for stall items: guests carrying balloons, hats and (in rain) umbrellas, and a
 * stall's price, sales and profit rows. Frames go to PROOF_DIR when it is set.
 */
const PROOF_DIR = process.env.PROOF_DIR;
const SCENE_CATEGORIES = ['people', 'stalls', 'world', 'litter'];

async function forceCanvas2D(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return original.call(this, type as '2d', ...(args as []));
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

/**
 * Loads the sprite categories the scene draws (every category when `only` is absent) so nothing
 * in the frame falls back to placeholder art. WebGL2 keeps each loaded page as a texture, so the
 * software-rendered sandbox runs out of memory if it loads all of them.
 */
async function loadSprites(page: Page, only?: readonly string[]): Promise<void> {
  await page.evaluate(async (only) => {
    const { spritePages } = await import('/src/render/sprite-pages.ts');
    const manifest = (await (await fetch('/sprites/manifest.json')).json()) as {
      categories: Record<string, unknown>;
    };
    const categories = Object.keys(manifest.categories).filter(
      (category) => !only || only.includes(category),
    );
    for (const category of categories) spritePages.requestCategory(category);
    const deadline = Date.now() + 60_000;
    while (!categories.every((category) => spritePages.isLoaded(category))) {
      if (Date.now() > deadline) throw new Error('sprite categories did not finish loading');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, only);
}

async function save(path: string, bytes: Buffer, testInfo: TestInfo, name: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function canvasPng(page: Page): Promise<Buffer> {
  return page.locator('#game').screenshot();
}

async function openScene(page: Page, path: string, canvas2d: boolean): Promise<void> {
  if (canvas2d) await forceCanvas2D(page);
  await startStarterPark(page);
  const toolbar = page.locator('.game-toolbar');
  await toolbar.getByRole('button', { name: 'Save / Load', exact: true }).click();
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(path);
  await expect(page.locator('.hud')).toContainText('tick');
  const pause = toolbar.getByRole('button', { name: 'Pause', exact: true });
  if (await pause.isVisible()) await pause.click();
  await loadSprites(page, canvas2d ? undefined : SCENE_CATEGORIES);
  await page.waitForTimeout(2_000);
  await centerCameraOn(page, createStarterWorld(), STALL_CENTRE, 3);
  await page.waitForTimeout(1_500);
}

for (const renderer of ['webgl2', 'canvas2d'] as const) {
  for (const [name, weather] of [
    ['dry', WeatherKind.Sunny],
    ['rain', WeatherKind.Rain],
  ] as const) {
    test(`guests carry what stalls sold them: ${name}, ${renderer}`, async ({ page }, testInfo) => {
      test.setTimeout(300_000);
      const scene = stallScene(weather);
      const world = scene.sim.world;
      const carried = { balloon: 0, hat: 0, umbrella: 0 };
      for (let slot = 0; slot < world.guests.count; slot++) {
        const bits = world.guests.cols.souvenirs[slot]!;
        if (bits & 1) carried.balloon++;
        if (bits & 2) carried.hat++;
        if (world.umbrellas[world.guests.slotToId[slot]!]) carried.umbrella++;
      }
      expect(carried.balloon + carried.hat + carried.umbrella).toBeGreaterThan(0);
      const path = testInfo.outputPath(`stalls-${name}.park`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, serialize(world));
      const dir = PROOF_DIR ?? testInfo.outputPath('proof');
      await openScene(page, path, renderer === 'canvas2d');
      await save(
        `${dir}/guests-carrying-${name}-${renderer}.png`,
        await canvasPng(page),
        testInfo,
        `${name}-${renderer}`,
      );
    });
  }
}

test('a kiosk window lists map and umbrella with price, sales and profit after a rainy spell', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const scene = stallScene(WeatherKind.Rain);
  const world = scene.sim.world;
  const path = testInfo.outputPath('stalls-kiosk.park');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serialize(world));
  const dir = PROOF_DIR ?? testInfo.outputPath('proof');
  await openScene(page, path, true);

  await page.locator('.game-toolbar').getByRole('button', { name: 'Rides', exact: true }).click();
  const list = page.locator('[data-panel="ride-list"]');
  await list.getByRole('tab', { name: 'Shops and stalls' }).click();
  await list.locator('.list-row').filter({ hasText: 'Information Kiosk' }).click();
  const kioskId = scene.stalls.get(RideType.InformationKiosk)!;
  const win = page.locator(`[data-panel="ride-${kioskId}"]`);
  await win.getByRole('tab', { name: 'Financial data', exact: true }).click();
  await expect(win.getByRole('textbox', { name: 'Price of Park Map' })).toHaveValue('0.60');
  await expect(win.getByRole('textbox', { name: 'Price of Umbrella' })).toHaveValue('2.50');
  await expect(win).toContainText('Worth to guests today');
  const umbrellas = win
    .locator('.stat-row')
    .filter({ hasText: 'Sold' })
    .nth(1)
    .locator('.stat-value');
  await expect(umbrellas).not.toHaveText('0');
  await save(`${dir}/stall-window-kiosk.png`, await win.screenshot(), testInfo, 'kiosk');
});

test('a balloon stall window lists the item, and its price can be changed', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const scene = stallScene(WeatherKind.Sunny);
  const world = scene.sim.world;
  const path = testInfo.outputPath('stalls-balloon.park');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serialize(world));
  const dir = PROOF_DIR ?? testInfo.outputPath('proof');
  await openScene(page, path, true);

  await page.locator('.game-toolbar').getByRole('button', { name: 'Rides', exact: true }).click();
  const list = page.locator('[data-panel="ride-list"]');
  await list.getByRole('tab', { name: 'Shops and stalls' }).click();
  await list.locator('.list-row').filter({ hasText: 'Balloon Stall' }).click();
  const balloonId = scene.stalls.get(RideType.BalloonStall)!;
  const balloon = page.locator(`[data-panel="ride-${balloonId}"]`);
  await balloon.getByRole('tab', { name: 'Financial data', exact: true }).click();
  const price = balloon.getByRole('textbox', { name: 'Price of Balloon' });
  await expect(price).toHaveValue('0.90');
  await save(`${dir}/stall-window-balloon.png`, await balloon.screenshot(), testInfo, 'balloon');
  await price.fill('1.10');
  await price.press('Enter');
  await expect(price).toHaveValue('1.10');
});

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { World } from '../src/sim/core/world';
import { serialize } from '../src/save/save';
import { RideType } from '../src/sim/rides/ride-types';
import { createRide } from '../src/sim/rides/ride-operations';
import { PIECES } from '../src/sim/track/catalog';
import { parseScenarioFile } from '../src/sim/scenario/scenario-file';
import { prepareScenario } from '../src/sim/scenario/scenario-layout';
import { readFileSync } from 'node:fs';
import { hoverGameTile, startStarterPark } from './footpath-helpers';

const scenario = parseScenarioFile(
  JSON.parse(
    readFileSync(new URL('../src/sim/scenario/scenarios/starter.json', import.meta.url), 'utf8'),
  ),
);
const RIDE_TILE = { x: 27, y: 42 };

async function loadOverlapPark(
  page: Page,
  outputPath: string,
): Promise<{ world: World; coasterId: number }> {
  const world = new World({
    seed: scenario.seed,
    width: scenario.mapWidth,
    height: scenario.mapHeight,
  });
  prepareScenario(world, scenario);
  world.research.unlocked.add(RideType.MerryGoRound);
  world.research.unlocked.add(RideType.WoodenCoaster);
  createRide(world, RideType.MerryGoRound, 26, 41);
  const coasterId = createRide(world, RideType.WoodenCoaster, 5, 5);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialize(world));
  await startStarterPark(page);
  await page
    .locator('.game-toolbar')
    .getByRole('button', { name: 'Save / Load', exact: true })
    .click();
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(outputPath);
  await expect(page.locator('.hud')).toContainText('tick');
  await page.locator('.game-toolbar').getByRole('button', { name: 'Rides', exact: true }).click();
  const coasterRow = page
    .locator('[data-panel="ride-list"] .list-row')
    .filter({ hasText: 'Wooden Coaster' });
  await expect(coasterRow).toBeVisible();
  await coasterRow.click();
  await page
    .locator(`[data-panel="ride-${coasterId + 1}"]`)
    .getByRole('button', { name: 'Edit track' })
    .click();
  return { world, coasterId };
}

async function captureAllViews(page: Page, prefix: string): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let rotation = 0; rotation < 4; rotation++) {
    const path = `.local/pr-proof/${prefix}-rotation-${rotation}.png`;
    await mkdir(dirname(path), { recursive: true });
    await page.screenshot({ path, fullPage: true });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
  }
}

for (const renderer of ['webgl2', 'canvas2d'] as const) {
  test(`universal ride clearance preview and overpass proof (${renderer})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    if (renderer === 'canvas2d') {
      await page.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (id: string, ...args: unknown[]) {
          if (id === 'webgl2') return null;
          return getContext.call(
            this,
            id as '2d',
            ...(args as [CanvasRenderingContext2DSettings?]),
          );
        };
      });
    }
    const { world, coasterId } = await loadOverlapPark(page, testInfo.outputPath('overlap.park'));
    await expect(page.locator('.hud')).toContainText(renderer === 'webgl2' ? 'WebGL2' : 'Canvas2D');
    await page
      .locator('[data-panel="construction"] [aria-label="Special elements"]')
      .selectOption({ label: 'Station' });
    await hoverGameTile(page, world, RIDE_TILE);
    await expect(page.locator('.track-preview')).toBeVisible();
    await expect
      .poll(() =>
        page.locator('.track-preview').evaluate((canvas) => {
          const c = canvas as HTMLCanvasElement;
          const pixels = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          for (let i = 0; i < pixels.length; i += 4)
            if (pixels[i]! > 150 && pixels[i + 1]! < 150 && pixels[i + 3]! > 0) return true;
          return false;
        }),
      )
      .toBe(true);
    await page.screenshot({ path: `.local/pr-proof/${renderer}-refused.png`, fullPage: true });
    await captureAllViews(page, `${renderer}-refused`);
    await page
      .locator('[data-panel="construction"]')
      .getByRole('button', { name: 'Build piece' })
      .click();
    await expect(page.locator('.coaster-feedback')).toContainText('Blocked by Merry-Go-Round 1');
    await expect(page.locator('.coaster-info')).toContainText('Track 0 pieces');

    const station = PIECES.find((piece) => piece.shape === 'station')!;
    await page.evaluate(
      ({ pieceType, x, y }) => {
        (window as unknown as { __sim: { command: (command: unknown) => void } }).__sim.command({
          type: 'placeTrack',
          rideId: coasterId,
          pieceType,
          x,
          y,
          z: 8,
          dir: 0,
          mode: 0,
        });
      },
      { pieceType: station.id, ...RIDE_TILE, coasterId },
    );
    await expect(page.locator('.coaster-info')).toContainText('Track 1 pieces');
    await page.screenshot({ path: `.local/pr-proof/${renderer}-overpass.png`, fullPage: true });
    await testInfo.attach(`${renderer}-overpass`, {
      path: `.local/pr-proof/${renderer}-overpass.png`,
      contentType: 'image/png',
    });
  });
}

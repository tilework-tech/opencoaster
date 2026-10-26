import { readFileSync } from 'node:fs';
import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { World } from '../src/sim/core/world';
import { TILE_UNITS, Z_STEP } from '../src/sim/core/constants';
import { parseScenarioFile } from '../src/sim/scenario/scenario-file';
import { prepareScenario } from '../src/sim/scenario/scenario-layout';
import { RIDE_CATALOG } from '../src/sim/rides/ride-types';
import type { RideType } from '../src/sim/rides/ride-types';
import { project } from '../src/render/projection';
import { expect, startScenario } from './support/park';

const meadowbrook = parseScenarioFile(
  JSON.parse(
    readFileSync(
      new URL('../src/sim/scenario/scenarios/meadowbrook.json', import.meta.url),
      'utf8',
    ),
  ),
);

function meadowbrookWorld(): World {
  const world = new World({
    seed: meadowbrook.seed,
    width: meadowbrook.mapWidth,
    height: meadowbrook.mapHeight,
  });
  prepareScenario(world, meadowbrook);
  return world;
}

/** Standing rides of the scenario with the tile each occupies. */
function prebuiltRides(world: World): Array<{ id: number; name: string; x: number; y: number }> {
  const out = [];
  const cols = world.rides.cols;
  for (let slot = 0; slot < world.rides.count; slot++) {
    const def = RIDE_CATALOG[cols.typeId[slot] as RideType];
    const [dx, dy] = def.footprint[0];
    out.push({
      id: world.rides.slotToId[slot],
      name: def.name,
      x: cols.rideX[slot] + dx,
      y: cols.rideY[slot] + dy,
    });
  }
  return out;
}

/** Moves the camera so tile (x, y) sits at the upper middle of the view; returns its client point. */
async function aimAt(page: Page, world: World, x: number, y: number): Promise<[number, number]> {
  const canvas = await page.locator('#game').boundingBox();
  if (!canvas) throw new Error('Game canvas is not visible');
  const camera = await page.evaluate(() => {
    const value = (window as unknown as { __camera: { zoom: number; rotation: 0 | 1 | 2 | 3 } })
      .__camera;
    return { zoom: value.zoom, rotation: value.rotation };
  });
  const map = world.map;
  const projected = new Float64Array(2);
  project(
    (x + 0.5) * TILE_UNITS,
    (y + 0.5) * TILE_UNITS,
    map.heights[map.index(x, y)] * Z_STEP,
    map.width,
    map.height,
    camera.rotation,
    projected,
  );
  const local = { x: canvas.width * 0.5, y: canvas.height * 0.3 };
  await page.evaluate(
    ({ x, y }) => {
      const current = (window as unknown as { __camera: { x: number; y: number } }).__camera;
      current.x = x;
      current.y = y;
    },
    {
      x: projected[0] - (local.x - canvas.width / 2) / camera.zoom,
      y: projected[1] - (local.y - canvas.height / 2) / camera.zoom,
    },
  );
  return [canvas.x + local.x, canvas.y + local.y];
}

/** Right-clicks and reports whether the game suppressed the browser's context menu. */
async function rightClick(page: Page, at: [number, number]): Promise<boolean> {
  await page.evaluate(() => {
    const audit = window as unknown as { __contextMenuPrevented?: boolean };
    delete audit.__contextMenuPrevented;
    window.addEventListener(
      'contextmenu',
      (event) => {
        audit.__contextMenuPrevented = event.defaultPrevented;
      },
      { once: true },
    );
  });
  await page.mouse.click(at[0], at[1], { button: 'right' });
  return page.evaluate(
    () =>
      (window as unknown as { __contextMenuPrevented?: boolean }).__contextMenuPrevented === true,
  );
}

async function closeWindows(page: Page): Promise<void> {
  const close = page.locator('.ui-window button[aria-label^="Close"]');
  while (await close.count()) await close.first().click();
}

test.describe('map right-click', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(180_000);
    await startScenario(page, 'Meadowbrook Green');
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __camera: { x: number } }).__camera.x),
      )
      .not.toBe(0);
    await closeWindows(page);
  });

  test('in select mode opens the ride or stall under the pointer instead of the browser menu', async ({
    page,
  }) => {
    const world = meadowbrookWorld();
    const rides = prebuiltRides(world);
    expect(rides.length).toBeGreaterThanOrEqual(2);
    for (const ride of rides) {
      const at = await aimAt(page, world, ride.x, ride.y);
      expect(await rightClick(page, at)).toBe(true);
      await expect(page.locator(`.ui-window[data-panel="ride-${ride.id}"]`)).toBeVisible();
      await expect(page.locator('.tool-status')).toContainText(
        `Ride ${ride.id + 1} information opened`,
      );
      await closeWindows(page);
    }
  });

  test('with the patrol tool removes the patrol tile instead of showing the browser menu', async ({
    page,
  }) => {
    const toolbar = page.locator('.game-toolbar');
    await toolbar.getByRole('button', { name: 'Staff', exact: true }).click();
    const staff = page.locator('[data-panel="staff"]');
    await staff.getByRole('button', { name: 'Hire Handyman' }).click();
    await staff.getByRole('button', { name: /Open Handyman .* details/ }).click();
    const worker = page.locator('[data-panel^="worker-"]');
    await worker.getByRole('tab', { name: 'Orders' }).click();
    await worker.getByRole('button', { name: /Edit.*patrol area/ }).click();
    await expect(page.locator('.tool-status')).toContainText('Patrol tool selected');

    const world = meadowbrookWorld();
    const at = await aimAt(page, world, world.park.entranceX, world.park.entranceY - 3);
    await page.mouse.click(...at);
    const added = await page.locator('.tool-status').innerText();
    expect(added).toMatch(/Patrol tile added to \d+, \d+/);
    const tile = added.match(/(\d+, \d+)/)![1];

    expect(await rightClick(page, at)).toBe(true);
    await expect(page.locator('.tool-status')).toContainText(`Patrol tile removed from ${tile}`);
  });
});

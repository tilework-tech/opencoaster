import { expect, test } from './support/test';
import type { Page } from './support/test';
import { importWorld, openPage } from './support/park';
import { toolbarTool } from './footpath-helpers';
import { project } from '../src/render/projection';
import { TILE_UNITS, Z_STEP } from '../src/sim/core/constants';
import { EXIT, EXIT_FRONT, EXIT_SIDES, MAP_SIZE, crowdedExitPark } from './support/exit-path-park';

interface Occupancy {
  tick: number;
  guests: number;
  onExit: number;
  onSides: number;
  onFront: number;
}

/** Reads where the live game's guests stand, in tiles. */
async function occupancy(page: Page): Promise<Occupancy> {
  return page.evaluate(
    ([exit, front, sides]) => {
      const sim = (
        window as unknown as {
          __sim: {
            latest: { tick: number; guests: { count: number; data: Int32Array } };
          };
        }
      ).__sim;
      const snap = sim.latest;
      const at = (t: { x: number; y: number }, x: number, y: number) => t.x === x && t.y === y;
      const result = {
        tick: snap.tick,
        guests: snap.guests.count,
        onExit: 0,
        onSides: 0,
        onFront: 0,
      };
      for (let i = 0; i < snap.guests.count; i++) {
        const x = snap.guests.data[i * 4]! >> 8;
        const y = snap.guests.data[i * 4 + 1]! >> 8;
        if (at(exit!, x, y)) result.onExit++;
        if (sides!.some((s) => at(s, x, y))) result.onSides++;
        if (at(front!, x, y)) result.onFront++;
      }
      return result;
    },
    [EXIT, EXIT_FRONT, EXIT_SIDES] as const,
  );
}

/** Centres the camera on a tile at a zoom that shows the hut and the lanes beside it. */
async function frame(page: Page, tile: { x: number; y: number }, zoom: number): Promise<void> {
  const out = new Float64Array(2);
  project(
    (tile.x + 0.5) * TILE_UNITS,
    (tile.y + 0.5) * TILE_UNITS,
    4 * Z_STEP,
    MAP_SIZE,
    MAP_SIZE,
    0,
    out,
  );
  await page.evaluate(
    ([x, y, z]) => {
      const camera = (window as unknown as { __camera: { x: number; y: number; zoom: number } })
        .__camera;
      camera.zoom = z!;
      camera.x = x!;
      camera.y = y!;
    },
    [out[0]!, out[1]!, zoom] as const,
  );
}

test('a crowd on the footpath beside a ride exit never steps onto the hut', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const page = await openPage(browser, false);
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.locator('.game-toolbar')).toBeVisible();
  await importWorld(page, crowdedExitPark());
  await frame(page, EXIT, 3);
  await toolbarTool(page, 'Game speed 4×');

  let guests = 0;
  let onExit = 0;
  let onSides = 0;
  let onFront = 0;
  let lastTick = -1;
  for (let sample = 0; sample < 90; sample++) {
    const seen = await occupancy(page);
    if (seen.tick === lastTick) {
      await page.waitForTimeout(100);
      continue;
    }
    lastTick = seen.tick;
    guests = Math.max(guests, seen.guests);
    onExit += seen.onExit;
    onSides += seen.onSides;
    onFront += seen.onFront;
    if (process.env.EXIT_PROOF_DIR && (sample === 10 || sample === 30 || sample === 50)) {
      await page.screenshot({ path: `${process.env.EXIT_PROOF_DIR}/crowd-${sample}.png` });
    }
    if (sample === 30) {
      const path = testInfo.outputPath('exit-crowd.png');
      await page.screenshot({ path });
      await testInfo.attach('exit-crowd', { path, contentType: 'image/png' });
    }
    await page.waitForTimeout(200);
  }

  if (process.env.EXIT_PROOF_DIR)
    console.log(`PROOF guests=${guests} onExit=${onExit} onSides=${onSides} onFront=${onFront}`);
  expect(guests).toBeGreaterThanOrEqual(40);
  expect(onSides).toBeGreaterThan(0);
  expect(onFront).toBeGreaterThan(0);
  expect(onExit).toBe(0);
});

import { mkdir, writeFile } from 'node:fs/promises';
import { expect } from './test';
import type { Page, TestInfo } from './test';
import {
  MAP_CENTER,
  centerMapOnTile,
  chooseRide,
  startStarterPark,
  toolbarAction,
  unlockRides,
} from './footprints';
import type { Tile } from './footprints';
import { screenPointOfTileCoord } from './shots';
import { RideType } from '../../src/sim/rides/ride-types';
import { RideState } from '../../src/sim/rides/ride-store';
import { RideInfo, RIDE_INFO_STRIDE } from '../../src/worker/snapshot';
import {
  DEFAULT_TOWER_HEIGHT,
  MIN_TOWER_HEIGHT,
  observationTowerCost,
} from '../../src/sim/rides/observation-tower';

/**
 * Directory that receives screenshots, videos and timing data when set; used to capture the proof
 * attached to the pull request. Without it the spec is an ordinary regression test.
 */
export const PROOF_DIR = process.env.TOWER_PROOF_DIR;
export const TICKS_PER_SECOND = 40;
export const TOWER_BASE_COST = 250_000;

/** Starter Park land is flat at this level; the owned block spans x 16-47, y 34-47. */
export const SITE_LEVEL = 4;
export const ROW_Y = 43;
export const STREET_Y = 45;
export const PARK_PATH_X = 26;

export interface TowerPlan {
  name: string;
  height: number;
  x: number;
}

export const SHORT: TowerPlan = { name: 'short', height: MIN_TOWER_HEIGHT, x: 25 };
export const MEDIUM: TowerPlan = { name: 'medium', height: 24, x: 21 };
export const TALL: TowerPlan = { name: 'tall', height: 48, x: 17 };

/**
 * Footpaths laid before the towers are built. Each tower stands on row 43 with its entrance on the
 * tile south of it, fronting the street along y = 45, and its exit on the tile east of it, with a
 * run of two tiles down to the same street. The street joins the park's own path at (27, 43).
 */
export function sitePaths(plans: readonly TowerPlan[]): Tile[] {
  const tiles: Tile[] = [];
  const west = Math.min(...plans.map(({ x }) => x));
  for (let x = west; x <= PARK_PATH_X + 1; x++) tiles.push([x, STREET_Y]);
  tiles.push([PARK_PATH_X + 1, ROW_Y + 1]);
  for (const { x } of plans) {
    tiles.push([x, ROW_Y + 1]);
    if (x + 1 === PARK_PATH_X) continue;
    tiles.push([x + 1, ROW_Y], [x + 2, ROW_Y], [x + 2, ROW_Y + 1]);
  }
  return tiles;
}

/** Page point at the middle of a tile's top face in the current camera and rotation. */
export async function tilePoint(page: Page, [x, y]: Tile): Promise<{ x: number; y: number }> {
  return screenPointOfTileCoord(page, [x + 0.5, y + 0.5], SITE_LEVEL);
}

/** Lays footpaths with the Footpaths tool, one click per tile. */
export async function layPaths(page: Page, tiles: readonly Tile[]): Promise<void> {
  await toolbarAction(page, 'Footpaths');
  await centerMapOnTile(page, MAP_CENTER);
  for (const tile of tiles) {
    const point = await tilePoint(page, tile);
    await page.mouse.click(point.x, point.y);
    await expect
      .poll(() => page.locator('.tool-status').innerText(), { timeout: 10_000 })
      .toMatch(new RegExp(`(?:requested at| at) ${tile[0]}, ${tile[1]}\\b`));
  }
  const close = page.getByRole('button', { name: 'Close Footpaths' });
  if (await close.count()) await close.click();
}

export async function save(
  testInfo: TestInfo,
  name: string,
  bytes: Buffer | string,
): Promise<void> {
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(testInfo.outputPath(name), bytes);
  if (PROOF_DIR) {
    await mkdir(PROOF_DIR, { recursive: true });
    await writeFile(`${PROOF_DIR}/${name}`, bytes);
  }
}

export interface RideRow {
  id: number;
  state: number;
  phase: number;
  towerHeight: number;
  cabinMilli: number;
  tick: number;
  cash: number;
}

/** The ride rows of the latest snapshot, read through the development simulation handle. */
export async function rideRows(page: Page): Promise<RideRow[]> {
  return page.evaluate(
    ({ stride, fields }) => {
      const snapshot = (
        window as unknown as {
          __sim: {
            latest: {
              tick: number;
              rides: { count: number };
              rideInfo: Int32Array;
              park: { cash: number };
            };
          };
        }
      ).__sim.latest;
      return Array.from({ length: snapshot.rides.count }, (_, i) => {
        const o = i * stride;
        return {
          id: snapshot.rideInfo[o + fields.id],
          state: snapshot.rideInfo[o + fields.state],
          phase: snapshot.rideInfo[o + fields.phase],
          towerHeight: snapshot.rideInfo[o + fields.towerHeight],
          cabinMilli: snapshot.rideInfo[o + fields.cabin],
          tick: snapshot.tick,
          cash: snapshot.park.cash,
        };
      });
    },
    {
      stride: RIDE_INFO_STRIDE,
      fields: {
        id: RideInfo.Id,
        state: RideInfo.State,
        phase: RideInfo.Phase,
        towerHeight: RideInfo.TowerHeight,
        cabin: RideInfo.TowerCabinLevel,
      },
    },
  );
}

export async function rideRow(page: Page, id: number): Promise<RideRow> {
  const row = (await rideRows(page)).find((candidate) => candidate.id === id);
  if (!row) throw new Error(`Ride ${id} is not in the snapshot`);
  return row;
}

export async function parkCash(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __sim: { latest: { park: { cash: number } } } }).__sim.latest.park
        .cash,
  );
}

export function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

/** Chooses the tower, sets the ghost to `plan.height` with the on-screen controls and builds it. */
export async function buildTower(page: Page, plan: TowerPlan): Promise<number> {
  const status = page.locator('.tool-status');
  await chooseRide(page, 'Gentle rides', RideType.ObservationTower);
  const control = page.locator('.tower-height-control');
  await expect(control).toBeVisible({ timeout: 30_000 });
  await expect(control).toContainText(`${DEFAULT_TOWER_HEIGHT} levels`);
  const raise = control.getByRole('button', { name: 'Raise tower by one section' });
  const lower = control.getByRole('button', { name: 'Lower tower by one section' });
  for (let level = DEFAULT_TOWER_HEIGHT; level < plan.height; level++) await raise.click();
  for (let level = DEFAULT_TOWER_HEIGHT; level > plan.height; level--) await lower.click();
  await expect(control).toContainText(`${plan.height} levels`);
  await expect(control).toContainText(money(observationTowerCost(TOWER_BASE_COST, plan.height)));

  const anchor: Tile = [plan.x, ROW_Y];
  const point = await tilePoint(page, anchor);
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
  await expect(status).toContainText(`at ${anchor[0]}, ${anchor[1]}`, { timeout: 30_000 });
  await expect(status).toContainText('Place entrance', { timeout: 30_000 });
  await page
    .getByRole('button', { name: `Place entrance at tile ${plan.x}, ${ROW_Y + 1}` })
    .click();
  await expect(status).toContainText('Place exit', { timeout: 30_000 });
  await page.getByRole('button', { name: `Place exit at tile ${plan.x + 1}, ${ROW_Y}` }).click();
  await expect(status).toContainText('Ride setup complete', { timeout: 30_000 });
  const rows = await rideRows(page);
  return rows[rows.length - 1].id;
}

export async function startSite(
  page: Page,
  testInfo: TestInfo,
  plans: readonly TowerPlan[],
): Promise<void> {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await startStarterPark(page);
  await unlockRides(page, testInfo, [RideType.ObservationTower]);
  await layPaths(page, sitePaths(plans));
  await centerMapOnTile(page, MAP_CENTER);
  await page.keyboard.press('Escape');
  (page as unknown as { __errors: Error[] }).__errors = errors;
}

/** Software WebGL in the test browser sometimes fails to allocate the follow-viewport target. */
export const KNOWN_SOFTWARE_GL_ERRORS = ['Viewport framebuffer is incomplete'];

export function expectNoPageErrors(page: Page): void {
  const errors = (page as unknown as { __errors?: Error[] }).__errors ?? [];
  expect(
    errors
      .map((error) => error.message)
      .filter((message) => !KNOWN_SOFTWARE_GL_ERRORS.includes(message)),
  ).toEqual([]);
}

export async function buildSite(page: Page, plans: readonly TowerPlan[]): Promise<number[]> {
  const ids: number[] = [];
  for (const plan of plans) ids.push(await buildTower(page, plan));
  return ids;
}

/** The ride's window, opened from the Rides list when it is not already on screen. */
export async function rideWindow(page: Page, id: number) {
  const panel = page.locator(`[data-panel="ride-${id}"]`);
  if ((await panel.count()) === 0) {
    await toolbarAction(page, 'Rides');
    await page
      .locator('[data-panel="ride-list"] .list-row')
      .filter({ hasText: `Observation Tower ${id + 1}` })
      .click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

export type Sample = { t: number; tick: number; rides: number[][] };

/** Records every animation frame's ride phase and cabin level, for timing analysis. */
export async function startSampler(page: Page): Promise<void> {
  await page.evaluate(
    ({ stride, fields }) => {
      const sim = (
        window as unknown as {
          __sim: { latest: { tick: number; rides: { count: number }; rideInfo: Int32Array } };
        }
      ).__sim;
      const samples: Sample[] = [];
      (window as unknown as { __towerSamples: Sample[] }).__towerSamples = samples;
      const loop = (): void => {
        const snapshot = sim.latest;
        samples.push({
          t: performance.now(),
          tick: snapshot.tick,
          rides: Array.from({ length: snapshot.rides.count }, (_, i) => {
            const o = i * stride;
            return [
              snapshot.rideInfo[o + fields.id],
              snapshot.rideInfo[o + fields.phase],
              snapshot.rideInfo[o + fields.cabin],
            ];
          }),
        });
        requestAnimationFrame(loop);
      };
      loop();
    },
    {
      stride: RIDE_INFO_STRIDE,
      fields: { id: RideInfo.Id, phase: RideInfo.Phase, cabin: RideInfo.TowerCabinLevel },
    },
  );
}

export async function takeSamples(page: Page): Promise<Sample[]> {
  return page.evaluate(() => (window as unknown as { __towerSamples: Sample[] }).__towerSamples);
}

export async function openRide(page: Page, id: number): Promise<void> {
  const panel = await rideWindow(page, id);
  await panel.getByRole('button', { name: 'Open', exact: true }).click();
  await expect.poll(async () => (await rideRow(page, id)).state).toBe(RideState.Open);
}

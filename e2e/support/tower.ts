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
/** Set when the app under test is the pre-change build: no height control, older ride-info layout. */
export const BASELINE = process.env.TOWER_BASELINE === '1';
const RIDE_STRIDE = BASELINE ? 43 : RIDE_INFO_STRIDE;
export const TOWER_BASE_COST = 250_000;

/** Starter Park land is flat at this level; the owned block spans x 16-47, y 34-47. */
export const SITE_LEVEL = 4;
export const ROW_Y = 43;
export const STREET_Y = 45;
/** Column of the Starter Park's gate path (31, 44-47), which the street joins at (31, 45). */
export const GATE_PATH_X = 31;

export interface TowerPlan {
  name: string;
  height: number;
  x: number;
}

export const SHORT: TowerPlan = { name: 'short', height: MIN_TOWER_HEIGHT, x: 25 };
export const MEDIUM: TowerPlan = { name: 'medium', height: 16, x: 21 };
export const TALL: TowerPlan = { name: 'tall', height: 26, x: 17 };

/**
 * Footpaths laid before the towers are built. Each tower stands on row 43 with its entrance on the
 * tile south of it, fronting the street along y = 45, and its exit on the tile east of it, with a
 * run of two tiles down to the same street. The street joins the gate path at (31, 45).
 */
export function sitePaths(plans: readonly TowerPlan[]): Tile[] {
  const tiles: Tile[] = [];
  const west = Math.min(...plans.map(({ x }) => x));
  for (let x = west; x < GATE_PATH_X; x++) tiles.push([x, STREET_Y]);
  for (const { x } of plans)
    tiles.push([x, ROW_Y + 1], [x + 1, ROW_Y], [x + 2, ROW_Y], [x + 2, ROW_Y + 1]);
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
      stride: RIDE_STRIDE,
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
  if (!BASELINE) {
    const control = page.locator('.tower-height-control');
    await expect(control).toBeVisible({ timeout: 120_000 });
    await expect(control).toContainText(`${DEFAULT_TOWER_HEIGHT} levels`, { timeout: 120_000 });
    const raise = control.getByRole('button', { name: 'Raise tower by one section' });
    const lower = control.getByRole('button', { name: 'Lower tower by one section' });
    for (let level = DEFAULT_TOWER_HEIGHT; level < plan.height; level++) await raise.click();
    for (let level = DEFAULT_TOWER_HEIGHT; level > plan.height; level--) await lower.click();
    await expect(control).toContainText(`${plan.height} levels`, { timeout: 120_000 });
    await expect(control).toContainText(money(observationTowerCost(TOWER_BASE_COST, plan.height)));
  }

  const anchor: Tile = [plan.x, ROW_Y];
  const point = await tilePoint(page, anchor);
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
  await expect(status).toContainText(`at ${anchor[0]}, ${anchor[1]}`, { timeout: 120_000 });
  await expect(status).toContainText('Place entrance', { timeout: 120_000 });
  await page
    .getByRole('button', { name: `Place entrance at tile ${plan.x}, ${ROW_Y + 1}` })
    .click();
  await expect(status).toContainText('Place exit', { timeout: 120_000 });
  await page.getByRole('button', { name: `Place exit at tile ${plan.x + 1}, ${ROW_Y}` }).click();
  await expect(status).toContainText('Ride setup complete', { timeout: 120_000 });
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
    await page.keyboard.press('Shift+Backspace');
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
      stride: RIDE_STRIDE,
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

/** A heads-up display of the simulation clock and cabin heights, burned into captured frames. */
export async function installOverlay(page: Page, ids: readonly number[]): Promise<void> {
  await page.evaluate(
    ({ rideIds, stride, fields, tps, baseline }) => {
      const box = document.createElement('div');
      box.style.cssText =
        'position:fixed;left:8px;bottom:84px;z-index:99999;padding:6px 10px;background:#000c;color:#9f9;font:13px monospace;white-space:pre;pointer-events:none';
      document.body.append(box);
      const names = ['closed', 'waiting', 'running', 'unloading', 'broken', 'loading'];
      const started = performance.now();
      const tick0 = (window as unknown as { __sim: { latest: { tick: number } } }).__sim.latest
        .tick;
      const loop = (): void => {
        const snapshot = (
          window as unknown as {
            __sim: { latest: { tick: number; rides: { count: number }; rideInfo: Int32Array } };
          }
        ).__sim.latest;
        const lines = [
          `wall ${((performance.now() - started) / 1000).toFixed(1)} s   sim ${((snapshot.tick - tick0) / tps).toFixed(1)} s (${snapshot.tick - tick0} ticks)`,
        ];
        for (let i = 0; i < snapshot.rides.count; i++) {
          const o = i * stride;
          if (!rideIds.includes(snapshot.rideInfo[o + fields.id])) continue;
          lines.push(
            `tower ${snapshot.rideInfo[o + fields.id] + 1}: ${names[snapshot.rideInfo[o + fields.phase]] ?? '?'}` +
              (baseline
                ? ''
                : `  height ${snapshot.rideInfo[o + fields.height]}  cabin ${(snapshot.rideInfo[o + fields.cabin] / 1000).toFixed(2)}`),
          );
        }
        box.textContent = lines.join('\n');
        requestAnimationFrame(loop);
      };
      loop();
    },
    {
      rideIds: [...ids],
      stride: RIDE_STRIDE,
      fields: {
        id: RideInfo.Id,
        phase: RideInfo.Phase,
        cabin: RideInfo.TowerCabinLevel,
        height: RideInfo.TowerHeight,
      },
      tps: TICKS_PER_SECOND,
      baseline: BASELINE,
    },
  );
}

export interface Frame {
  file: string;
  t: number;
}

/** Records the page through a DevTools screencast, which delivers a frame whenever the page paints. */
export async function captureFrames(
  page: Page,
  dir: string,
): Promise<{ stop: () => Promise<Frame[]> }> {
  await mkdir(dir, { recursive: true });
  const session = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  const writes: Promise<void>[] = [];
  session.on('Page.screencastFrame', (event) => {
    const file = `${dir}/frame-${String(frames.length).padStart(6, '0')}.jpg`;
    frames.push({ file, t: event.metadata.timestamp * 1000 });
    writes.push(writeFile(file, Buffer.from(event.data, 'base64')));
    session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined);
  });
  await session.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 2 });
  return {
    stop: async () => {
      await session.send('Page.stopScreencast').catch(() => undefined);
      await Promise.all(writes);
      return frames;
    },
  };
}

/**
 * Encodes frames to a WebM that plays at the real capture rate: frames are resampled onto a 4 fps
 * timeline (each slot shows the latest frame captured by then), so one second of video is one
 * second of wall time.
 */
export async function encodeFrames(frames: readonly Frame[], output: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  const { readFile } = await import('node:fs/promises');
  const { homedir } = await import('node:os');
  const ffmpegPath = `${homedir()}/.cache/ms-playwright/ffmpeg-1013/ffmpeg-linux`;
  const fps = 8;
  const encoder = spawn(ffmpegPath, [
    '-y',
    '-f',
    'image2pipe',
    '-framerate',
    String(fps),
    '-c:v',
    'mjpeg',
    '-i',
    'pipe:0',
    '-c:v',
    'libvpx-vp9',
    '-deadline',
    'realtime',
    '-cpu-used',
    '8',
    '-b:v',
    '1200k',
    '-pix_fmt',
    'yuv420p',
    output,
  ]);
  const done = new Promise<void>((resolve, reject) => {
    encoder.on('error', reject);
    encoder.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
    );
  });
  encoder.stderr.resume();
  const start = frames[0].t;
  const slots = Math.floor((frames[frames.length - 1].t - start) / (1000 / fps)) + 1;
  let cursor = 0;
  for (let slot = 0; slot < slots; slot++) {
    const at = start + (slot * 1000) / fps;
    while (cursor + 1 < frames.length && frames[cursor + 1].t <= at) cursor++;
    if (!encoder.stdin.write(await readFile(frames[cursor].file)))
      await new Promise((resolve) => encoder.stdin.once('drain', resolve));
  }
  encoder.stdin.end();
  await done;
}

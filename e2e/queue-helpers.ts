import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { devices, expect } from '@playwright/test';
import type { Browser, Page, TestInfo } from '@playwright/test';
import { project } from '../src/render/projection';
import { TILE_UNITS, Z_STEP } from '../src/sim/core/constants';
import { createScenarioWorld, dragThrough, tileScreenPoint, toolbarTool } from './footpath-helpers';
import type { Tile } from './footpath-helpers';

/**
 * Open Grounds is flat at level 7 around the gate at (47, 74). The park below is built entirely
 * through the controls: a walkway north from the gate, a Merry-Go-Round with its entrance, exit and
 * queue line, and a path from the exit back to the walkway.
 *
 *   y=61..63            ride (52..54, 61..63), exit (51,63) -> exit path (50..48,63) -> walkway
 *   y=64  walkway (47,64) queue (48..52,64)  entrance (53,64)
 */
export const WALKWAY: Tile[] = Array.from({ length: 9 }, (_, k) => ({ x: 47, y: 70 - k }));

export interface Layout {
  ride: Tile;
  entrance: Tile;
  exit: Tile;
  /** Queue tiles to drag, ordered from the open end toward the entrance; empty for an entrance-only queue. */
  queue: Tile[];
  /** Separate drags that lay `queue`, in order; one drag over `queue` when absent. */
  queueDrags?: Tile[][];
  /** Path from the exit back to the walkway. */
  exitRun: Tile[];
}

/** A six-tile queue running east from the walkway into the entrance of a 3x3 ride. */
export const LONG_QUEUE: Layout = {
  ride: { x: 53, y: 62 },
  entrance: { x: 53, y: 64 },
  exit: { x: 51, y: 63 },
  queue: Array.from({ length: 5 }, (_, k) => ({ x: 48 + k, y: 64 })),
  exitRun: [
    { x: 50, y: 63 },
    { x: 49, y: 63 },
    { x: 48, y: 63 },
  ],
};

/**
 * A compact snake: three rows of five queue tiles in a 5x3 block, laid in three drags from the open
 * end beside the walkway, switching back twice before the entrance.
 *
 *   y=64   49 50 51 52 -> entrance (53,64)
 *   y=65   49 50 51 52
 *   y=66   48 49 50 51 52, open end (48,66) beside the walkway at (47,66)
 */
export const SNAKE_QUEUE: Layout = {
  ride: { x: 53, y: 62 },
  entrance: { x: 53, y: 64 },
  exit: { x: 51, y: 63 },
  queueDrags: [
    [48, 49, 50, 51, 52].map((x) => ({ x, y: 66 })).concat([{ x: 52, y: 65 }]),
    [
      { x: 51, y: 65 },
      { x: 50, y: 65 },
      { x: 49, y: 65 },
      { x: 49, y: 64 },
    ],
    [50, 51, 52].map((x) => ({ x, y: 64 })),
  ],
  get queue(): Tile[] {
    return this.queueDrags!.flat();
  },
  exitRun: [
    { x: 50, y: 63 },
    { x: 49, y: 63 },
    { x: 48, y: 63 },
  ],
};

/** The entrance is the whole queue: it touches the walkway, so the line holds only the loading area. */
export const SHORT_QUEUE: Layout = {
  ride: { x: 49, y: 62 },
  entrance: { x: 48, y: 64 },
  exit: { x: 47, y: 62 },
  queue: [],
  exitRun: [],
};

export interface SimProbe {
  tick: number;
  guests: Array<{ id: number; state: number; x: number; y: number }>;
  /** Guests whose recent thoughts include "queue is too long". */
  turnedAway: number;
  /** `WeatherKind` currently over the park. */
  weather: number;
  ride: {
    queueLength: number;
    flags: number;
    capacity: number;
    wait: number;
    tiles: number;
  } | null;
  queueTiles: number[];
  width: number;
}

export const world = createScenarioWorld('open-grounds');

export async function probe(page: Page): Promise<SimProbe> {
  return page.evaluate(() => {
    const sim = (
      window as unknown as {
        __sim: {
          latest: {
            tick: number;
            weather: { kind: number };
            guests: { count: number; data: Int32Array };
            guestIds: Int32Array;
            guestDetails: Int32Array;
            rides: { count: number };
            rideInfo: Int32Array;
          };
          map: { width: number; height: number; surface: Uint8Array };
        };
      }
    ).__sim;
    const snap = sim.latest;
    const map = sim.map;
    const guests = [];
    let turnedAway = 0;
    for (let i = 0; i < snap.guests.count; i++) {
      const o = i * 4;
      guests.push({
        id: snap.guestIds[i]!,
        state: snap.guests.data[o + 3]! >>> 24,
        x: snap.guests.data[o]! >> 8,
        y: snap.guests.data[o + 1]! >> 8,
      });
    }
    for (let i = 0; i < snap.guests.count; i++) {
      for (let k = 8; k < 12; k++) if (snap.guestDetails[i * 19 + k] === 7) turnedAway++;
    }
    const ride =
      snap.rides.count > 0
        ? {
            queueLength: snap.rideInfo[7]!,
            flags: snap.rideInfo[8]!,
            capacity: snap.rideInfo[29]!,
            wait: snap.rideInfo[28]!,
            tiles: snap.rideInfo[27]!,
          }
        : null;
    const queueTiles: number[] = [];
    for (let i = 0; i < map.surface.length; i++) if (map.surface[i] === 6) queueTiles.push(i);
    return {
      tick: snap.tick,
      weather: snap.weather.kind,
      guests,
      turnedAway,
      ride,
      queueTiles,
      width: map.width,
    };
  });
}

export async function focus(
  page: Page,
  tile: Tile,
  lift: number,
  view: { rotation?: 0 | 1 | 2 | 3; zoom?: number } = {},
): Promise<void> {
  const map = world.map;
  const out = new Float64Array(2);
  const rotation = view.rotation ?? 0;
  project(
    (tile.x + 0.5) * TILE_UNITS,
    (tile.y + 0.5) * TILE_UNITS,
    map.heights[map.index(tile.x, tile.y)]! * Z_STEP,
    map.width,
    map.height,
    rotation,
    out,
  );
  const viewport = await page.locator('#game').boundingBox();
  await page.evaluate(
    ([px, py, h, l, r, z]) => {
      const camera = (
        window as unknown as {
          __camera: { x: number; y: number; zoom: number; rotation: number };
        }
      ).__camera;
      if (r !== null) camera.rotation = r;
      if (z !== null) camera.zoom = z;
      camera.x = px!;
      camera.y = py! - (h! * (l! - 0.5)) / camera.zoom;
    },
    [out[0]!, out[1]!, viewport!.height, lift, view.rotation ?? null, view.zoom ?? null] as const,
  );
}

export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, timeout: 60_000 });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

export async function openPage(
  browser: Browser,
  mobile: boolean,
  options: { canvas2d?: boolean; baseURL?: string; scale?: number } = {},
): Promise<Page> {
  const { defaultBrowserType: _browserType, ...device } = mobile ? devices['Pixel 8'] : {};
  void _browserType;
  const context = await browser.newContext({
    ...device,
    baseURL: options.baseURL ?? 'http://127.0.0.1:4173',
    ...(options.scale ? { deviceScaleFactor: options.scale } : {}),
  });
  const page = await context.newPage();
  if (options.canvas2d) {
    await page.addInitScript(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
        if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
        return originalGetContext.call(this, type as '2d', ...(args as []));
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
  }
  return page;
}

export async function startOpenGrounds(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page.getByRole('tab', { name: 'Other Parks' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Open Grounds' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(page.locator('.game-toolbar')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __camera: { x: number } }).__camera.x))
    .not.toBe(0);
}

/**
 * Presses on the first tile and drags through the rest, with a finger on phones and the mouse on
 * desktop. The returned function lifts the pointer, which is what lays the run.
 */
export async function pressAndDrag(
  page: Page,
  tiles: Tile[],
  mobile: boolean,
): Promise<() => Promise<void>> {
  if (!mobile) {
    await dragThrough(page, world, tiles);
    return () => page.mouse.up();
  }
  const cdp = await page.context().newCDPSession(page);
  const point = async (tile: Tile) => {
    const [x, y] = await tileScreenPoint(page, world, tile);
    return [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }];
  };
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: await point(tiles[0]!),
  });
  for (const tile of tiles.slice(1)) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: await point(tile),
    });
    await page.waitForTimeout(40);
  }
  return async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };
}

export async function dragRun(
  page: Page,
  tiles: Tile[],
  lift: number,
  mobile: boolean,
): Promise<void> {
  await focus(page, tiles[Math.floor(tiles.length / 2)]!, lift);
  const release = await pressAndDrag(page, tiles, mobile);
  await release();
}

export async function setSpeed(page: Page, speed: number): Promise<void> {
  await toolbarTool(page, `Game speed ${speed}×`);
}

/** Builds the walkway, ride, entrance, exit and queue through the controls and opens the ride. */
export async function buildQueuedRide(
  page: Page,
  testInfo: TestInfo,
  layout: Layout,
  lift: number,
  mobile: boolean,
  options: { crowds?: number; queueLimit?: number; legacy?: boolean } = {},
): Promise<void> {
  await toolbarTool(page, 'Footpaths');
  await dragRun(page, WALKWAY, lift, mobile);
  await expect(page.locator('.tool-status')).toContainText('Laid');

  await toolbarTool(page, 'New ride');
  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  await page.locator('.ride-card[data-ride-type="1"]').click();
  await focus(page, layout.ride, lift);
  const [rx, ry] = await tileScreenPoint(page, world, layout.ride);
  if (mobile) await page.touchscreen.tap(rx, ry);
  else await page.mouse.click(rx, ry);
  await expect(page.locator('.tool-status')).toContainText('Place entrance');
  const { entrance, exit } = layout;
  await page
    .getByRole('button', { name: `Place entrance at tile ${entrance.x}, ${entrance.y}` })
    .click();
  await expect(page.locator('.tool-status')).toContainText('Place exit');
  await page.getByRole('button', { name: `Place exit at tile ${exit.x}, ${exit.y}` }).click();

  const rideWindow = page.locator('[data-panel="ride-0"]');
  const legacy = options.legacy === true;
  if (legacy) {
    // The previous build has no queue prompt: the player opens Footpaths and ticks Queue line.
    await expect(page.locator('.tool-status')).toContainText('Ride setup complete');
    await toolbarTool(page, 'Footpaths');
    await page.getByRole('button', { name: 'Queue line', exact: true }).first().click();
  } else if (layout.queue.length === 0) {
    await expect(page.locator('.tool-status')).toContainText('Ride setup complete');
  } else {
    await expect(page.locator('.tool-status')).toContainText('Build the queue');
    await expect(
      page.getByRole('button', { name: 'Queue line', exact: true }).first(),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(400);
    await screenshot(page, testInfo, 'queue-prompt');
    await expect(rideWindow.locator('.ride-checklist')).toContainText('Entrance has no queue');
  }

  if (layout.queue.length > 0) {
    await focus(page, layout.queue[Math.floor(layout.queue.length / 2)]!, lift);
    const drags = layout.queueDrags ?? [layout.queue];
    for (const [k, tiles] of drags.entries()) {
      const release = await pressAndDrag(page, tiles, mobile);
      if (drags.length === 1) {
        if (!legacy) {
          const label = page.locator('.path-ghost-label');
          await expect(label).toContainText('links to a ride entrance');
          await expect(label).toContainText('open end joins the path');
        } else await page.waitForTimeout(500);
        if (!legacy) await screenshot(page, testInfo, 'queue-ghost');
      } else if (k === drags.length - 1) await screenshot(page, testInfo, 'queue-ghost');
      await release();
      await expect(page.locator('.tool-status')).toContainText(/Laid|Queue connected/);
    }
  }
  if (layout.exitRun.length > 0) {
    if (layout.queue.length === 0) await toolbarTool(page, 'Footpaths');
    else await page.getByRole('button', { name: 'Queue line', exact: true }).first().click();
    await dragRun(page, layout.exitRun, lift, mobile);
    await expect(page.locator('.tool-status')).toContainText(/Laid|already/);
  }
  if (!legacy) await expect(rideWindow.locator('.ride-checklist')).toBeEmpty();
  await focus(page, entrance, lift);
  if (!legacy) await screenshot(page, testInfo, 'queue-built');

  const open = rideWindow.getByRole('button', { name: 'Open', exact: true });
  await toolbarTool(page, 'Rides');
  await page
    .locator('[data-panel="ride-list"] .list-row')
    .filter({ hasText: 'Merry-Go-Round' })
    .click();
  if (!(await open.isVisible())) await rideWindow.locator('.ui-titlebar').click();
  await open.click();
  await expect(rideWindow.locator('.ride-status')).toHaveText('Open');

  if (options.queueLimit !== undefined) {
    const value = rideWindow.locator('.ride-queue-limit .stat-value');
    for (
      let guard = 0;
      guard < 40 && (await value.innerText()) !== `${options.queueLimit} guests`;
      guard++
    ) {
      await rideWindow.getByRole('button', { name: 'Shorten queue limit' }).click();
      await page.waitForTimeout(250);
    }
    await expect(value).toHaveText(`${options.queueLimit} guests`);
  }

  await toolbarTool(page, 'Game options');
  for (let crowd = 0; crowd < (options.crowds ?? 1); crowd++)
    await page.getByRole('button', { name: 'Guests +1,000' }).click();
  await page.getByRole('button', { name: 'Close Options' }).click();
  if (!legacy) await setSpeed(page, 4);
  await focus(page, entrance, lift);
}

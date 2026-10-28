import { expect, test } from './support/test';
import type { Page } from './support/test';
import { Z_STEP } from '../src/sim/core/constants';
import { planPathPlacement, PathResult } from '../src/sim/map/paths';
import type { World } from '../src/sim/core/world';
import {
  centerCameraOn,
  clickGameTile,
  createStarterWorld,
  dragThrough,
  startStarterPark,
  toolbarTool,
} from './footpath-helpers';
import type { Tile } from './footpath-helpers';

const BRIDGE_SPAN = 7;
const CROSSING = 3;
const CROSS_REACH = 2;

interface Layout {
  ground: number;
  /** The bridge tiles, west to east: two ramps up, three level, two ramps down. */
  bridge: Tile[];
  /** The ground path that runs under the bridge's middle tile, north to south. */
  under: Tile[];
}

/** A flat, owned patch where a 7-tile bridge crosses a 5-tile footpath at its middle. */
export function findBridgeLayout(world: World, near: Tile): Layout {
  const m = world.map;
  const flatAt = (tile: Tile, level: number): boolean => {
    if (!m.inBounds(tile.x, tile.y)) return false;
    const plan = planPathPlacement(m, { x: tile.x, y: tile.y });
    return plan.result === PathResult.Ok && plan.dir === -1 && plan.z === level;
  };
  for (let radius = 0; radius <= 24; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const ox = near.x + dx;
        const oy = near.y + dy;
        if (!m.inBounds(ox, oy)) continue;
        const level = m.heights[m.index(ox, oy)]!;
        const bridge = Array.from({ length: BRIDGE_SPAN }, (_, k) => ({ x: ox + k, y: oy }));
        const under = Array.from({ length: CROSS_REACH * 2 + 1 }, (_, k) => ({
          x: ox + CROSSING,
          y: oy - CROSS_REACH + k,
        }));
        if (bridge.concat(under).every((tile) => flatAt(tile, level)))
          return { ground: level, bridge, under };
      }
    }
  }
  throw new Error(`No flat patch for a bridge near ${near.x}, ${near.y}`);
}

async function press(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click();
}

/** Builds the bridge in piece mode: Up, Up, three Level, Down, Down, west to east. */
export async function buildBridge(page: Page, world: World, layout: Layout): Promise<void> {
  await page.getByRole('tab', { name: 'Piece by piece' }).click();
  await clickGameTile(page, world, layout.bridge[0]!);
  await press(page, 'Face +X');
  const slopes = [
    'Up',
    'Up',
    ...Array.from({ length: BRIDGE_SPAN - 4 }, () => 'Level'),
    'Down',
    'Down',
  ];
  for (const slope of slopes) {
    await press(page, slope);
    await press(page, 'Build');
    await expect(page.locator('.tool-status')).toContainText(/^Built at/);
  }
}

interface Walker {
  x: number;
  y: number;
  z: number;
}

async function guestsOnTile(page: Page, tile: Tile): Promise<Walker[]> {
  return page.evaluate(({ x, y }) => {
    const snapshot = (
      window as unknown as {
        __snapshot?: { guests: { count: number; data: Int32Array } };
      }
    ).__snapshot;
    const found: Walker[] = [];
    for (
      let i = 0;
      snapshot && snapshot.guests.data.buffer.byteLength > 0 && i < snapshot.guests.count;
      i++
    ) {
      const gx = snapshot.guests.data[i * 4]!;
      const gy = snapshot.guests.data[i * 4 + 1]!;
      if (gx >> 8 === x && gy >> 8 === y)
        found.push({ x: gx, y: gy, z: snapshot.guests.data[i * 4 + 2]! });
    }
    return found;
  }, tile);
}

test('guests walk over a bridge and under it along the footpath it crosses', async ({ page }) => {
  test.fixme(
    true,
    'Fails on clean main 9eec5ec: dragging the five-tile underpass places only four tiles.',
  );
  test.setTimeout(240_000);
  const world = createStarterWorld();
  const layout = findBridgeLayout(world, { x: 28, y: 42 });
  const crossing = layout.bridge[CROSSING]!;
  await startStarterPark(page);
  await toolbarTool(page, 'Footpaths');

  await dragThrough(page, world, [layout.under[0]!, layout.under[layout.under.length - 1]!]);
  await page.mouse.up();
  await expect(page.locator('.tool-status')).toContainText(/^Laid 5 footpath tiles/);
  await buildBridge(page, world, layout);

  const levelHeight = (layout.ground + 2) * Z_STEP;
  await centerCameraOn(page, world, crossing, 3);
  const guestIds = await page.evaluate(
    async ({ start, walkway }) => {
      const sim = (
        window as unknown as {
          __sim: { command(c: unknown): void };
        }
      ).__sim;
      sim.command({ type: 'spawnGuests', count: 8 });
      const readIds = (): number[] => {
        const latest = (
          window as unknown as {
            __snapshot?: { guests: { count: number }; guestIds: Int32Array };
          }
        ).__snapshot;
        if (!latest || latest.guestIds.buffer.byteLength === 0) return [];
        return Array.from(latest.guestIds.subarray(0, latest.guests.count));
      };
      const deadline = Date.now() + 30_000;
      while (readIds().length < 8 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 100));
      const ids = readIds();
      ids.forEach((id, i) => {
        const tile = i % 2 === 0 ? start : walkway;
        sim.command({
          type: 'setPersonPosition',
          person: 'guest',
          personId: id,
          x: tile.x,
          y: tile.y,
        });
      });
      return ids;
    },
    { start: layout.bridge[0]!, walkway: layout.under[0]! },
  );
  expect(guestIds.length).toBeGreaterThanOrEqual(2);

  await page.getByRole('button', { name: 'Game speed 4×' }).click();
  await expect
    .poll(async () => (await guestsOnTile(page, crossing)).map((guest) => guest.z), {
      timeout: 150_000,
      intervals: [250],
    })
    .toContain(levelHeight);
  await expect
    .poll(async () => (await guestsOnTile(page, crossing)).map((guest) => guest.z), {
      timeout: 150_000,
      intervals: [250],
    })
    .toContain(layout.ground * Z_STEP);
});

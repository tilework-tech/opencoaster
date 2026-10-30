import { mkdir } from 'node:fs/promises';
import { expect, test } from './support/test';
import type { Page } from './support/test';
import { createTestContext } from './support/test-contexts';
import { devices } from './support/test';
import {
  centerCameraOn,
  clickGameTile,
  createScenarioWorld,
  hoverGameTile,
  tileScreenPoint,
} from './footpath-helpers';
import type { Tile } from './footpath-helpers';
import { importWorld, savedWorld } from './support/park';
import { serialize } from '../src/save/save';
import { placePath } from '../src/sim/map/paths';
import { RideType } from '../src/sim/rides/ride-types';
import type { World } from '../src/sim/core/world';

const proofDir = process.env.STOREFRONT_PROOF_DIR;
const useCanvas2d = process.env.CANVAS2D === '1';

/**
 * Starter Park footpaths joined to the gate path (x = 31, y 44-47): a spine north along x = 31
 * and a cross street along y = 41. Every stall site below touches exactly the paths named for it.
 */
const SPINE: Tile[] = Array.from({ length: 6 }, (_, k) => ({ x: 31, y: 43 - k }));
const STREET: Tile[] = Array.from({ length: 11 }, (_, k) => ({ x: 26 + k, y: 41 }));

interface Site {
  label: string;
  tile: Tile;
  /** Facing the stall must end up with, 0 = +x, 1 = +y, 2 = -x, 3 = -y. */
  dir: number;
  /** Quarter turns given before building, from the stall's automatic facing: T key or Rotate button. */
  turns: ReadonlyArray<'key' | 'button'>;
}

/** `RideResult` values the snapshot publishes in `RideInfo.StallFront`. */
const FRONT_OK = 0;
const FRONT_NO_PATH = 22;
/** `RideState.Open`. */
const OPEN = 1;

/** One stall per facing; the corner site also has a path on its +x side it must turn away from. */
const SITES: Site[] = [
  {
    label: 'facing +x after a full turn by key',
    tile: { x: 30, y: 39 },
    dir: 0,
    turns: ['key', 'key', 'key', 'key'],
  },
  { label: 'facing -x', tile: { x: 32, y: 39 }, dir: 2, turns: [] },
  { label: 'facing -y', tile: { x: 28, y: 42 }, dir: 3, turns: [] },
  {
    label: 'turned by button to face +y at a corner',
    tile: { x: 30, y: 40 },
    dir: 1,
    turns: ['button'],
  },
];

function parkWorld(): World {
  const world = createScenarioWorld('starter');
  for (const type of [RideType.FoodStall, RideType.DrinkStall, RideType.Toilets])
    world.research.unlocked.add(type);
  world.economy.cash = 5_000_000;
  for (const tile of [...SPINE, ...STREET]) placePath(world.map, tile);
  return world;
}

interface StallRow {
  dir: number;
  state: number;
  served: number;
  front: number;
  open: boolean;
}

async function stallAt(page: Page, tile: Tile): Promise<StallRow | null> {
  return page.evaluate(
    async ([x, y, open]) => {
      const { RideInfo, RIDE_INFO_STRIDE } = await import(
        /* @vite-ignore */ '/src/worker/snapshot.ts'
      );
      const s = (
        window as unknown as {
          __sim: { latest: { rides: { count: number }; rideInfo: Int32Array } };
        }
      ).__sim.latest;
      for (let i = 0; i < s.rides.count; i++) {
        const o = i * RIDE_INFO_STRIDE;
        if (s.rideInfo[o + RideInfo.RideX] !== x || s.rideInfo[o + RideInfo.RideY] !== y) continue;
        return {
          dir: s.rideInfo[o + RideInfo.Dir],
          state: s.rideInfo[o + RideInfo.State],
          served: s.rideInfo[o + RideInfo.GuestsServed],
          front: s.rideInfo[o + RideInfo.StallFront],
          open: s.rideInfo[o + RideInfo.State] === open,
        };
      }
      return null;
    },
    [tile.x, tile.y, OPEN] as const,
  );
}

async function openPark(page: Page, world: World): Promise<void> {
  if (useCanvas2d)
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        kind: string,
        ...rest: unknown[]
      ) {
        if (kind === 'webgl2' || kind === 'webgl' || kind === 'experimental-webgl') return null;
        return (original as (...args: unknown[]) => unknown).call(this, kind, ...rest);
      } as typeof original;
    });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.locator('.hud')).toContainText('tick', { timeout: 30_000 });
  await importWorld(page, serialize(world));
  await centerCameraOn(page, world, { x: 31, y: 41 }, 1.5);
}

async function chooseStall(page: Page, type: RideType): Promise<void> {
  const toolbar = page.locator('.game-toolbar');
  const newRide = toolbar.getByRole('button', { name: 'New ride', exact: true });
  if (!(await newRide.isVisible()))
    await toolbar.getByRole('button', { name: 'Actions', exact: true }).click();
  await toolbar.getByRole('button', { name: 'New ride', exact: true }).click();
  await page.getByRole('tab', { name: 'Shops & Stalls' }).click();
  await page.locator(`.ride-card[data-ride-type="${type}"]`).click();
}

/** Lets two animation frames run so every canvas shows the current camera and tool. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/** Waits until the frame loop has caught up with the camera and cleared the placement overlay. */
async function overlayCleared(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas.ride-placement-preview')!;
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 3; i < data.length; i += 4) if (data[i]) return false;
        return true;
      }),
    )
    .toBe(true);
  await page.waitForTimeout(500);
  await settle(page);
}

async function shot(page: Page, name: string): Promise<void> {
  if (!proofDir) return;
  await settle(page);
  await mkdir(proofDir, { recursive: true });
  await page.screenshot({ path: `${proofDir}/${useCanvas2d ? 'canvas2d' : 'webgl2'}-${name}.png` });
}

async function waitForStallArt(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { spritePages } = await import(/* @vite-ignore */ '/src/render/sprite-pages.ts');
          return spritePages.pageInfos.length > 0 && spritePages.isLoaded('stalls');
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
}

test.describe('stall storefronts', () => {
  test('rotates stalls before building and serves guests from each front', async ({ page }) => {
    test.setTimeout(300_000);
    const world = parkWorld();
    await openPark(page, world);

    for (const site of SITES) {
      await chooseStall(page, RideType.FoodStall);
      const rotate = page.getByRole('button', { name: 'Rotate stall (T)' });
      await expect(rotate).toBeVisible();
      await hoverGameTile(page, world, site.tile);
      await expect(page.locator('.tool-status')).toContainText('window faces');
      for (const turn of site.turns) {
        if (turn === 'key') await page.keyboard.press('t');
        else await rotate.click();
        await hoverGameTile(page, world, site.tile);
      }
      await expect(page.locator('.tool-status')).toContainText('onto the footpath');
      await waitForStallArt(page);
      await shot(page, `ghost-${site.dir}`);
      await clickGameTile(page, world, site.tile);
      await expect(page.locator('.tool-status')).toContainText('is open', { timeout: 10_000 });
      await expect
        .poll(() => stallAt(page, site.tile))
        .toMatchObject({ dir: site.dir, open: true, front: FRONT_OK });
      await page.keyboard.press('Escape');
    }

    await page.evaluate(() =>
      (
        window as unknown as { __sim: { command(c: unknown): void; setSpeed(n: number): void } }
      ).__sim.command({
        type: 'spawnGuests',
        count: 400,
      }),
    );
    await page.evaluate(() =>
      (window as unknown as { __sim: { setSpeed(n: number): void } }).__sim.setSpeed(8),
    );
    for (const site of SITES)
      await expect
        .poll(async () => (await stallAt(page, site.tile))?.served ?? 0, {
          timeout: 120_000,
          message: `stall ${site.label} serves guests`,
        })
        .toBeGreaterThan(0);

    await page.evaluate(() =>
      (window as unknown as { __sim: { setSpeed(n: number): void } }).__sim.setSpeed(1),
    );
    await waitForStallArt(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.mouse.move(640, 20);
    for (let rotation = 0; proofDir && rotation < 4; rotation++) {
      await centerCameraOn(page, world, { x: 31, y: 40 }, 2);
      await overlayCleared(page);
      await shot(page, `built-rotation-${rotation}`);
      if (proofDir)
        for (const site of SITES) {
          await centerCameraOn(page, world, site.tile, 4);
          await overlayCleared(page);
          const box = await page.locator('#game').boundingBox();
          await page.screenshot({
            path: `${proofDir}/${useCanvas2d ? 'canvas2d' : 'webgl2'}-stall-${site.dir}-rotation-${rotation}.png`,
            clip: {
              x: box!.x + box!.width / 2 - 170,
              y: box!.y + box!.height / 2 - 170,
              width: 340,
              height: 280,
            },
          });
        }
      await page.keyboard.press('z');
    }

    const saved = await savedWorld(page);
    await importWorld(page, serialize(saved));
    for (const site of SITES)
      await expect
        .poll(() => stallAt(page, site.tile))
        .toMatchObject({ dir: site.dir, open: true, front: FRONT_OK });
  });

  test('explains a stall whose window faces no footpath, then turns it toward a new path', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const world = parkWorld();
    await openPark(page, world);
    const site: Tile = { x: 34, y: 39 };

    await chooseStall(page, RideType.DrinkStall);
    await hoverGameTile(page, world, site);
    await expect(page.locator('.tool-status')).toContainText(
      'No footpath in front of the service window',
    );
    await waitForStallArt(page);
    await shot(page, 'ghost-refused');
    await clickGameTile(page, world, site);
    await expect(page.locator('.tool-status')).toContainText(
      'No footpath in front of the service window',
    );
    await expect
      .poll(() => stallAt(page, site))
      .toMatchObject({ dir: 0, open: true, front: FRONT_NO_PATH });

    await page.locator('.game-toolbar').getByRole('button', { name: 'Rides', exact: true }).click();
    await page.getByRole('tab', { name: 'Shops and stalls', exact: true }).click();
    await page
      .locator('[data-panel="ride-list"] .list-row')
      .filter({ hasText: 'Drink Stall' })
      .click();
    await expect(
      page.locator('.ride-checklist-label').filter({ hasText: 'No path in front of the window' }),
    ).toBeVisible();
    await shot(page, 'ride-window-reason');
    const closeButtons = page.locator('.ui-window button[aria-label^="Close"]');
    while (await closeButtons.count()) await closeButtons.first().click();

    const south: Tile = { x: site.x, y: site.y + 1 };
    await page
      .locator('.game-toolbar')
      .getByRole('button', { name: 'Footpaths', exact: true })
      .click();
    await clickGameTile(page, world, south);
    await expect(page.locator('.tool-status')).toContainText('34, 40');
    await expect.poll(() => stallAt(page, site)).toMatchObject({ dir: 0, front: FRONT_NO_PATH });

    await page.locator('.game-toolbar').getByRole('button', { name: 'Rides', exact: true }).click();
    await page.getByRole('tab', { name: 'Shops and stalls', exact: true }).click();
    await page
      .locator('[data-panel="ride-list"] .list-row')
      .filter({ hasText: 'Drink Stall' })
      .click();
    await page.getByRole('button', { name: 'Turn stall' }).click();
    while (await closeButtons.count()) await closeButtons.first().click();
    await expect(
      page.getByRole('button', { name: /Window cannot face tile 33, 39: No footpath/ }),
    ).toBeAttached();
    await shot(page, 'turn-built-stall');
    await page.getByRole('button', { name: 'Turn the window to face tile 34, 40' }).click();
    await expect(page.locator('.tool-status')).toContainText(
      'turned: it now serves from the footpath at 34, 40',
    );
    await expect
      .poll(() => stallAt(page, site))
      .toMatchObject({ dir: 1, open: true, front: FRONT_OK });
    await page.evaluate(() => {
      const sim = (
        window as unknown as { __sim: { command(c: unknown): void; setSpeed(n: number): void } }
      ).__sim;
      sim.command({ type: 'spawnGuests', count: 400 });
      sim.setSpeed(8);
    });
    await expect
      .poll(async () => (await stallAt(page, site))?.served ?? 0, { timeout: 120_000 })
      .toBeGreaterThan(0);
  });

  test('rotates a stall with the on-screen button on a phone', async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await createTestContext(browser, { ...devices['Pixel 8'] });
    const page = await context.newPage();
    const world = parkWorld();
    await openPark(page, world);
    await chooseStall(page, RideType.FoodStall);
    const rotate = page.getByRole('button', { name: 'Rotate stall (T)' });
    await expect(rotate).toBeVisible();
    await rotate.tap();
    await expect(page.locator('.tool-status')).toContainText('window faces');
    const corner = SITES[3]!;
    const [x, y] = await tileScreenPoint(page, world, corner.tile);
    await page.touchscreen.tap(x, y);
    await expect(page.locator('.tool-status')).toContainText('is open', { timeout: 10_000 });
    await expect
      .poll(() => stallAt(page, corner.tile))
      .toMatchObject({ dir: corner.dir, open: true, front: FRONT_OK });
    await waitForStallArt(page);
    await shot(page, 'phone-rotate');
  });
});

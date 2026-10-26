import { devices, expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import {
  MAP_CENTER,
  centerMapOnTile,
  chooseRide,
  footprintRing,
  footprintTiles,
  paintPaths,
  startStarterPark,
  unlockRides,
  toolbarAction,
} from './support/footprints';
import type { Tile } from './support/footprints';
import {
  changedArea,
  expectRingCandidates,
  cropJpeg,
  sheetJpeg,
  takeShot,
  screenPointOfTileCoord,
  tilePickPoint,
  writeFile,
} from './support/shots';
import type { Box, Shot } from './support/shots';

/** One tile's diamond at the default zoom: 64 x 32 CSS px. */
const TILE_AREA = (64 * 32) / 2;

/** Westmost footprint column and southmost footprint row of every ride built by this spec. */
const SITE_LEFT = 22;
const SITE_BOTTOM = 43;
/** Row of footpath running east-west just south of the footprints, joined to the park entrance. */
const STREET_Y = 44;
/** Column of the existing park path the street joins. */
const PARK_PATH_X = 26;

/** Pixels around a footprint's centre that always contain the ride's ground and sprite. */
const VIEW_BOX = { left: 230, right: 230, up: 250, down: 110 } as const;
/** Width of each pane in the saved screenshots, in CSS px. */
const PANE_WIDTH = 460;

interface FlatRide {
  slug: string;
  name: string;
  tab: string;
  type: number;
}

const FLAT_RIDES: readonly FlatRide[] = [
  { slug: 'merry-go-round', name: 'Merry-Go-Round', tab: 'Gentle rides', type: 1 },
  { slug: 'swinging-ship', name: 'Swinging Ship', tab: 'Thrill rides', type: 2 },
  { slug: 'ferris-wheel', name: 'Ferris Wheel', tab: 'Gentle rides', type: 3 },
  { slug: 'twist', name: 'Twist', tab: 'Thrill rides', type: 4 },
  { slug: 'haunted-house', name: 'Haunted House', tab: 'Thrill rides', type: 11 },
  { slug: 'spiral-slide', name: 'Spiral Slide', tab: 'Gentle rides', type: 12 },
  { slug: 'top-spin', name: 'Top Spin', tab: 'Thrill rides', type: 13 },
  { slug: 'enterprise', name: 'Enterprise', tab: 'Thrill rides', type: 14 },
  { slug: 'observation-tower', name: 'Observation Tower', tab: 'Gentle rides', type: 23 },
];

const bySlug = (slug: string): FlatRide => FLAT_RIDES.find((ride) => ride.slug === slug)!;

/** Rides turned through all four orientations: both long thin ones and a 3x3. */
const ALL_ORIENTATIONS = ['swinging-ship', 'ferris-wheel', 'top-spin'];

/**
 * Where a ride is built and which tiles it is reached from. Its footprint's southwest corner sits
 * on (SITE_LEFT, SITE_BOTTOM). The entrance is the tile west of that corner and the exit the tile
 * east of the footprint's southeast corner; both are paved and joined by a street one row south
 * to the park's own path. That ground is flat, which footpaths and boarding tiles require.
 */
function siteFor(type: number, dir: number) {
  const around = footprintTiles(type, [0, 0], dir);
  const minX = Math.min(...around.map(([x]) => x));
  const maxX = Math.max(...around.map(([x]) => x));
  const maxY = Math.max(...around.map(([, y]) => y));
  const anchor: Tile = [SITE_LEFT - minX, SITE_BOTTOM - maxY];
  const right = SITE_LEFT + (maxX - minX);
  const entrance: Tile = [SITE_LEFT - 1, SITE_BOTTOM];
  const exit: Tile = [right + 1, SITE_BOTTOM];
  const streetFrom = Math.min(entrance[0], PARK_PATH_X);
  const streetTo = Math.max(exit[0], PARK_PATH_X);
  const street: Tile[] = [];
  for (let x = streetFrom; x <= streetTo; x++) if (x !== PARK_PATH_X) street.push([x, STREET_Y]);
  return { anchor, entrance, exit, paths: [...street, entrance, exit] };
}

/** Centre of the tiles' bounding rectangle, in continuous tile units. */
function centreOf(tiles: readonly Tile[]): [number, number] {
  const xs = tiles.map(([x]) => x);
  const ys = tiles.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs) + 1) / 2, (Math.min(...ys) + Math.max(...ys) + 1) / 2];
}

/** The page rectangle that holds a footprint (and the sprite standing on it) at the current view. */
async function viewBoxAround(page: Page, tiles: readonly Tile[]): Promise<Box> {
  const centre = await screenPointOfTileCoord(page, centreOf(tiles));
  const viewport = page.viewportSize()!;
  const x = Math.max(0, centre.x - VIEW_BOX.left);
  const y = Math.max(0, centre.y - VIEW_BOX.up);
  return {
    x,
    y,
    width: Math.min(viewport.width - x, VIEW_BOX.left + VIEW_BOX.right),
    height: Math.min(viewport.height - y, VIEW_BOX.up + VIEW_BOX.down),
  };
}

/** Minimum on-screen area, in CSS px², that a ride on `tiles` must change in a screenshot. */
const minimumRideArea = (tiles: readonly Tile[]): number => tiles.length * TILE_AREA;

/** SwiftShader draws a frame every few hundred ms; wait long enough for state changes to show. */
const settleFrames = (page: Page): Promise<void> => page.waitForTimeout(450);

/** Drops the active tool, closes every window and parks the pointer off the map. */
async function clearTransientUi(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+Backspace');
  await page.mouse.move(640, 20);
  await settleFrames(page);
}

/**
 * Runs `action` with the ghost and boarding-ring overlay canvases hidden, so screenshots show the
 * ride as built. The overlays are separate canvases drawn above the world.
 */
async function withoutOverlays<T>(page: Page, action: () => Promise<T>): Promise<T> {
  const style = await page.addStyleTag({
    content: '.track-preview, .ride-placement-preview { visibility: hidden !important; }',
  });
  try {
    return await action();
  } finally {
    await style.evaluate((element) => element.remove());
  }
}

async function viewRotation(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __camera: { rotation: number } }).__camera.rotation,
  );
}

/** Turns the camera one quarter turn with the Enter shortcut and waits until it has applied. */
async function rotateView(page: Page): Promise<void> {
  const before = await viewRotation(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Enter');
  await expect.poll(() => viewRotation(page)).toBe((before + 1) % 4);
  await settleFrames(page);
}

/** Screenshots of the box around `tiles` in each of the four view rotations, ending where it began. */
async function shootAllRotations(
  page: Page,
  tiles: readonly Tile[],
): Promise<Array<{ shot: Shot; box: Box }>> {
  const views: Array<{ shot: Shot; box: Box }> = [];
  for (let turn = 0; turn < 4; turn++) {
    const box = await viewBoxAround(page, tiles);
    views.push({ shot: await takeShot(page, box), box });
    await rotateView(page);
  }
  return views;
}

async function readServed(page: Page, rideId: number): Promise<number> {
  const served = page
    .locator(`[data-panel="ride-${rideId}"] .stat-row`)
    .filter({ hasText: 'Guests served' })
    .locator('.stat-value')
    .first();
  return Number((await served.textContent()) ?? 0);
}

/** Output sink: committed assets when `FOOTPRINT_SHOTS_DIR` is set, else the test output folder. */
function shotWriter(testInfo: TestInfo) {
  const directory = process.env.FOOTPRINT_SHOTS_DIR;
  return async (name: string, bytes: Buffer) => {
    const path = directory ? `${directory}/${name}` : testInfo.outputPath(name);
    await writeFile(path, bytes);
    await testInfo.attach(name, { path, contentType: 'image/jpeg' });
  };
}

interface BuildOptions {
  ride: FlatRide;
  dir: number;
  /** Turn the ghost with the on-screen button instead of the Z key. */
  rotateWith?: 'key' | 'button';
  /** Also save a screenshot of guests riding. */
  savePlaytest?: boolean;
  canvas2d?: boolean;
  /** Skip waiting for guests to ride (Canvas2D under SwiftShader renders too slowly to wait). */
  skipRiding?: boolean;
}

async function buildAndRide(page: Page, testInfo: TestInfo, options: BuildOptions): Promise<void> {
  const { ride, dir } = options;
  const prefix = `${options.canvas2d ? 'canvas2d-' : ''}${ride.slug}-dir${dir}`;
  const save = shotWriter(testInfo);
  const site = siteFor(ride.type, dir);
  const footprint = footprintTiles(ride.type, site.anchor, dir);
  const ring = footprintRing(ride.type, site.anchor, dir);
  const status = page.locator('.tool-status');

  await startStarterPark(page);
  await unlockRides(page, testInfo, [ride.type]);
  if (options.canvas2d) await expect(page.locator('.hud')).toContainText('Canvas2D');
  await paintPaths(page, site.paths);
  await centerMapOnTile(page, MAP_CENTER);
  await clearTransientUi(page);

  const empty = await withoutOverlays(page, () => shootAllRotations(page, footprint));

  await chooseRide(page, ride.tab, ride.type);
  for (let turn = 0; turn < dir; turn++) {
    if (options.rotateWith === 'button')
      await page.getByRole('button', { name: 'Rotate ride (T)' }).click();
    else await page.keyboard.press('t');
  }
  if (dir > 0) await expect(status).toContainText('rotated');

  await page.mouse.move(640, 20);
  const box = await viewBoxAround(page, footprint);
  const idle = await takeShot(page, box);
  const anchorPoint = await tilePickPoint(page, site.anchor);
  await page.mouse.move(anchorPoint.x, anchorPoint.y);
  await expect
    .poll(async () => changedArea(idle, await takeShot(page, box), box), {
      message: 'ghost covers the footprint',
      timeout: 30_000,
      intervals: [500],
    })
    .toBeGreaterThan(minimumRideArea(footprint));
  const ghost = await takeShot(page, box);

  await page.mouse.click(anchorPoint.x, anchorPoint.y);
  await expect(status).toContainText(`at ${site.anchor[0]}, ${site.anchor[1]}`);
  await expect(status).toContainText('Place entrance');
  const candidates = page.getByRole('button', { name: /Place entrance at tile/ });
  await expect(candidates).not.toHaveCount(0);
  await expectRingCandidates(page, candidates, ring);
  await expect(
    page.getByRole('button', {
      name: `Place entrance at tile ${site.entrance[0]}, ${site.entrance[1]}`,
    }),
  ).toBeVisible();
  const ringed = await takeShot(page, box);
  await save(
    `${prefix}-placement.jpg`,
    await sheetJpeg(
      [await cropJpeg(ghost, box, PANE_WIDTH), await cropJpeg(ringed, box, PANE_WIDTH)],
      2,
    ),
  );

  await page
    .getByRole('button', {
      name: `Place entrance at tile ${site.entrance[0]}, ${site.entrance[1]}`,
    })
    .click();
  await expect(status).toContainText('Place exit');
  await page
    .getByRole('button', { name: `Place exit at tile ${site.exit[0]}, ${site.exit[1]}` })
    .click();
  await expect(status).toContainText('Ride setup complete');

  const windowId = '[data-panel="ride-0"]';
  const rideWindow = page.locator(windowId);
  await rideWindow.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(rideWindow.locator('.ride-status')).toHaveText('Open');
  await page.getByRole('button', { name: 'Close Ride #0' }).click();
  await toolbarAction(page, 'Game options');
  await page.getByRole('button', { name: 'Game speed 4×', exact: true }).click();
  await page.getByRole('button', { name: 'Guests +1,000' }).click();
  await page.getByRole('button', { name: 'Close Options' }).click();
  await clearTransientUi(page);

  const built = await withoutOverlays(page, () => shootAllRotations(page, footprint));
  const panes: Buffer[] = [];
  for (const [turn, { shot, box: viewBox }] of built.entries()) {
    const area = changedArea(empty[turn].shot, shot, viewBox);
    expect(
      area,
      `${ride.name} (orientation ${dir}) on-screen area in view rotation ${turn}`,
    ).toBeGreaterThan(minimumRideArea(footprint));
    panes.push(await cropJpeg(shot, viewBox, PANE_WIDTH));
  }
  await save(`${prefix}-views.jpg`, await sheetJpeg(panes, 2));
  if (options.skipRiding) return;

  await toolbarAction(page, 'Rides');
  await page.locator('[data-panel="ride-list"] .list-row').filter({ hasText: ride.name }).click();
  const tickAtStart = Number((await page.locator('.hud').innerText()).match(/\btick (\d+)\b/)?.[1]);
  await expect
    .poll(
      async () => {
        const tick = Number((await page.locator('.hud').innerText()).match(/\btick (\d+)\b/)?.[1]);
        if (tick > tickAtStart + 32_768)
          throw new Error(`No guests rode ${ride.name} within two in-game months`);
        return readServed(page, 0);
      },
      { timeout: 150_000, message: `${ride.name} guests served` },
    )
    .toBeGreaterThan(0);
  if (options.savePlaytest) {
    await page.getByRole('button', { name: 'Close Ride #0' }).click();
    await page.getByRole('button', { name: 'Close Rides and attractions' }).click();
    await save(`${prefix}-riding.jpg`, await cropJpeg(await takeShot(page, box), box, PANE_WIDTH));
  }
}

test.describe('flat ride footprints (WebGL2)', () => {
  test.slow();
  for (const ride of FLAT_RIDES) {
    test(`${ride.name} is built, boarded and ridden`, async ({ page }, testInfo) => {
      test.setTimeout(240_000);
      page.setDefaultTimeout(10_000);
      await buildAndRide(page, testInfo, { ride, dir: 0, savePlaytest: true });
    });
  }
  for (const slug of ALL_ORIENTATIONS) {
    for (const dir of [1, 2, 3]) {
      const ride = bySlug(slug);
      test(`${ride.name} turned ${dir} quarter turn(s) is built, boarded and ridden`, async ({
        page,
      }, testInfo) => {
        test.setTimeout(240_000);
        page.setDefaultTimeout(10_000);
        await buildAndRide(page, testInfo, {
          ride,
          dir,
          rotateWith: slug === 'ferris-wheel' && dir === 1 ? 'button' : 'key',
        });
      });
    }
  }
});

test.describe('flat ride footprints (Canvas2D)', () => {
  test.slow();
  test('Swinging Ship turned one quarter turn renders in every view rotation', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(10_000);
    await page.addInitScript(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
        if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
        return originalGetContext.call(this, type as '2d', ...(args as []));
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    await buildAndRide(page, testInfo, {
      ride: bySlug('swinging-ship'),
      dir: 1,
      canvas2d: true,
      skipRiding: true,
    });
  });
});

test('the Rotate ride button clears the phone HUD and docked windows', async ({
  browser,
}, testInfo) => {
  const { defaultBrowserType: _browserType, ...options } = devices['Pixel 8'];
  void _browserType;
  const context = await browser.newContext({ ...options, serviceWorkers: 'allow' });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await startStarterPark(page, true);
  await unlockRides(page, testInfo, [14], true);
  await chooseRide(page, 'Thrill rides', 14, true);
  const rotate = page.getByRole('button', { name: 'Rotate ride (T)' });
  await expect(rotate).toBeVisible();
  const box = (await rotate.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  for (const selector of [
    '.game-toolbar',
    '.tool-status',
    '.objective-strip',
    '.hud',
    '.ui-windows > *',
  ]) {
    for (const other of await page.locator(selector).all()) {
      const rect = await other.boundingBox();
      if (!rect) continue;
      const apart =
        box.x + box.width <= rect.x ||
        rect.x + rect.width <= box.x ||
        box.y + box.height <= rect.y ||
        rect.y + rect.height <= box.y;
      expect(apart, `Rotate ride overlaps ${selector}`).toBe(true);
    }
  }
  await context.close();
});

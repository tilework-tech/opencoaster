import { test } from './support/test';
import { docsScreenshot } from './support/docs-screenshot';
import type { Locator, Page } from './support/test';
import { ElementType, PathFlag } from '../src/sim/map/tile-map';
import type { TileMap } from '../src/sim/map/tile-map';
import {
  calibrate,
  centreOnTile,
  expect,
  hoverUntil,
  hudCash,
  openPage,
  PHONE_SHIFT,
  point,
  savedWorld,
  startStarterPark,
  toolbarAction,
} from './support/park';
import type { Calibration } from './support/park';

const SHOTS = 'docs/screenshots/area-tools';

/** Starter Park ground beside the entrance path: owned, dry, flat grass at level 4. */
const TREE_A = { x: 32, y: 43 };
const TREE_B = { x: 33, y: 44 };
/** Owned footpath tiles of the entrance spine. */
const BENCH = { x: 31, y: 44 };
const PATH = { x: 31, y: 45 };
/** Centre of the 3×3 the clear test sweeps: x 31..33, y 43..45. */
const CLEAR_CENTRE = { x: 32, y: 44 };
/** Top-left of a dry, empty, owned 2×2: x 32..33, y 41..42. */
const POND = { x: 32, y: 41 };
/** Flat unowned grass at level 2 beyond the park fence. */
const BORDER = { x: 27, y: 49 };
/** Tile the camera centres on so the border stays on screen on a phone. */
const BORDER_VIEW = { x: 27, y: 46 };
const OAK_REMOVAL_CENTS = 25;

interface Setup {
  page: Page;
  mobile: boolean;
}

function overlay(page: Page, cls: string): Locator {
  return page.locator(`.area-overlay .${cls}`);
}

function tip(page: Page): Locator {
  return page.locator('.area-tip:not([hidden])');
}

async function tapAt(setup: Setup, at: [number, number]): Promise<void> {
  if (setup.mobile) await setup.page.touchscreen.tap(...at);
  else await setup.page.mouse.click(...at);
}

async function press(setup: Setup, scope: Locator, name: string): Promise<void> {
  const control = scope.getByRole('button', { name, exact: true });
  if (setup.mobile) await control.tap();
  else await control.click();
}

async function openAreaTool(
  page: Page,
  mobile: boolean,
  name: string,
  panel: string,
  target: {
    x: number;
    y: number;
  },
): Promise<Calibration> {
  const shift = mobile ? PHONE_SHIFT : 0;
  await centreOnTile(page, target.x + shift, target.y + shift);
  await toolbarAction(page, name);
  await expect(page.locator(`.ui-window[data-panel="${panel}"]`)).toBeVisible();
  return calibrate(page, target, mobile, overlay(page, 'area-cursor'));
}

function sceneryAt(map: TileMap, x: number, y: number): number {
  let count = 0;
  for (let e = map.firstElement(map.index(x, y)); e >= 0; e = map.nextElement(e))
    if (map.elType[e] === ElementType.SmallScenery) count++;
  return count;
}

function benchAt(map: TileMap, x: number, y: number): boolean {
  const e = map.pathElement(map.index(x, y), -1);
  return e >= 0 && (map.elFlags[e] & PathFlag.Bench) !== 0;
}

/** Writes to the test output; set UPDATE_SCREENSHOTS=1 to refresh the committed copies. */
async function shot(page: Page, name: string, mobile: boolean): Promise<void> {
  const file = `${mobile ? 'pixel-8' : 'desktop'}-${name}.png`;
  await docsScreenshot(page, `${SHOTS}/${file}`);
}

for (const profile of ['desktop', 'pixel-8'] as const) {
  const mobile = profile === 'pixel-8';
  test.describe(`area tools on ${profile}`, () => {
    let setup: Setup;

    test.beforeEach(async ({ browser }) => {
      test.setTimeout(300_000);
      setup = { page: await openPage(browser, mobile), mobile };
      await startStarterPark(setup.page);
    });

    test.afterEach(async () => {
      const testInfo = test.info();
      if (testInfo.status !== testInfo.expectedStatus)
        await setup.page.screenshot({ path: testInfo.outputPath('failure.png') });
      await setup.page.context().close();
    });

    test('clear scenery previews and removes the trees and path additions in the area', async () => {
      const { page } = setup;
      const cal = await openAreaTool(page, mobile, 'Clear scenery', 'clear', CLEAR_CENTRE);

      await toolbarAction(page, 'Scenery');
      const scenery = page.locator('.ui-window[data-panel="scenery"]');
      await expect(scenery).toBeVisible();
      for (const tree of [TREE_A, TREE_B]) {
        const before = await hudCash(page);
        await tapAt(setup, point(cal, tree.x, tree.y));
        await expect.poll(() => hudCash(page)).toBeLessThan(before);
      }
      const benches = scenery.getByRole('tab', { name: 'Benches', exact: true });
      if (mobile) await benches.tap();
      else await benches.click();
      await tapAt(setup, point(cal, BENCH.x, BENCH.y));
      await expect(page.locator('.tool-status')).toContainText(`${BENCH.x}, ${BENCH.y}`);

      await toolbarAction(page, 'Clear scenery');
      const clear = page.locator('.ui-window[data-panel="clear"]');
      await expect(clear).toBeVisible();
      await press(setup, clear, 'Larger tool size');
      await press(setup, clear, 'Larger tool size');
      await expect(clear.getByRole('status', { name: 'Tool size' })).toHaveText('3×3');

      const target = point(cal, CLEAR_CENTRE.x, CLEAR_CENTRE.y);
      await hoverUntil(page, target, async () => {
        await expect(tip(page)).toHaveText('Clear 3 items: $0.50', {
          timeout: 1500,
        });
        await expect(overlay(page, 'area-sel')).toHaveCount(9, { timeout: 1500 });
        await expect(overlay(page, 'area-hit')).toHaveCount(3, { timeout: 1500 });
      });
      await shot(page, 'clear-before', mobile);

      const before = await hudCash(page);
      await tapAt(setup, target);
      await expect.poll(() => hudCash(page)).toBe(before - 2 * OAK_REMOVAL_CENTS);
      await hoverUntil(page, target, async () => {
        await expect(tip(page)).toHaveText('Nothing to clear here.', { timeout: 1500 });
      });
      await shot(page, 'clear-after', mobile);

      const map = (await savedWorld(page)).map;
      expect(sceneryAt(map, TREE_A.x, TREE_A.y)).toBe(0);
      expect(sceneryAt(map, TREE_B.x, TREE_B.y)).toBe(0);
      expect(benchAt(map, BENCH.x, BENCH.y)).toBe(false);
      expect(map.pathElement(map.index(BENCH.x, BENCH.y), -1)).toBeGreaterThanOrEqual(0);
    });

    test('clear scenery refuses land the park does not own', async () => {
      const { page } = setup;
      const cal = await openAreaTool(page, mobile, 'Clear scenery', 'clear', BORDER_VIEW);
      const target = point(cal, BORDER.x, BORDER.y);
      await hoverUntil(page, target, async () => {
        await expect(tip(page)).toHaveText('Land not owned by park!', { timeout: 1500 });
        await expect(overlay(page, 'area-bad').first()).toBeVisible({ timeout: 1500 });
      });
      const before = await hudCash(page);
      await tapAt(setup, target);
      await expect(page.locator('.tool-status')).toContainText('Clearing scenery at');
      await page.waitForTimeout(1_000);
      expect(await hudCash(page)).toBe(before);
    });

    test('water refuses to cover a footpath', async () => {
      const { page } = setup;
      const cal = await openAreaTool(page, mobile, 'Water', 'water', POND);
      const target = point(cal, PATH.x, PATH.y);
      await hoverUntil(page, target, async () => {
        await expect(tip(page)).toHaveText('Footpath in the way.', { timeout: 1500 });
      });
      const before = await hudCash(page);
      await tapAt(setup, target);
      await expect(page.locator('.tool-status')).toContainText('Raising water at');
      await page.waitForTimeout(1_000);
      expect(await hudCash(page)).toBe(before);
    });
  });
}

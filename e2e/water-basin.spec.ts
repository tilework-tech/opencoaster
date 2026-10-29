import { test } from './support/test';
import type { Locator, Page } from './support/test';
import type { TileMap } from '../src/sim/map/tile-map';
import { serialize } from '../src/save/save';
import {
  calibrate,
  centreOnTile,
  expect,
  hoverUntil,
  hudCash,
  hudTick,
  importWorld,
  openPage,
  PHONE_SHIFT,
  point,
  savedWorld,
  startStarterPark,
  toolbarAction,
} from './support/park';
import type { Calibration } from './support/park';
import { waterWorld } from './support/water-scenes';

const STEP_CENTS = 250;

interface Setup {
  page: Page;
  mobile: boolean;
}

const tip = (page: Page): Locator => page.locator('.area-tip:not([hidden])');
const cursor = (page: Page): Locator => page.locator('.area-overlay .area-cursor');

async function tapAt(setup: Setup, at: [number, number]): Promise<void> {
  if (setup.mobile) await setup.page.touchscreen.tap(...at);
  else await setup.page.mouse.click(...at);
}

async function press(setup: Setup, scope: Locator, name: string): Promise<void> {
  const control = scope.getByRole('button', { name, exact: true });
  if (setup.mobile) await control.tap();
  else await control.click();
}

async function touchDrag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
    });
  await send('touchStart', ...from);
  const steps = 12;
  for (let i = 1; i <= steps; i++)
    await send(
      'touchMove',
      from[0] + ((to[0] - from[0]) * i) / steps,
      from[1] + ((to[1] - from[1]) * i) / steps,
    );
  await send('touchEnd', ...to);
  await cdp.detach();
}

/** Water surface of every wet tile around the pit, by tile index. */
function lake(map: TileMap): Map<number, number> {
  const wet = new Map<number, number>();
  for (let i = 0; i < map.waterLevel.length; i++) {
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    const inPitArea = Math.abs(x - PIT_CENTRE.x) <= 4 && Math.abs(y - PIT_CENTRE.y) <= 4;
    if (inPitArea && map.waterLevel[i] > map.heights[i]) wet.set(i, map.waterLevel[i]);
  }
  return wet;
}

const { world: stagedWorld, scenes } = waterWorld();
const PIT = scenes.find((scene) => scene.name === 'dip')!;
const PIT_CENTRE = { x: PIT.target.x + 1, y: PIT.target.y + 1 };

for (const profile of ['desktop', 'pixel-8'] as const) {
  const mobile = profile === 'pixel-8';
  test.describe(`water on ${profile}`, () => {
    let setup: Setup;
    let cal: Calibration;
    let aim: [number, number];

    async function openWater(): Promise<Locator> {
      const { page } = setup;
      const shift = mobile ? PHONE_SHIFT : 0;
      await centreOnTile(page, PIT_CENTRE.x + shift, PIT_CENTRE.y + shift);
      await toolbarAction(page, 'Water');
      const win = page.locator('.ui-window[data-panel="water"]');
      await expect(win).toBeVisible();
      for (let i = 0; i < 2; i++) await press(setup, win, 'Larger tool size');
      await expect(win.getByRole('status', { name: 'Tool size' })).toHaveText('3×3');
      cal = await calibrate(page, PIT_CENTRE, mobile, cursor(page), stagedWorld);
      aim = point(cal, PIT_CENTRE.x, PIT_CENTRE.y);
      return win;
    }

    test.beforeEach(async ({ freshBrowser: browser }) => {
      test.setTimeout(300_000);
      setup = { page: await openPage(browser, mobile), mobile };
      await startStarterPark(setup.page);
      await importWorld(setup.page, serialize(stagedWorld));
    });

    test.afterEach(async () => {
      const testInfo = test.info();
      if (testInfo.status !== testInfo.expectedStatus)
        await setup.page.screenshot({ path: testInfo.outputPath('failure.png') });
      await setup.page.context().close();
    });

    test('a dug-out basin fills into a flat lake up to its rim and drains again', async () => {
      const { page } = setup;
      await openWater();
      const floor = stagedWorld.map.heights[stagedWorld.map.index(PIT_CENTRE.x, PIT_CENTRE.y)];

      for (const level of [floor + 1, floor + 2]) {
        await hoverUntil(page, aim, async () => {
          await expect(tip(page)).toHaveText(/^Raise water, \d+ tiles: \$/, { timeout: 1500 });
          const first = page.locator('.area-overlay .area-water').first();
          await expect(first).toHaveAttribute('data-level', String(level), { timeout: 1500 });
        });
        const flooded = await page.locator('.area-overlay .area-water').count();
        expect(flooded).toBeGreaterThanOrEqual(9);
        await expect(tip(page)).toHaveText(
          new RegExp(
            `^Raise water, ${flooded} tiles: \\$${((flooded * STEP_CENTS) / 100).toFixed(2)}$`,
          ),
        );
        const before = await hudCash(page);
        await tapAt(setup, aim);
        await expect.poll(() => hudCash(page)).toBe(before - flooded * STEP_CENTS);
      }

      await hoverUntil(page, aim, async () => {
        await expect(tip(page)).toHaveText(/^Water would spill over the bank/, { timeout: 1500 });
      });
      const cash = await hudCash(page);
      const tick = await hudTick(page);
      await tapAt(setup, aim);
      await expect.poll(() => hudTick(page)).toBeGreaterThan(tick);
      await expect.poll(() => hudCash(page)).toBe(cash);

      const filled = (await savedWorld(page)).map;
      const wet = lake(filled);
      expect(wet.size).toBeGreaterThanOrEqual(9);
      for (const [tile, level] of wet) {
        expect(level).toBe(floor + 2);
        expect(filled.heights[tile]).toBeLessThan(level);
      }
      for (const tile of wet.keys()) {
        const x = tile % filled.width;
        const y = Math.floor(tile / filled.width);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const o = filled.index(x + dx, y + dy);
          if (!wet.has(o)) expect(filled.heights[o]).toBeGreaterThanOrEqual(floor + 2);
        }
      }

      const drain = await openWater();
      await press(setup, drain, 'Lower');
      for (let step = 0; step < 2; step++) {
        await hoverUntil(page, aim, async () => {
          await expect(tip(page)).toHaveText(/^Lower water, \d+ tiles: \$/, { timeout: 1500 });
        });
        const before = await hudCash(page);
        await tapAt(setup, aim);
        await expect.poll(() => hudCash(page)).toBeLessThan(before);
      }
      await hoverUntil(page, aim, async () => {
        await expect(tip(page)).toHaveText('No water to lower here.', { timeout: 1500 });
      });
      const drained = (await savedWorld(page)).map;
      const lakeIndex = drained.index(PIT_CENTRE.x, PIT_CENTRE.y);
      expect(drained.waterLevel[lakeIndex]).toBeLessThanOrEqual(drained.heights[lakeIndex]);
      expect(lake(drained).has(lakeIndex)).toBe(false);
    });

    test('dragging up raises the water step by step and dragging down lowers it', async () => {
      const { page } = setup;
      await openWater();
      const floor = stagedWorld.map.heights[stagedWorld.map.index(PIT_CENTRE.x, PIT_CENTRE.y)];
      const drag = async (dy: number): Promise<void> => {
        const to: [number, number] = [aim[0], aim[1] + dy];
        if (mobile) await touchDrag(page, aim, to);
        else {
          await page.mouse.move(...aim);
          await page.mouse.down();
          for (let i = 1; i <= 12; i++) await page.mouse.move(aim[0], aim[1] + (dy * i) / 12);
          await page.mouse.up();
        }
      };
      await hoverUntil(page, aim, () => expect(tip(page)).toBeVisible({ timeout: 1500 }));
      await drag(-90);
      await expect.poll(() => hudCash(page)).toBeLessThan(1_000_000_00);
      const raised = (await savedWorld(page)).map;
      const center = raised.index(PIT_CENTRE.x, PIT_CENTRE.y);
      expect(raised.waterLevel[center]).toBe(floor + 2);

      const again = await openWater();
      await press(setup, again, 'Raise');
      await drag(90);
      const lowered = (await savedWorld(page)).map;
      expect(lowered.waterLevel[center]).toBeLessThanOrEqual(lowered.heights[center]);
    });
  });
}

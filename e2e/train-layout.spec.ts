import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from './support/test';
import type { Locator, Page, TestInfo } from './support/test';
import { expect, test } from './support/test';
import type { Page, TestInfo } from './support/test';
>>>>>>> 2da62ac (Improve e2e runtime instrumentation and cleanup)
import type { World } from '../src/sim/core/world';
import {
  centerCameraOn,
  clickGameTile,
  dragThrough,
  createScenarioWorld,
} from './footpath-helpers';
import type { Tile } from './footpath-helpers';

/** The last tile of the Open Grounds park-entrance path before the coaster site. */
const PARK_PATH_END: Tile = { x: 47, y: 70 };

const coasterName = 'Steel Looping Coaster';
const CORE_ACTIONS = [
  'Pause',
  'Footpaths',
  'New ride',
  'Rides',
  'Finances',
  'Staff',
  'Park',
  'Save / Load',
];

async function placeStationPart(
  page: Page,
  expected: string,
  world: World,
  center: Tile,
  at?: readonly [number, number],
): Promise<Tile> {
  await centerCameraOn(page, world, center, 1);
  const part = expected === 'Place exit' ? 'entrance' : 'exit';
  const exact = at
    ? page.getByRole('button', { name: `Place ${part} at tile ${at[0]}, ${at[1]}` })
    : null;
  const target =
    exact && (await exact.count()) > 0
      ? exact
      : page.getByRole('button', { name: new RegExp(`Place ${part} at tile`) }).first();
  const label = (await target.getAttribute('aria-label')) ?? '';
  const match = label.match(/tile (\d+), (\d+)/);
  if (!match) throw new Error(`Station part target has no tile: ${label}`);
  await target.click();
  await expect(page.locator('.tool-status')).toContainText(expected);
  return { x: Number(match[1]), y: Number(match[2]) };
}

/** Lays a footpath from the park entrance's path north to the tile in front of the ride entrance. */
async function connectToParkPath(page: Page, world: World, entrance: Tile): Promise<void> {
  await toolbarAction(page, 'Footpaths', false);
  await page.getByRole('button', { name: 'Tarmac', exact: true }).click();
  const run = Array.from({ length: PARK_PATH_END.y - entrance.y }, (_, k) => ({
    x: PARK_PATH_END.x,
    y: PARK_PATH_END.y - k,
  }));
  await centerCameraOn(page, world, entrance, 1);
  await dragThrough(page, world, run);
  await page.mouse.up();
}

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true, timeout: 30_000 });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function startStarterPark(
  page: Page,
  mobile: boolean,
  scenarioName = 'Starter Park',
): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  if (scenarioName === 'Open Grounds') await page.getByRole('tab', { name: /Other Parks/ }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: scenarioName })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  if (mobile) {
    const toolbar = page.locator('.game-toolbar');
    await toolbar.getByRole('button', { name: 'Actions', exact: true }).tap();
    for (const label of CORE_ACTIONS) {
      const action = toolbar.getByRole('button', { name: label, exact: true });
      await expect(action).toBeVisible();
      const size = await action.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return [rect.width, rect.height];
      });
      expect(size[0], `${label} width`).toBeGreaterThanOrEqual(44);
      expect(size[1], `${label} height`).toBeGreaterThanOrEqual(44);
    }
    await toolbar.getByRole('button', { name: 'Actions', exact: true }).tap();
  }
}

async function toolbarAction(page: Page, name: string, mobile: boolean): Promise<void> {
  const toolbar = page.locator('.game-toolbar');
  if (mobile) await toolbar.getByRole('button', { name: 'Actions', exact: true }).tap();
  const action = toolbar.getByRole('button', { name, exact: true });
  if (mobile) await action.tap();
  else await action.click();
}

interface CarSnapshot {
  cars: { count: number };
}

const carCount = (page: Page): Promise<number> =>
  page.evaluate(
    () => (window as unknown as { __snapshot?: CarSnapshot }).__snapshot?.cars.count ?? -1,
  );

async function buildCoaster(page: Page, blockBrakes: boolean): Promise<void> {
  await startStarterPark(page, false, 'Open Grounds');
  await page.getByRole('button', { name: 'Close Park' }).click();
  const STATION: Tile = { x: 47, y: 60 };
  await toolbarAction(page, 'New ride', false);
  await page.getByRole('tab', { name: 'Roller Coasters' }).click();
  await page.getByRole('button', { name: new RegExp(`^${coasterName}`) }).click();
  const world = createScenarioWorld('open-grounds');
  await centerCameraOn(page, world, STATION, 1);
  await clickGameTile(page, world, STATION);
  const construction = page.locator('[data-panel="construction"]');
  await expect(construction).toBeVisible();
  let pieces = 0;
  const place = async (shape: string, slope: string, wanted = 'Normal') => {
    const drive = wanted === 'Block brake' && !blockBrakes ? 'Normal' : wanted;
    if (shape === 'Station')
      await construction.getByLabel('Special elements').selectOption({ label: shape });
    else await construction.getByRole('button', { name: shape, exact: true }).click();
    await construction.getByRole('button', { name: slope, exact: true }).click();
    await construction.getByLabel('Drive').selectOption({ label: drive });
    await construction.getByRole('button', { name: 'Build piece' }).click();
    pieces++;
    await expect(page.locator('.coaster-info')).toContainText(`Track ${pieces} pieces`);
  };
  await place('Station', 'Level');
  await place('Straight', 'Up', 'Chain lift');
  await place('Straight', 'Up', 'Chain lift');
  await place('Straight', 'Level', 'Chain lift');
  await place('Right small', 'Level');
  await place('Straight', 'Level', 'Block brake');
  await place('Right small', 'Level');
  await place('Straight', 'Down');
  await place('Straight', 'Down');
  await place('Straight', 'Level');
  await place('Straight', 'Level', 'Block brake');
  await place('Right small', 'Level');
  await place('Straight', 'Level', 'Block brake');
  await place('Right small', 'Level');
  await expect(page.locator('.coaster-info')).toContainText('Circuit complete');
  const title = await construction.locator('.ui-titlebar').boundingBox();
  await page.mouse.move(title!.x + 60, title!.y + 10);
  await page.mouse.down();
  await page.mouse.move(60, 500, { steps: 8 });
  await page.mouse.up();
  const entrance = await placeStationPart(page, 'Place exit', world, STATION);
  await placeStationPart(page, 'Test ride', world, STATION);
  await construction.getByRole('button', { name: 'Test', exact: true }).click();
  await toolbarAction(page, 'Game options', false);
  await page.getByRole('button', { name: /4×/ }).first().click();
  await page.getByRole('button', { name: 'Close Options' }).click();
  await expect(construction).toContainText('Test complete', { timeout: 120_000 });
  await construction.getByRole('button', { name: 'Close', exact: true }).click();
  await connectToParkPath(page, world, entrance);
}

const MODE_BLOCK = 'Continuous circuit block sectioned';

async function chooseMode(win: Locator, mode: string): Promise<void> {
  await win.getByLabel('Ride mode').selectOption({ label: mode });
  await expect(win.getByLabel('Ride mode')).toHaveValue(mode === MODE_BLOCK ? '7' : '6');
}

async function openOperatingTab(page: Page) {
  await toolbarAction(page, 'Rides', false);
  await page
    .locator('[data-panel="ride-list"] .list-row')
    .filter({ hasText: 'Steel Looping' })
    .click();
  const win = page.locator('[data-panel="ride-0"]');
  await win.getByRole('tab', { name: 'Mechanics' }).click();
  return win;
}

async function forceCanvas2D(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return original.call(this, type as '2d', ...(args as []));
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

const PROOF_DIR = process.env.PROOF_DIR;

async function proofShot(page: Page, testInfo: TestInfo, backend: string, name: string) {
  await screenshot(page, testInfo, `${backend}-${name}`);
  if (!PROOF_DIR) return;
  await mkdir(PROOF_DIR, { recursive: true });
  await page.screenshot({ path: `${PROOF_DIR}/${backend}-${name}.png` });
  if (backend === 'Canvas2D') {
    const url = await page.locator('#game').evaluate((c) => (c as HTMLCanvasElement).toDataURL());
    await writeFile(
      `${PROOF_DIR}/${backend}-${name}-canvas.png`,
      Buffer.from(url.split(',')[1]!, 'base64'),
    );
  }
}

for (const backend of ['WebGL2', 'Canvas2D'] as const) {
  test(`trains and cars set in the ride window change the coaster that is drawn (${backend})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(900_000);
    page.setDefaultTimeout(10_000);
    if (backend === 'Canvas2D') await forceCanvas2D(page);
    await buildCoaster(page, true);
    await expect(page.locator('.hud')).toContainText(backend);
    const win = await openOperatingTab(page);
    await chooseMode(win, MODE_BLOCK);
    const trains = win.getByLabel('Trains on the track (0 for automatic)');
    const cars = win.getByLabel('Cars per train (0 for default)');
    const set = win.getByRole('button', { name: 'Set trains' });
    await expect(trains).toHaveAttribute('max', '3');
    const maxCars = Number(await cars.getAttribute('max'));
    expect(maxCars).toBeGreaterThanOrEqual(2);
    const focus = async () => {
      await win
        .getByRole('button', { name: 'Locate' })
        .click({ force: true })
        .catch(() => {});
    };
    await focus();

    await trains.fill('1');
    await cars.fill('2');
    await set.click();
    await expect.poll(() => carCount(page)).toBe(2);
    await proofShot(page, testInfo, backend, 'closed-1-train-2-cars');

    await trains.fill('4');
    await expect(win.locator('.train-layout-reason')).toContainText('Block sections allow up to 3');
    await expect(win.locator('.train-layout-reason')).toContainText(
      'Add block brakes for more trains',
    );
    await expect(set).toBeDisabled();
    await trains.fill('3');
    await cars.fill(String(maxCars));
    await set.click();
    await expect.poll(() => carCount(page)).toBe(maxCars);
    await expect(trains).toHaveValue('3');
    await expect(cars).toHaveValue(String(maxCars));
    await proofShot(page, testInfo, backend, `closed-3-trains-${maxCars}-cars`);

    await win.getByRole('tab', { name: 'View' }).click();
    await win.getByRole('button', { name: 'Open', exact: true }).click();
    await win.getByRole('tab', { name: 'Mechanics' }).click();
    await expect(trains).toBeDisabled();
    await expect(win.locator('.train-layout-reason')).toContainText('Close the ride');
    const seen = new Set<number>();
    await expect
      .poll(
        async () => {
          const count = await carCount(page);
          if (count > 0) expect(count % maxCars).toBe(0);
          seen.add(count);
          return seen.has(3 * maxCars);
        },
        { timeout: 240_000, intervals: [500] },
      )
      .toBe(true);
    await proofShot(page, testInfo, backend, `open-3-trains-${maxCars}-cars`);
  });
}

test('a continuous circuit without block brakes takes several trains, and block-sectioned mode needs brakes for them', async ({
  page,
}, testInfo) => {
  test.setTimeout(900_000);
  page.setDefaultTimeout(10_000);
  await buildCoaster(page, false);
  const win = await openOperatingTab(page);
  const trains = win.getByLabel('Trains on the track (0 for automatic)');
  const cars = win.getByLabel('Cars per train (0 for default)');
  const set = win.getByRole('button', { name: 'Set trains' });
  await expect(win.getByLabel('Ride mode')).toHaveValue('6');
  expect(Number(await trains.getAttribute('max'))).toBeGreaterThanOrEqual(3);
  await trains.fill('3');
  await cars.fill('2');
  await expect(set).toBeEnabled();
  await set.click();
  await expect(trains).toHaveValue('3');
  await expect.poll(() => carCount(page)).toBe(2);
  await proofShot(page, testInfo, 'WebGL2', 'continuous-circuit-3-trains-settings');

  await chooseMode(win, MODE_BLOCK);
  await expect(trains).toHaveAttribute('max', '1');
  await trains.fill('2');
  await expect(set).toBeDisabled();
  await expect(win.locator('.train-layout-reason')).toContainText(
    'Add block brakes for more trains',
  );
  await chooseMode(win, 'Continuous circuit');

  await win.getByRole('tab', { name: 'View' }).click();
  await win.getByRole('button', { name: 'Open', exact: true }).click();
  await win.getByRole('tab', { name: 'Mechanics' }).click();
  await expect(win.getByLabel('Ride mode')).toBeDisabled();
  const seen = new Set<number>();
  await expect
    .poll(
      async () => {
        seen.add(await carCount(page));
        return seen.has(6);
      },
      { timeout: 240_000, intervals: [500] },
    )
    .toBe(true);
  await proofShot(page, testInfo, 'WebGL2', 'continuous-circuit-3-trains-running');
});

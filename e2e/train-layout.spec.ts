import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { World } from '../src/sim/core/world';
import { parseScenarioFile } from '../src/sim/scenario/scenario-file';
import { prepareScenario } from '../src/sim/scenario/scenario-layout';
import { serialize } from '../src/save/save';
import { RideType } from '../src/sim/rides/ride-types';

const coasterName = 'Steel Looping Coaster';
const starterScenario = parseScenarioFile(
  JSON.parse(
    readFileSync(new URL('../src/sim/scenario/scenarios/starter.json', import.meta.url), 'utf8'),
  ),
);

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

async function mapTileClick(
  page: Page,
  x: number,
  y: number,
  center: readonly [number, number],
  mobile: boolean,
  groundLevel = 2,
  expectCoordinates = true,
): Promise<void> {
  await centerMapOnTile(page, ...center, mobile);
  const bounds = await page.locator('#game').boundingBox();
  if (!bounds) throw new Error('Game viewport is missing');
  const clickTileX = x - 1;
  const dx = clickTileX - center[0];
  const dy = y - center[1];
  const screenX = bounds.width / 2 + (dx - dy) * 32;
  const screenY = bounds.height / 2 + (dx + dy) * 16 - groundLevel * 16;
  await page.mouse.click(bounds.x + screenX, bounds.y + screenY);
  if (!expectCoordinates) return;
  // Footpath laying answers after the sim previews it, so wait for the status to name this tile.
  await expect
    .poll(() => page.locator('.tool-status').innerText(), { timeout: 10_000 })
    .toMatch(new RegExp(`(?:requested at| at) ${x}, ${y}\\b`));
  const status = await page.locator('.tool-status').innerText();
  const actual = status.match(/(?:requested at| at) (\d+), (\d+)/);
  expect(actual, `Expected a tile coordinate in tool status: ${status}`).not.toBeNull();
  expect([Number(actual![1]), Number(actual![2])]).toEqual([x, y]);
}

async function centerMapOnTile(page: Page, x: number, y: number, mobile: boolean): Promise<void> {
  await toolbarAction(page, 'Map', mobile);
  const minimap = page.locator('.minimap');
  await expect.poll(() => minimap.evaluate((canvas) => canvas.width)).toBe(128);
  const bounds = await minimap.boundingBox();
  if (!bounds) throw new Error('Park map is missing');
  const dimensions = await minimap.evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
  }));
  const mapHeight = dimensions.height - 1;
  const clickX = bounds.x + ((x - y + mapHeight + 0.5) / dimensions.width) * bounds.width;
  const clickY = bounds.y + (((x + y) / 2 + 0.25) / dimensions.height) * bounds.height;
  await minimap.click({ position: { x: clickX - bounds.x, y: clickY - bounds.y } });
  await page.getByRole('button', { name: 'Close Map' }).click();
}

async function placeStationPart(
  page: Page,
  expected: string,
  mobile: boolean,
  center: readonly [number, number],
  at?: readonly [number, number],
): Promise<void> {
  await centerMapOnTile(page, ...center, mobile);
  const part = expected === 'Place exit' ? 'entrance' : 'exit';
  const exact = at
    ? page.getByRole('button', { name: `Place ${part} at tile ${at[0]}, ${at[1]}` })
    : null;
  const target =
    exact && (await exact.count()) > 0
      ? exact
      : page.getByRole('button', { name: new RegExp(`Place ${part} at tile`) }).first();
  await target.click();
  await expect(page.locator('.tool-status')).toContainText(expected);
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

async function importUnlockedCoaster(
  page: Page,
  testInfo: TestInfo,
  mobile: boolean,
): Promise<void> {
  const world = new World({
    seed: starterScenario.seed,
    width: starterScenario.mapWidth,
    height: starterScenario.mapHeight,
  });
  prepareScenario(world, starterScenario);
  world.research.unlocked.add(RideType.SteelLoopingCoaster);
  const savePath = testInfo.outputPath('starter-coaster-unlocked.park');
  await writeFile(savePath, serialize(world));
  await toolbarAction(page, 'Save / Load', mobile);
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(page.locator('.hud')).toContainText('tick');
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

async function buildBlockSectionedCoaster(page: Page, testInfo: TestInfo): Promise<void> {
  await startStarterPark(page, false);
  await importUnlockedCoaster(page, testInfo, false);
  const clickTile = (x: number, y: number) => mapTileClick(page, x, y, [x, y], false);
  await toolbarAction(page, 'Footpaths', false);
  for (const [x, y] of [
    [21, 44],
    [22, 44],
    [23, 44],
    [24, 44],
    [25, 44],
    [25, 43],
    [26, 43],
    [27, 43],
    [28, 43],
  ] as const)
    await clickTile(x, y);
  await toolbarAction(page, 'New ride', false);
  await page.getByRole('tab', { name: 'Roller Coasters' }).click();
  await page.getByRole('button', { name: new RegExp(`^${coasterName}`) }).click();
  await clickTile(28, 42);
  const construction = page.locator('[data-panel="construction"]');
  await expect(construction).toBeVisible();
  let pieces = 0;
  const place = async (shape: string, slope: string, drive = 'Normal') => {
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
  await place('Straight', 'Level');
  await place('Right small', 'Level');
  await expect(page.locator('.coaster-info')).toContainText('closed circuit');
  const title = await construction.locator('.ui-titlebar').boundingBox();
  await page.mouse.move(title!.x + 60, title!.y + 10);
  await page.mouse.down();
  await page.mouse.move(60, 500, { steps: 8 });
  await page.mouse.up();
  await placeStationPart(page, 'Place exit', false, [28, 43], [28, 43]);
  await placeStationPart(page, 'Test ride', false, [28, 43], [29, 43]);
  await construction.getByRole('button', { name: 'Test', exact: true }).click();
  await toolbarAction(page, 'Game options', false);
  await page.getByRole('button', { name: /4×/ }).first().click();
  await page.getByRole('button', { name: 'Close Options' }).click();
  await expect(construction).toContainText('Test complete', { timeout: 120_000 });
  await construction.getByRole('button', { name: 'Close', exact: true }).click();
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

test('trains and cars set in the ride window change the coaster that is drawn', async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(10_000);
  await buildBlockSectionedCoaster(page, testInfo);
  const win = await openOperatingTab(page);
  const trains = win.getByLabel('Trains on the track (0 for automatic)');
  const cars = win.getByLabel('Cars per train (0 for default)');
  const set = win.getByRole('button', { name: 'Set trains' });
  await expect(trains).toHaveAttribute('max', '2');
  const maxCars = Number(await cars.getAttribute('max'));
  expect(maxCars).toBeGreaterThanOrEqual(2);

  await trains.fill('1');
  await cars.fill('2');
  await set.click();
  await expect.poll(() => carCount(page)).toBe(2);
  await screenshot(page, testInfo, 'closed-1-train-2-cars');

  await trains.fill('3');
  await expect(win.locator('.train-layout-reason')).toContainText('block sections allow up to 2');
  await expect(set).toBeDisabled();
  await trains.fill('2');
  await cars.fill(String(maxCars));
  await set.click();
  await expect.poll(() => carCount(page)).toBe(maxCars);
  await screenshot(page, testInfo, `closed-2-trains-${maxCars}-cars`);

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
        return seen.has(2 * maxCars);
      },
      { timeout: 180_000, intervals: [500] },
    )
    .toBe(true);
  await screenshot(page, testInfo, `open-2-trains-${maxCars}-cars`);
});

import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { World } from '../src/sim/core/world';
import { parseScenarioFile } from '../src/sim/scenario/scenario-file';
import { prepareScenario } from '../src/sim/scenario/scenario-layout';
import { serialize } from '../src/save/save';
import { RideType } from '../src/sim/rides/ride-types';

const starterScenario = parseScenarioFile(
  JSON.parse(
    readFileSync(new URL('../src/sim/scenario/scenarios/starter.json', import.meta.url), 'utf8'),
  ),
);

async function startStarterPark(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Starter Park' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
}

async function unlockSteelCoaster(page: Page, testInfo: TestInfo): Promise<void> {
  const world = new World({
    seed: starterScenario.seed,
    width: starterScenario.mapWidth,
    height: starterScenario.mapHeight,
  });
  prepareScenario(world, starterScenario);
  world.research.unlocked.add(RideType.SteelLoopingCoaster);
  const savePath = testInfo.outputPath('coaster-unlocked.park');
  await writeFile(savePath, serialize(world));
  await page.getByRole('button', { name: 'Save / Load', exact: true }).click();
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(page.locator('.hud')).toContainText('tick');
}

async function placeCoaster(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const minimap = page.locator('.minimap');
  await expect.poll(() => minimap.evaluate((canvas) => canvas.width)).toBe(128);
  const bounds = await minimap.boundingBox();
  if (!bounds) throw new Error('Park map is missing');
  const dimensions = await minimap.evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
  }));
  const x = 28;
  const y = 43;
  const clickX =
    bounds.x + ((x - y + dimensions.height - 1 + 0.5) / dimensions.width) * bounds.width;
  const clickY = bounds.y + (((x + y) / 2 + 0.25) / dimensions.height) * bounds.height;
  await minimap.click({ position: { x: clickX - bounds.x, y: clickY - bounds.y } });
  await page.getByRole('button', { name: 'Close Map' }).click();
  const canvas = page.locator('#game');
  const rect = await canvas.boundingBox();
  if (!rect) throw new Error('Game viewport is missing');
  await page.mouse.click(...tileScreenPoint(rect, 27, 42, 28, 43));
}

function tileScreenPoint(
  viewport: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
  centerX: number,
  centerY: number,
): [number, number] {
  const dx = x - 1 - centerX;
  const dy = y - centerY;
  return [
    viewport.x + viewport.width / 2 + (dx - dy) * 32,
    viewport.y + viewport.height / 2 + (dx + dy) * 16 - 2 * 16,
  ];
}

test('desktop construction controls fit above the fold', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await startStarterPark(page);
  expect(
    await page.locator('#game').evaluate((canvas) => Boolean(canvas.getContext('webgl2'))),
  ).toBe(true);
  await expect(page.locator('.ownership-overlay')).toBeVisible();
  await unlockSteelCoaster(page, testInfo);
  await page.getByRole('button', { name: 'New ride', exact: true }).click();
  const ridePicker = await page.locator('[data-panel="ride-select"]').boundingBox();
  expect(ridePicker).not.toBeNull();
  expect(ridePicker!.y + ridePicker!.height).toBeLessThanOrEqual(732);
  await page.getByRole('tab', { name: 'Roller Coasters' }).click();
  await page.getByRole('button', { name: /^Steel Looping Coaster/ }).click();
  await placeCoaster(page);

  const panel = page.locator('[data-panel="construction"]');
  const build = await panel.getByRole('button', { name: 'Build piece' }).boundingBox();
  expect(build).not.toBeNull();
  expect(build!.y + build!.height).toBeLessThanOrEqual(800);
  await page.screenshot({ path: 'docs/playtest/assets/p1-after-coaster-controls.png' });

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Build piece' })).toBeEnabled();
  await panel.getByRole('button', { name: 'Build piece' }).click();
  await expect(page.locator('.coaster-info')).toContainText('Track 1 pieces');

  await page.getByRole('button', { name: 'Game speed 4×', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Game speed 2×', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: 'Rides', exact: true }).click();
  await page.locator('[data-panel="ride-list"] .list-row').first().click();
  await expect(page.locator('[data-panel="ride-0"] .ride-preview')).toBeVisible();
  await expect(page.locator('[data-panel="ride-0"] [role="tab"]')).toHaveCount(8);
  await page.screenshot({ path: 'docs/playtest/assets/p1-after-ride-preview.png' });
});

test('options controls stay above the status bar', async ({ page }) => {
  await startStarterPark(page);
  await page.getByRole('button', { name: 'Game options', exact: true }).click();
  const options = page.locator('[data-panel="options"]');
  const bounds = await options.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(732);
  await options.getByRole('tab', { name: 'Display' }).click();
  await options.getByRole('checkbox', { name: 'Gridlines' }).check();
  await expect(options.getByRole('checkbox', { name: 'Gridlines' })).toBeChecked();
});

test('park windows return to their dragged position when reopened', async ({ page }) => {
  await startStarterPark(page);
  const park = page.locator('[data-panel="park"]');
  const initial = await park.boundingBox();
  expect(initial).not.toBeNull();
  await page.mouse.move(initial!.x + 70, initial!.y + 16);
  await page.mouse.down();
  await page.mouse.move(120, 140);
  await page.mouse.up();
  const moved = await park.boundingBox();
  await page.getByRole('button', { name: 'Close Park', exact: true }).click();
  await page.getByRole('button', { name: 'Park', exact: true }).click();
  const reopened = await page.locator('[data-panel="park"]').boundingBox();
  expect(reopened?.x).toBeCloseTo(moved?.x ?? -1, 0);
  expect(reopened?.y).toBeCloseTo(moved?.y ?? -1, 0);
});

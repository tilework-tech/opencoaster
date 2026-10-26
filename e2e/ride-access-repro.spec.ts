import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import { World } from '../src/sim/core/world';
import { serialize } from '../src/save/save';
import { parseScenarioFile } from '../src/sim/scenario/scenario-file';
import { prepareScenario } from '../src/sim/scenario/scenario-layout';
import { RideType } from '../src/sim/rides/ride-types';
import type { Page, TestInfo } from '@playwright/test';
import { adjacentPathTiles, clickGameTile, createScenarioWorld } from './footpath-helpers';

const starterScenario = parseScenarioFile(
  JSON.parse(
    readFileSync(new URL('../src/sim/scenario/scenarios/starter.json', import.meta.url), 'utf8'),
  ),
);

async function importFerrisUnlockedStarterPark(page: Page, testInfo: TestInfo): Promise<void> {
  const world = new World({
    seed: starterScenario.seed,
    width: starterScenario.mapWidth,
    height: starterScenario.mapHeight,
  });
  prepareScenario(world, starterScenario);
  world.research.unlocked.add(RideType.FerrisWheel);
  const savePath = testInfo.outputPath('starter-ferris-unlocked.park');
  await mkdir(dirname(savePath), { recursive: true });
  await writeFile(savePath, serialize(world));
  await toolbarAction(page, 'Save / Load');
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(page.locator('.hud')).toContainText('tick');
}

async function toolbarAction(page: Page, name: string): Promise<void> {
  await page.locator('.game-toolbar').getByRole('button', { name, exact: true }).click();
}

async function centerMapOnTile(page: Page, x: number, y: number): Promise<void> {
  await toolbarAction(page, 'Map');
  const minimap = page.locator('.minimap');
  await expect.poll(() => minimap.evaluate((canvas) => canvas.width)).toBeLessThan(300);
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

async function clickTile(
  page: Page,
  x: number,
  y: number,
  center: readonly [number, number],
): Promise<void> {
  await centerMapOnTile(page, ...center);
  const bounds = await page.locator('#game').boundingBox();
  if (!bounds) throw new Error('Game viewport is missing');
  const dx = x - 1 - center[0];
  const dy = y - center[1];
  await page.mouse.click(
    bounds.x + bounds.width / 2 + (dx - dy) * 32,
    bounds.y + bounds.height / 2 + (dx + dy) * 16 - 32,
  );
}

async function clickViewportCenter(page: Page): Promise<void> {
  const game = page.locator('#game');
  const bounds = await game.boundingBox();
  if (!bounds) throw new Error('Game viewport is missing');
  await game.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
}

async function connectEntranceWithPath(
  page: Page,
  world: ReturnType<typeof createScenarioWorld>,
  entrance: { x: number; y: number },
): Promise<void> {
  const surfaceControl = page.getByRole('button', { name: 'Tarmac', exact: true });
  if (!(await surfaceControl.isVisible())) await toolbarAction(page, 'Footpaths');
  const titlebar = page.locator('[data-panel="paths"] .ui-titlebar');
  const bounds = await titlebar.boundingBox();
  if (!bounds) throw new Error('Footpaths window is missing its title bar');
  await page.mouse.move(bounds.x + 40, bounds.y + 12);
  await page.mouse.down();
  await page.mouse.move(80, 52, { steps: 6 });
  await page.mouse.up();
  for (const tile of adjacentPathTiles(entrance)) {
    await surfaceControl.click();
    await clickGameTile(page, world, tile);
    const status = page.locator('.tool-status');
    await expect(status).not.toContainText('Surface: Tarmac');
    const result = await status.innerText();
    if (result.startsWith('Laid footpath at') || result.startsWith('A footpath is already at'))
      return;
  }
}

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('builds, tests, opens, and demolishes a Ferris Wheel through the UI', async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(10_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Starter Park' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(page.locator('.hud')).toContainText('WebGL2');
  await importFerrisUnlockedStarterPark(page, testInfo);

  await toolbarAction(page, 'New ride');
  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  await page.locator('.ride-card[data-ride-type="3"]').click();
  await centerMapOnTile(page, 31, 42);
  await clickViewportCenter(page);
  await expect(page.locator('.tool-status')).toContainText('Place entrance');
  await expect(page.locator('.ride-placement-preview')).toBeVisible();
  await screenshot(page, testInfo, 'p0-3-ferris-before-entrance');

  const entrances = page.getByRole('button', { name: /Place entrance at tile/ });
  const entranceCount = await entrances.count();
  expect(entranceCount).toBeGreaterThan(0);
  const entranceLabel = await entrances.first().getAttribute('aria-label');
  const entranceCoordinates = entranceLabel?.match(/tile (\d+), (\d+)/);
  if (!entranceCoordinates) throw new Error('Ferris Wheel entrance candidate is missing its tile');
  const entranceTile = {
    x: Number(entranceCoordinates[1]),
    y: Number(entranceCoordinates[2]),
  };
  const world = createScenarioWorld('starter');
  await entrances.first().click();
  await expect(page.locator('.tool-status')).toContainText('Place exit');
  await screenshot(page, testInfo, 'p0-3-ferris-before-exit');
  const invalidExit = page.getByRole('button', { name: /Exit unavailable at tile/ }).first();
  await expect(invalidExit).toBeVisible();
  const ferrisExitReason = (await invalidExit.getAttribute('aria-label'))
    ?.split(': ')
    .slice(1)
    .join(': ');
  expect(ferrisExitReason).toBeTruthy();
  await invalidExit.click();
  await expect(page.locator('.tool-status')).toHaveText(ferrisExitReason!);

  const exits = page.getByRole('button', { name: /Place exit at tile/ });
  await expect(exits.first()).toBeVisible();
  await exits.first().click();
  await expect(page.locator('.tool-status')).toContainText('Ride setup complete');

  await toolbarAction(page, 'Footpaths');
  await connectEntranceWithPath(page, world, entranceTile);

  await toolbarAction(page, 'Rides');
  const ferrisRow = page
    .locator('[data-panel="ride-list"] .list-row')
    .filter({ hasText: 'Ferris Wheel' });
  await ferrisRow.click();
  const rideWindow = page.locator('[data-panel="ride-0"]');
  await expect(rideWindow).toBeVisible();
  await expect(rideWindow.locator('.ride-checklist')).not.toContainText(
    'Entrance not connected to a path',
  );
  await rideWindow.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(rideWindow.locator('.ride-status')).toHaveText('Testing');
  await expect(rideWindow.locator('.ride-status')).toHaveText('Closed', { timeout: 60_000 });
  await expect(rideWindow.locator('.stat-row').filter({ hasText: 'Test status' })).toContainText(
    'Tested',
  );
  await rideWindow.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(rideWindow.locator('.ride-status')).toHaveText('Open');
  await screenshot(page, testInfo, 'p0-3-ferris-after-open');
  page.once('dialog', (dialog) => dialog.accept());
  await rideWindow.getByRole('button', { name: 'Demolish ride', exact: true }).click();
  await expect(page.locator('[data-panel="ride-0"]')).toHaveCount(0);
});

test('builds, tests, and opens a completed looping coaster through the UI', async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(10_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page.getByRole('tab', { name: 'Other Parks' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Open Grounds' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(page.locator('.hud')).toContainText('WebGL2');
  await page.getByRole('button', { name: 'Close Park' }).click();

  const coasterCenter: readonly [number, number] = [47, 66];
  await toolbarAction(page, 'New ride');
  await page.getByRole('tab', { name: 'Roller Coasters' }).click();
  await page.getByRole('button', { name: /^Steel Looping Coaster/ }).click();
  await clickTile(page, 47, 60, coasterCenter);
  const construction = page.locator('[data-panel="construction"]');
  const titlebar = await construction.locator('.ui-titlebar').boundingBox();
  if (!titlebar) throw new Error('Ride construction window is missing its title bar');
  await page.mouse.move(titlebar.x + 40, titlebar.y + 12);
  await page.mouse.down();
  await page.mouse.move(80, 52);
  await page.mouse.up();
  let trackPieces = 0;
  const placePiece = async (shape: string, slope: string, drive = 'Normal') => {
    if (['Station', 'Loop right'].includes(shape))
      await construction.getByLabel('Special elements').selectOption({ label: shape });
    else await construction.getByRole('button', { name: shape, exact: true }).click();
    await construction.getByRole('button', { name: slope, exact: true }).click();
    await construction.getByLabel('Drive').selectOption({ label: drive });
    await construction.getByRole('button', { name: 'Build piece' }).click();
    trackPieces++;
    await expect(
      page.locator('.coaster-info'),
      `Track builder feedback: ${await construction.locator('.coaster-feedback').innerText()}`,
    ).toContainText(`Track ${trackPieces} pieces`);
  };
  for (const [shape, slope, drive] of [
    ['Station', 'Level', 'Normal'],
    ['Straight', 'Up', 'Chain lift'],
    ['Straight', 'Up', 'Chain lift'],
    ['Straight', 'Level', 'Chain lift'],
    ['Right small', 'Level', 'Normal'],
    ['Straight', 'Level', 'Normal'],
    ['Right small', 'Level', 'Normal'],
    ['Straight', 'Down', 'Normal'],
    ['Straight', 'Down', 'Normal'],
    ['Straight', 'Level', 'Normal'],
    ['Straight', 'Level', 'Normal'],
    ['Right small', 'Level', 'Normal'],
    ['Straight', 'Level', 'Normal'],
    ['Right small', 'Level', 'Normal'],
  ])
    await placePiece(shape, slope, drive);
  await expect(page.locator('.coaster-info')).toContainText('closed circuit');
  await screenshot(page, testInfo, 'p0-4-looping-coaster-before-access');
  const coasterEntrance = page.getByRole('button', { name: /Place entrance at tile/ }).first();
  await expect(coasterEntrance).toBeVisible();
  const entranceLabel = await coasterEntrance.getAttribute('aria-label');
  const entranceCoordinates = entranceLabel?.match(/tile (\d+), (\d+)/);
  if (!entranceCoordinates) throw new Error('Coaster entrance candidate is missing its tile');
  const entranceTile = {
    x: Number(entranceCoordinates[1]),
    y: Number(entranceCoordinates[2]),
  };
  const world = createScenarioWorld('open-grounds');
  await coasterEntrance.click();
  await expect(page.locator('.tool-status')).toContainText('Place exit');
  await toolbarAction(page, 'Rides');
  const coasterRow = page
    .locator('[data-panel="ride-list"] .list-row')
    .filter({ hasText: 'Steel Looping Coaster' });
  const coasterId = await coasterRow.getAttribute('data-ride-id');
  if (!coasterId) throw new Error('Steel Looping Coaster is missing its ride id');
  await coasterRow.click();
  const coasterWindow = page.locator(`[data-panel="ride-${coasterId}"]`);
  await expect(coasterWindow.locator('.ride-checklist')).toContainText('Untested');
  await expect(coasterWindow.locator('.ride-checklist')).toContainText(
    'Entrance not connected to a path',
  );
  await coasterWindow
    .locator('.ride-checklist')
    .getByRole('button', { name: 'Build path' })
    .click();
  await page.getByRole('button', { name: `Close Ride #${coasterId}` }).click();
  await page.getByRole('button', { name: 'Close Rides and attractions' }).click();
  const closeConstruction = page.getByRole('button', { name: 'Close Ride construction' });
  if ((await closeConstruction.count()) > 0) await closeConstruction.click();
  await connectEntranceWithPath(page, world, entranceTile);
  await toolbarAction(page, 'Rides');
  await coasterRow.click();
  await expect(coasterWindow.locator('.ride-checklist')).not.toContainText(
    'Entrance not connected to a path',
  );
  await coasterWindow
    .locator('.ride-checklist')
    .getByRole('button', { name: 'Place exit' })
    .click();
  await expect(page.locator('.tool-status')).toContainText('Place exit');
  await page.getByRole('button', { name: `Close Ride #${coasterId}` }).click();
  await page.getByRole('button', { name: 'Close Rides and attractions' }).click();
  const invalidExit = page.getByRole('button', { name: /Exit unavailable at tile/ }).first();
  await expect(invalidExit).toBeVisible();
  const coasterExitReason = (await invalidExit.getAttribute('aria-label'))
    ?.split(': ')
    .slice(1)
    .join(': ');
  expect(coasterExitReason).toBeTruthy();
  await invalidExit.click();
  await expect(page.locator('.tool-status')).toHaveText(coasterExitReason!);
  const coasterExit = page.getByRole('button', { name: /Place exit at tile/ }).first();
  await expect(coasterExit).toBeVisible();
  await coasterExit.click();
  await toolbarAction(page, 'Rides');
  await coasterRow.click();
  await expect(coasterWindow.locator('.ride-checklist')).not.toContainText('No exit');
  await screenshot(page, testInfo, 'p0-4-looping-coaster-after-access');
  const coasterTitlebar = await coasterWindow.locator('.ui-titlebar').boundingBox();
  if (!coasterTitlebar) throw new Error('Coaster ride window is missing its title bar');
  await page.mouse.move(coasterTitlebar.x + 40, coasterTitlebar.y + 12);
  await page.mouse.down();
  await page.mouse.move(500, 52);
  await page.mouse.up();
  await toolbarAction(page, 'Game options');
  await page.getByRole('button', { name: 'Game speed 4×', exact: true }).click();
  await page.getByRole('button', { name: 'Close Options' }).click();
  await coasterWindow.locator('.ui-titlebar').click();
  const rideWindowBounds = await coasterWindow.boundingBox();
  if (!rideWindowBounds) throw new Error('Coaster ride window is missing');
  await page.mouse.move(
    rideWindowBounds.x + rideWindowBounds.width / 2,
    rideWindowBounds.y + rideWindowBounds.height / 2,
  );
  await page.mouse.wheel(0, 800);
  await coasterWindow.getByRole('button', { name: 'Test ride' }).click();
  await expect(coasterWindow.locator('.ride-checklist')).toBeEmpty({ timeout: 120_000 });
  await coasterWindow.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(coasterWindow.locator('.ride-status')).toHaveText('Open');
  await screenshot(page, testInfo, 'p0-4-looping-coaster-after-open');
});

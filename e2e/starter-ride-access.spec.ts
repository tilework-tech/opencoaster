import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { devices, expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

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
): Promise<void> {
  await centerMapOnTile(page, ...center, mobile);
  const bounds = await page.locator('#game').boundingBox();
  if (!bounds) throw new Error('Game viewport is missing');
  const clickTileX = x - 1;
  const dx = clickTileX - center[0];
  const dy = y - center[1];
  const screenX = bounds.width / 2 + (dx - dy) * 32;
  const screenY = bounds.height / 2 + (dx + dy) * 16 - 2 * 16;
  await page.mouse.click(bounds.x + screenX, bounds.y + screenY);
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

async function startStarterPark(page: Page, mobile: boolean): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Starter Park' })
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

async function playStarterRideAccess(
  page: Page,
  mobile: boolean,
  testInfo: TestInfo,
): Promise<void> {
  test.setTimeout(600_000);
  page.setDefaultTimeout(8_000);
  await startStarterPark(page, mobile);
  const mapCenter: readonly [number, number] = [28, 43];
  await screenshot(
    page,
    testInfo,
    mobile ? 'starter-ride-access-pixel-8-start' : 'starter-ride-access-desktop-start',
  );

  await toolbarAction(page, 'Footpaths', mobile);
  for (const [x, y] of [
    [26, 43],
    [27, 43],
    [28, 43],
    [28, 42],
    [28, 41],
    [28, 40],
  ])
    await mapTileClick(page, x, y, mapCenter, mobile);

  await toolbarAction(page, 'New ride', mobile);
  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  await page.locator('.ride-card[data-ride-type="1"]').click();
  await mapTileClick(page, 27, 42, mapCenter, mobile);
  await expect(page.locator('.tool-status')).toContainText('Place entrance');
  await expect(page.locator('.ride-placement-preview')).toBeVisible();
  await screenshot(
    page,
    testInfo,
    mobile ? 'starter-ride-access-pixel-8-entrance' : 'starter-ride-access-desktop-entrance',
  );

  await placeStationPart(page, 'Place exit', mobile, mapCenter, [27, 43]);
  await placeStationPart(page, 'Ride setup complete', mobile, mapCenter);
  await toolbarAction(page, 'Rides', mobile);
  const flatRide = page
    .locator('[data-panel="ride-list"] .list-row')
    .filter({ hasText: 'Merry-Go-Round' });
  await flatRide.click();
  const flatWindow = page.locator('[data-panel="ride-0"]');
  await expect(flatWindow.locator('.ride-status')).toHaveText('Closed');
  await flatWindow.getByRole('button', { name: 'Open' }).click();
  await expect(flatWindow.locator('.ride-status')).toHaveText('Open');

  await toolbarAction(page, 'New ride', mobile);
  await page.getByRole('tab', { name: 'Shops & Stalls' }).click();
  await page.getByRole('button', { name: /^Food Stall/ }).click();
  await mapTileClick(page, 25, 43, mapCenter, mobile);
  await expect(page.locator('.tool-status')).toContainText('Food Stall is open');
  await expect(page.locator('.ride-stall-front-preview')).toBeVisible();
  await toolbarAction(page, 'Rides', mobile);
  await page.getByRole('tab', { name: 'Shops and stalls', exact: true }).click();
  await page
    .locator('[data-panel="ride-list"] .list-row')
    .filter({ hasText: 'Food Stall' })
    .click();
  await expect(page.locator('[data-panel="ride-1"] .ride-status')).toHaveText('Open');
  await page.getByRole('button', { name: 'Close Ride #1' }).click();
  await page.getByRole('button', { name: 'Close Rides and attractions' }).click();

  await toolbarAction(page, 'New ride', mobile);
  await page.getByRole('tab', { name: 'Roller Coasters' }).click();
  await page.getByRole('button', { name: /^Steel Looping Coaster/ }).click();
  await mapTileClick(page, 28, 39, mapCenter, mobile);
  const construction = page.locator('[data-panel="construction"]');
  await expect(construction).toBeVisible();
  let trackPieces = 0;
  const placePiece = async (shape: string, slope: string, drive = 'Normal') => {
    if (['Station', 'Loop right'].includes(shape))
      await construction.getByLabel('Special elements').selectOption({ label: shape });
    else await construction.getByRole('button', { name: shape, exact: true }).click();
    await construction.getByRole('button', { name: slope, exact: true }).click();
    await construction.getByLabel('Drive').selectOption({ label: drive });
    await construction.getByRole('button', { name: 'Build piece' }).click();
    trackPieces++;
    await expect(page.locator('.coaster-info')).toContainText(`Track ${trackPieces} pieces`);
  };
  await placePiece('Station', 'Level');
  await construction.getByRole('button', { name: 'Straight', exact: true }).click();
  await construction.getByRole('button', { name: 'Up', exact: true }).click();
  await construction.getByLabel('Drive').selectOption({ label: 'Chain lift' });
  await construction.getByRole('button', { name: 'Build piece' }).click();
  await expect(construction.locator('.coaster-feedback')).toHaveText(
    'Track cannot be built over open water for this ride type.',
  );
  await expect(page.locator('.coaster-info')).toContainText('Track 1 pieces');
}

test('Starter Park explains when coaster track crosses open water (desktop)', async ({
  page,
}, testInfo) => {
  await playStarterRideAccess(page, false, testInfo);
});

test('Starter Park explains when coaster track crosses open water (Pixel 8)', async ({
  browser,
}, testInfo) => {
  const { defaultBrowserType: _browserType, ...options } = devices['Pixel 8'];
  void _browserType;
  const context = await browser.newContext({ ...options, serviceWorkers: 'allow' });
  const page = await context.newPage();
  await playStarterRideAccess(page, true, testInfo);
  await context.close();
});

test('starts entrance setup on the newly created ride when ride types repeat', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(8_000);
  await startStarterPark(page, false);
  const mapCenter: readonly [number, number] = [28, 43];
  await toolbarAction(page, 'Footpaths', false);
  for (const [x, y] of [
    [26, 43],
    [27, 43],
    [28, 43],
    [29, 43],
  ])
    await mapTileClick(page, x, y, mapCenter, false);

  await toolbarAction(page, 'New ride', false);
  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  await page.locator('.ride-card[data-ride-type="1"]').click();
  await mapTileClick(page, 27, 42, mapCenter, false);
  await placeStationPart(page, 'Place exit', false, mapCenter, [27, 43]);
  await placeStationPart(page, 'Ride setup complete', false, mapCenter);
  await page.getByRole('button', { name: 'Close Ride #0' }).click();

  await toolbarAction(page, 'New ride', false);
  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  await page.locator('.ride-card[data-ride-type="1"]').click();
  await mapTileClick(page, 29, 42, mapCenter, false);
  await expect(page.locator('.tool-status')).toContainText('Place entrance');

  await toolbarAction(page, 'Rides', false);
  await page
    .locator('[data-panel="ride-list"] .list-row')
    .filter({ hasText: 'Merry-Go-Round' })
    .last()
    .click();
  const duplicateWindow = page.locator('[data-panel="ride-1"]');
  await expect(duplicateWindow.locator('.ride-checklist')).toContainText('No entrance');
  await expect(duplicateWindow.locator('.ride-checklist')).toContainText('No exit');
  await expect(
    duplicateWindow.locator('.ride-checklist').getByRole('button', { name: 'Place entrance' }),
  ).toBeVisible();
  await expect(
    duplicateWindow.locator('.ride-checklist').getByRole('button', { name: 'Place exit' }),
  ).toBeVisible();
});

test('does not mark boarding tiles inside another ride as valid', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(8_000);
  await startStarterPark(page, false);
  const mapCenter: readonly [number, number] = [28, 43];
  await toolbarAction(page, 'Footpaths', false);
  for (const [x, y] of [
    [26, 43],
    [27, 43],
    [28, 43],
    [29, 43],
  ])
    await mapTileClick(page, x, y, mapCenter, false);

  await toolbarAction(page, 'New ride', false);
  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  await page.locator('.ride-card[data-ride-type="1"]').click();
  await mapTileClick(page, 27, 42, mapCenter, false);
  await placeStationPart(page, 'Place exit', false, mapCenter, [27, 43]);
  await placeStationPart(page, 'Ride setup complete', false, mapCenter, [26, 42]);
  await page.getByRole('button', { name: 'Close Ride #0' }).click();

  await toolbarAction(page, 'New ride', false);
  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  await page.locator('.ride-card[data-ride-type="1"]').click();
  await mapTileClick(page, 28, 42, mapCenter, false);
  await expect(page.locator('.tool-status')).toContainText('Place entrance');
  await expect(page.getByRole('button', { name: 'Place entrance at tile 27, 42' })).toHaveCount(0);
});

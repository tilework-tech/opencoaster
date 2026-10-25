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
  coasterName = 'Steel Looping Coaster',
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
  await page.getByRole('button', { name: new RegExp(`^${coasterName}`) }).click();
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
  await placePiece('Straight', 'Up', 'Chain lift');
  await placePiece('Straight', 'Up', 'Chain lift');
  await placePiece('Straight', 'Level', 'Chain lift');
  await placePiece('Right small', 'Level');
  await placePiece('Straight', 'Level');
  await placePiece('Right small', 'Level');
  await placePiece('Straight', 'Down');
  await placePiece('Straight', 'Down');
  await placePiece('Straight', 'Level');
  await placePiece('Straight', 'Level');
  await placePiece('Right small', 'Level');
  await placePiece('Straight', 'Level');
  await placePiece('Right small', 'Level');
  await expect(page.locator('.coaster-info')).toContainText('closed circuit');
  await expect(page.locator('.tool-status')).toContainText('Place entrance');
  await placeStationPart(page, 'Place exit', mobile, mapCenter, [28, 40]);
  await placeStationPart(page, 'Test ride', mobile, mapCenter, [28, 38]);
  await expect(page.locator('.tool-status')).toContainText('Test ride');
  await toolbarAction(page, 'Rides', mobile);
  await page.locator('[data-panel="ride-list"] .list-row').filter({ hasText: coasterName }).click();
  const coasterDetail = page.locator('[data-panel="ride-2"]');
  await expect(coasterDetail.locator('.ride-checklist')).toContainText('Untested');
  await expect(coasterDetail.locator('.ride-checklist')).not.toContainText(
    'Entrance not connected to a path',
  );
  await toolbarAction(page, 'Game options', mobile);
  await page.getByRole('button', { name: '4×' }).click();
  await page.getByRole('button', { name: 'Close Options' }).click();
  await coasterDetail.locator('.ui-titlebar').click();
  await coasterDetail.getByRole('button', { name: 'Test ride' }).click();
  await expect(coasterDetail.locator('.ride-checklist')).toBeEmpty({ timeout: 120_000 });
  await coasterDetail.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(coasterDetail.locator('.ride-status')).toHaveText('Open');
  await screenshot(
    page,
    testInfo,
    mobile ? 'starter-ride-access-pixel-8-open' : 'starter-ride-access-desktop-open',
  );

  const tickAtStart = Number((await page.locator('.hud').innerText()).match(/\btick (\d+)\b/)?.[1]);
  const served = coasterDetail
    .locator('.stat-row')
    .filter({ hasText: 'Guests served' })
    .locator('.stat-value')
    .first();
  await expect
    .poll(
      async () => {
        const hud = await page.locator('.hud').innerText();
        const tick = Number(hud.match(/\btick (\d+)\b/)?.[1]);
        if (tick > tickAtStart + 32_768)
          throw new Error('No guests rode within two in-game months');
        return Number((await served.textContent()) ?? 0);
      },
      { timeout: 120_000 },
    )
    .toBeGreaterThan(0);
  await coasterDetail.getByRole('button', { name: 'Locate' }).click();
  await page.getByRole('button', { name: 'Close Ride #2' }).click();
  await page.getByRole('button', { name: 'Close Rides and attractions' }).click();
  await page.getByRole('button', { name: 'Close Ride construction' }).click();
  await toolbarAction(page, 'Zoom in', mobile);
  await toolbarAction(page, 'Zoom in', mobile);
  await screenshot(
    page,
    testInfo,
    mobile
      ? 'starter-ride-access-pixel-8-guests-riding'
      : 'starter-ride-access-desktop-guests-riding',
  );
  for (let rotation = 1; rotation < 4; rotation++) {
    await toolbarAction(page, 'Rotate clockwise', mobile);
    await expect(page.locator('.hud')).toContainText(`rot ${rotation}`);
    await toolbarAction(page, 'Rides', mobile);
    await page
      .locator('[data-panel="ride-list"] .list-row')
      .filter({ hasText: coasterName })
      .click();
    const rideDetail = page.locator('[data-panel="ride-2"]');
    const titlebar = rideDetail.locator('.ui-titlebar');
    if (!mobile) {
      const titlebarBounds = await titlebar.boundingBox();
      if (!titlebarBounds) throw new Error('Ride details title bar is missing');
      await page.mouse.move(titlebarBounds.x + 24, titlebarBounds.y + 16);
      await page.mouse.down();
      await page.mouse.move(74, 66, { steps: 6 });
      await page.mouse.up();
    }
    await rideDetail.getByRole('button', { name: 'Locate' }).click({ force: mobile });
    await page.getByRole('button', { name: 'Close Ride #2' }).click();
    await page.getByRole('button', { name: 'Close Rides and attractions' }).click();
    await screenshot(
      page,
      testInfo,
      `${coasterName.toLowerCase().replaceAll(' ', '-')}-view-${rotation}`,
    );
  }
}

test('new Starter Park builds and opens rides and a stall before guests ride (desktop)', async ({
  page,
}, testInfo) => {
  await playStarterRideAccess(page, false, testInfo);
});

test('new Starter Park builds and opens rides and a stall before guests ride (Pixel 8)', async ({
  browser,
}, testInfo) => {
  const { defaultBrowserType: _browserType, ...options } = devices['Pixel 8'];
  void _browserType;
  const context = await browser.newContext({ ...options, serviceWorkers: 'allow' });
  const page = await context.newPage();
  await playStarterRideAccess(page, true, testInfo);
  await context.close();
});

for (const coasterName of ['Wooden Coaster', 'Junior Roller Coaster', 'Wild Mouse Coaster'])
  test(`Starter Park builds, tests and opens the ${coasterName} with guests riding in all four views`, async ({
    page,
  }, testInfo) => {
    await playStarterRideAccess(page, false, testInfo, coasterName);
  });

test('Starter Park builds and opens a Log Flume with guests riding its water track', async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(8_000);
  await startStarterPark(page, false);
  const mapCenter: readonly [number, number] = [28, 43];
  await toolbarAction(page, 'Footpaths', false);
  for (const [x, y] of [
    [26, 43],
    [27, 43],
    [28, 43],
    [28, 42],
    [28, 41],
  ])
    await mapTileClick(page, x, y, mapCenter, false);

  await toolbarAction(page, 'New ride', false);
  await page.getByRole('tab', { name: 'Water rides' }).click();
  await page.getByRole('button', { name: /^Log Flume/ }).click();
  await mapTileClick(page, 28, 39, mapCenter, false);
  const construction = page.locator('[data-panel="construction"]');
  await expect(construction).toBeVisible();
  let trackPieces = 0;
  const placePiece = async (shape: string, slope: string, drive = 'Normal') => {
    if (['Station', 'Water splash drop'].includes(shape))
      await construction.getByLabel('Special elements').selectOption({ label: shape });
    else await construction.getByRole('button', { name: shape, exact: true }).click();
    await construction.getByRole('button', { name: slope, exact: true }).click();
    await construction.getByLabel('Drive').selectOption({ label: drive });
    await construction.getByRole('button', { name: 'Build piece' }).click();
    trackPieces++;
    await expect(page.locator('.coaster-info')).toContainText(`Track ${trackPieces} pieces`);
  };
  await placePiece('Station', 'Level');
  await placePiece('Straight', 'Up', 'Powered climb');
  await placePiece('Straight', 'Up', 'Powered climb');
  await placePiece('Straight', 'Level');
  await placePiece('Right small', 'Level');
  await placePiece('Straight', 'Level');
  await placePiece('Right small', 'Level');
  await placePiece('Water splash drop', 'Down');
  await placePiece('Straight', 'Down');
  await placePiece('Straight', 'Level');
  await placePiece('Straight', 'Level');
  await placePiece('Right small', 'Level');
  await placePiece('Straight', 'Level');
  await placePiece('Right small', 'Level');
  await expect(page.locator('.coaster-info')).toContainText('closed circuit');
  await expect(page.locator('.tool-status')).toContainText('Place entrance');
  const header = construction.locator('.ui-titlebar');
  const headerBounds = await header.boundingBox();
  if (!headerBounds) throw new Error('Ride construction title bar is missing');
  await page.mouse.move(headerBounds.x + 24, headerBounds.y + 16);
  await page.mouse.down();
  await page.mouse.move(74, 66, { steps: 6 });
  await page.mouse.up();
  await placeStationPart(page, 'Place exit', false, mapCenter, [28, 40]);
  await placeStationPart(page, 'Test ride', false, mapCenter, [28, 38]);

  await toolbarAction(page, 'Rides', false);
  await page.locator('[data-panel="ride-list"] .list-row').filter({ hasText: 'Log Flume' }).click();
  const waterRide = page.locator('[data-panel="ride-0"]');
  await toolbarAction(page, 'Game options', false);
  await page.getByRole('button', { name: '4×' }).click();
  await page.getByRole('button', { name: 'Close Options' }).click();
  await waterRide.locator('.ui-titlebar').click();
  await waterRide.getByRole('button', { name: 'Test ride' }).click();
  await expect(waterRide.locator('.ride-checklist')).toBeEmpty({ timeout: 120_000 });
  await waterRide.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(waterRide.locator('.ride-status')).toHaveText('Open');

  const tickAtStart = Number((await page.locator('.hud').innerText()).match(/\btick (\d+)\b/)?.[1]);
  const served = waterRide
    .locator('.stat-row')
    .filter({ hasText: 'Guests served' })
    .locator('.stat-value')
    .first();
  await expect
    .poll(
      async () => {
        const hud = await page.locator('.hud').innerText();
        const tick = Number(hud.match(/\btick (\d+)\b/)?.[1]);
        if (tick > tickAtStart + 32_768)
          throw new Error('No guests rode within two in-game months');
        return Number((await served.textContent()) ?? 0);
      },
      { timeout: 120_000 },
    )
    .toBeGreaterThan(0);
  const rideWindow = await waterRide.boundingBox();
  if (!rideWindow) throw new Error('Log Flume detail window is missing');
  await page.mouse.move(rideWindow.x + 24, rideWindow.y + 16);
  await page.mouse.down();
  await page.mouse.move(74, 66, { steps: 6 });
  await page.mouse.up();
  await waterRide.getByRole('button', { name: 'Locate' }).click();
  await page.getByRole('button', { name: 'Close Ride #0' }).click();
  await page.getByRole('button', { name: 'Close Rides and attractions' }).click();
  await page.getByRole('button', { name: 'Close Ride construction' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await screenshot(page, testInfo, 'starter-log-flume-guests-riding');
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

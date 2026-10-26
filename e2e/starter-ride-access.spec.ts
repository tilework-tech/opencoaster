import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { devices, expect, test } from '@playwright/test';
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

async function contextClickAtTile(page: Page, x: number, y: number): Promise<void> {
  await centerMapOnTile(page, x, y, false);
  const bounds = await page.locator('#game').boundingBox();
  if (!bounds) throw new Error('Game viewport is missing');
  const screenX = bounds.width / 2 - 32;
  const screenY = bounds.height / 2 - 3 * 16;
  await page.mouse.click(bounds.x + screenX, bounds.y + screenY, { button: 'right' });
}

async function longPressAtTile(
  page: Page,
  x: number,
  y: number,
  center: readonly [number, number],
  mobile: boolean,
): Promise<void> {
  await centerMapOnTile(page, ...center, mobile);
  const bounds = await page.locator('#game').boundingBox();
  if (!bounds) throw new Error('Game viewport is missing');
  const dx = x - 1 - center[0];
  const dy = y - center[1];
  const touchPoint = {
    x: bounds.x + bounds.width / 2 + (dx - dy) * 32,
    y: bounds.y + bounds.height / 2 + (dx + dy) * 16 - 2 * 16,
    radiusX: 4,
    radiusY: 4,
    force: 1,
    id: 1,
  };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint] });
  await page.waitForTimeout(1_000);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
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

async function playStarterRideAccess(
  page: Page,
  mobile: boolean,
  testInfo: TestInfo,
): Promise<void> {
  test.setTimeout(600_000);
  page.setDefaultTimeout(8_000);
  await startStarterPark(page, mobile);
  await importUnlockedCoaster(page, testInfo, mobile);
  const mapCenter: readonly [number, number] = [28, 43];
  const flatSite: readonly [number, number] = [23, 43];
  const clickTile = (x: number, y: number) => mapTileClick(page, x, y, [x, y], mobile);
  await screenshot(
    page,
    testInfo,
    mobile ? 'starter-ride-access-pixel-8-start' : 'starter-ride-access-desktop-start',
  );

  await toolbarAction(page, 'Footpaths', mobile);
  for (const [x, y] of [
    [21, 44],
    [22, 44],
    [23, 44],
    [24, 44],
    [25, 44],
    [21, 43],
    [25, 43],
    [26, 43],
    [27, 43],
    [28, 43],
  ] as const)
    await clickTile(x, y);

  await toolbarAction(page, 'New ride', mobile);
  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  await page.locator('.ride-card[data-ride-type="1"]').click();
  await clickTile(23, 42);
  await expect(page.locator('.tool-status')).toContainText('Place entrance');
  await expect(page.locator('.ride-placement-preview')).toBeVisible();
  await screenshot(
    page,
    testInfo,
    mobile ? 'starter-ride-access-pixel-8-entrance' : 'starter-ride-access-desktop-entrance',
  );

  await placeStationPart(page, 'Place exit', mobile, flatSite, [21, 43]);
  await placeStationPart(page, 'Ride setup complete', mobile, flatSite, [25, 43]);
  await toolbarAction(page, 'Rides', mobile);
  const flatRide = page
    .locator('[data-panel="ride-list"] .list-row')
    .filter({ hasText: 'Merry-Go-Round' });
  await flatRide.click();
  const flatWindow = page.locator('[data-panel="ride-0"]');
  await expect(flatWindow.locator('.ui-titlebar')).toContainText('Merry-Go-Round 1');
  await expect
    .poll(() =>
      flatWindow.locator('.ride-preview').evaluate((canvas) => {
        const preview = canvas as HTMLCanvasElement;
        const context = preview.getContext('2d');
        if (!context) return 0;
        const { data } = context.getImageData(0, 0, preview.width, preview.height);
        let opaquePixels = 0;
        for (let alpha = 3; alpha < data.length; alpha += 4)
          if (data[alpha] !== 0) opaquePixels++;
        return opaquePixels;
      }),
    )
    .toBeGreaterThan(0);
  await expect(flatWindow.locator('.ride-status')).toHaveText('Closed');
  await flatWindow.getByRole('button', { name: 'Open' }).click();
  await expect(flatWindow.locator('.ride-status')).toHaveText('Open');

  await toolbarAction(page, 'New ride', mobile);
  await page.getByRole('tab', { name: 'Shops & Stalls' }).click();
  await page.getByRole('button', { name: /^Food Stall/ }).click();
  await clickTile(20, 44);
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
  if (mobile) {
    await toolbarAction(page, 'Rides', true);
    await page.getByRole('tab', { name: 'Shops and stalls', exact: true }).click();
    await page
      .locator('[data-panel="ride-list"] .list-row')
      .filter({ hasText: 'Food Stall' })
      .click();
    await page.locator('[data-panel="ride-1"]').getByRole('button', { name: 'Locate' }).click({
      force: true,
    });
    await page.getByRole('button', { name: 'Close Ride #1' }).click();
    await page.getByRole('button', { name: 'Close Rides and attractions' }).click();
    await longPressAtTile(page, 20, 44, [20, 44], true);
    await expect(page.locator('[data-panel="ride-1"]')).toBeVisible();
    await page.getByRole('button', { name: 'Close Ride #1' }).click();
  }

  await toolbarAction(page, 'New ride', mobile);
  await page.getByRole('tab', { name: 'Roller Coasters' }).click();

  await page.getByRole('button', { name: new RegExp(`^${coasterName}`) }).click();
  await clickTile(28, 42);
  const construction = page.locator('[data-panel="construction"]');
  await expect(construction).toBeVisible();
  let trackPieces = 0;
  const placePiece = async (shape: string, slope: string, drive = 'Normal') => {
    if (['Station', 'Loop right'].includes(shape))
      await construction.getByLabel('Special elements').selectOption({ label: shape });
    else await construction.getByRole('button', { name: shape, exact: true }).click();
    await construction.getByRole('button', { name: slope, exact: true }).click();
    await construction.getByLabel('Drive').selectOption({ label: drive });
    const tickBefore = Number(
      (await page.locator('.hud').innerText()).match(/\btick (\d+)\b/)?.[1],
    );
    await construction.getByRole('button', { name: 'Build piece' }).click();
    trackPieces++;
    await expect
      .poll(async () => {
        const hud = await page.locator('.hud').innerText();
        return Number(hud.match(/\btick (\d+)\b/)?.[1]);
      })
      .toBeGreaterThan(tickBefore);
    await expect(
      page.locator('.coaster-info'),
      `Track feedback: ${await page.locator('.coaster-feedback').innerText()}`,
    ).toContainText(`Track ${trackPieces} pieces`);
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
  await placeStationPart(page, 'Place exit', mobile, mapCenter, [28, 43]);
  await placeStationPart(page, 'Test ride', mobile, mapCenter, [29, 43]);
  await expect(page.locator('.tool-status')).toContainText('Test ride');

  await toolbarAction(page, 'Rides', mobile);
  await page
    .locator('[data-panel="ride-list"] .list-row')
    .filter({ hasText: 'Merry-Go-Round' })
    .click();
  const rideDetail = page.locator('[data-panel="ride-0"]');
  await toolbarAction(page, 'Game options', mobile);
  await page.getByRole('button', { name: /4×/ }).first().click();
  await page.getByRole('button', { name: 'Close Options' }).click();
  await rideDetail.locator('.ui-titlebar').click();
  await rideDetail.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(rideDetail.locator('.ride-status')).toHaveText('Open');
  await screenshot(
    page,
    testInfo,
    mobile ? 'starter-ride-access-pixel-8-open' : 'starter-ride-access-desktop-open',
  );

  const tickAtStart = Number((await page.locator('.hud').innerText()).match(/\btick (\d+)\b/)?.[1]);
  const served = rideDetail
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
  await rideDetail.getByRole('button', { name: 'Locate' }).click();
  await page.getByRole('button', { name: 'Close Ride #0' }).click();
  await page.getByRole('button', { name: 'Close Rides and attractions' }).click();
  await toolbarAction(page, 'Zoom in', mobile);
  await toolbarAction(page, 'Zoom in', mobile);
  await screenshot(
    page,
    testInfo,
    mobile
      ? 'starter-ride-access-pixel-8-guests-riding'
      : 'starter-ride-access-desktop-guests-riding',
  );
}

async function playStarterCoasterOverWater(
  page: Page,
  mobile: boolean,
  testInfo: TestInfo,
): Promise<void> {
  page.setDefaultTimeout(8_000);
  await startStarterPark(page, mobile);
  await importUnlockedCoaster(page, testInfo, mobile);
  await toolbarAction(page, 'New ride', mobile);
  await page.getByRole('tab', { name: 'Roller Coasters' }).click();
  await page.getByRole('button', { name: /^Steel Looping Coaster/ }).click();
  await mapTileClick(page, 28, 39, [28, 43], mobile);
  const construction = page.locator('[data-panel="construction"]');
  await expect(construction).toBeVisible();

  await construction.getByLabel('Special elements').selectOption({ label: 'Station' });
  await construction.getByRole('button', { name: 'Level', exact: true }).click();
  await construction.getByRole('button', { name: 'Build piece' }).click();
  await expect(page.locator('.coaster-info')).toContainText('Track 1 pieces');

  await construction.getByRole('button', { name: 'Straight', exact: true }).click();
  await construction.getByRole('button', { name: 'Up', exact: true }).click();
  await construction.getByLabel('Drive').selectOption({ label: 'Chain lift' });
  await construction.getByRole('button', { name: 'Build piece' }).click();
  await expect(construction.locator('.coaster-feedback')).toHaveText(
    'Track cannot be built over open water for this ride type.',
  );
  await expect(page.locator('.coaster-info')).toContainText('Track 1 pieces');
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

test('new Starter Park keeps water rides locked until researched', async ({ page }) => {
  await startStarterPark(page, false);
  await toolbarAction(page, 'New ride', false);
  await page.getByRole('tab', { name: 'Water rides' }).click();

  await expect(
    page.getByRole('group', { name: 'New attraction' }).locator('.ui-pane.active'),
  ).toContainText('Nothing in this group is unlocked yet.');
});

test('Starter Park explains when coaster track crosses open water (desktop)', async ({
  page,
}, testInfo) => {
  await playStarterCoasterOverWater(page, false, testInfo);
});

test('Starter Park explains when coaster track crosses open water (Pixel 8)', async ({
  browser,
}, testInfo) => {
  const { defaultBrowserType: _browserType, ...options } = devices['Pixel 8'];
  void _browserType;
  const context = await browser.newContext({ ...options, serviceWorkers: 'allow' });
  const page = await context.newPage();
  await playStarterCoasterOverWater(page, true, testInfo);
  await context.close();
});

test('opens and demolishes a flat ride, stall, and coaster with the displayed refund', async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  await playStarterRideAccess(page, false, testInfo);

  const demolishAt = async (rideId: number, name: string) => {
    const rideList = page.locator('[data-panel="ride-list"]');
    if ((await rideList.count()) === 0) await toolbarAction(page, 'Rides', false);
    await page
      .getByRole('tab', { name: rideId === 1 ? 'Shops and stalls' : 'Rides', exact: true })
      .click();
    await page.locator('[data-panel="ride-list"] .list-row').filter({ hasText: name }).click();
    const rideWindow = page.locator(`[data-panel="ride-${rideId}"]`);
    await expect(rideWindow).toBeVisible();
    if (rideId === 0) {
      await page
        .getByRole('button', { name: `Close Ride #${rideId}` })
        .evaluate((button) => button.click());
      await page.getByRole('button', { name: 'Close Rides and attractions' }).click();
      await toolbarAction(page, 'Zoom out', false);
      await toolbarAction(page, 'Zoom out', false);
      const rotation = Number((await page.locator('.hud').innerText()).match(/\brot (\d+)\b/)?.[1]);
      for (let turn = 1; turn <= (4 - rotation) % 4; turn++) {
        await toolbarAction(page, 'Rotate view', false);
        await expect(page.locator('.hud')).toContainText(`rot ${(rotation + turn) % 4}`);
      }
      await contextClickAtTile(page, 23, 42);
      await expect(page.locator('.tool-status')).toContainText(
        `${name} ${rideId + 1} information opened`,
      );
    }
    await expect(rideWindow).toBeVisible();
    await expect(rideWindow.getByRole('tab', { name: 'View' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const demolish = rideWindow.getByRole('button', { name: 'Demolish ride' });
    await expect(demolish).toHaveAttribute('title', /Demolish/);
    await expect(demolish.locator('svg, img')).toBeVisible();
    await expect(demolish).toContainText('Demolish');
    const dialogPromise = page.waitForEvent('dialog');
    const clickPromise = demolish.click();
    const dialog = await dialogPromise;
    expect(dialog.message()).toContain(`Demolish ${name} #${rideId}?`);
    expect(dialog.message()).toMatch(/refund: \$(?!0\.00)[\d,]+\.\d{2}/i);
    await dialog.accept();
    await clickPromise;
    await expect(rideWindow).toHaveCount(0);
  };

  await demolishAt(0, 'Merry-Go-Round');
  await demolishAt(1, 'Food Stall');
  await demolishAt(2, 'Steel Looping Coaster');
});

test('starts entrance setup on the newly created ride when ride types repeat', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(8_000);
  await startStarterPark(page, false);
  const mapCenter: readonly [number, number] = [28, 43];
  await toolbarAction(page, 'Footpaths', false);
  for (const [x, y] of [
    [21, 44],
    [22, 44],
    [23, 44],
    [24, 44],
    [25, 44],
    [21, 43],
    [25, 43],
  ] as const)
    await mapTileClick(page, x, y, mapCenter, false);

  await toolbarAction(page, 'New ride', false);
  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  await page.locator('.ride-card[data-ride-type="1"]').click();
  await mapTileClick(page, 23, 42, mapCenter, false);
  await placeStationPart(page, 'Place exit', false, mapCenter, [21, 43]);
  await placeStationPart(page, 'Ride setup complete', false, mapCenter, [25, 43]);
  await page.getByRole('button', { name: 'Close Ride #0' }).click();

  await toolbarAction(page, 'New ride', false);
  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  await page.locator('.ride-card[data-ride-type="1"]').click();
  await mapTileClick(page, 26, 38, mapCenter, false, 2, false);
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
    [21, 44],
    [22, 44],
    [23, 44],
    [24, 44],
    [25, 44],
    [21, 43],
    [25, 43],
  ] as const)
    await mapTileClick(page, x, y, mapCenter, false);

  await toolbarAction(page, 'New ride', false);
  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  await page.locator('.ride-card[data-ride-type="1"]').click();
  await mapTileClick(page, 23, 42, mapCenter, false);
  await placeStationPart(page, 'Place exit', false, mapCenter, [21, 43]);
  await placeStationPart(page, 'Ride setup complete', false, mapCenter, [25, 43]);
  await page.getByRole('button', { name: 'Close Ride #0' }).click();

  await toolbarAction(page, 'New ride', false);
  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  await page.locator('.ride-card[data-ride-type="1"]').click();
  await mapTileClick(page, 26, 41, mapCenter, false);
  await expect(page.locator('.tool-status')).toContainText('Place entrance');
  await expect(page.getByRole('button', { name: 'Place entrance at tile 24, 42' })).toHaveCount(0);
});

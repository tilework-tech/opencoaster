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

async function mapClick(page: Page, x: number, y: number, offsetX = 0, offsetY = 0): Promise<void> {
  const bounds = await page.locator('#game').boundingBox();
  if (!bounds) throw new Error('Game viewport is missing');
  await page.locator('#game').click({
    position: {
      x: bounds.width * x + offsetX,
      y: bounds.height * y + offsetY,
    },
  });
}

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
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
  test.setTimeout(1_200_000);
  page.setDefaultTimeout(8_000);
  await startStarterPark(page, mobile);
  await screenshot(
    page,
    testInfo,
    mobile ? 'starter-ride-access-pixel-8-start' : 'starter-ride-access-desktop-start',
  );

  const rideX = mobile ? 0.55 : 0.625;
  await toolbarAction(page, 'Footpaths', mobile);
  await mapClick(page, rideX, 0.25, 64, 32);
  await mapClick(page, rideX, 0.25, 160, 80);

  await toolbarAction(page, 'New ride', mobile);
  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  await page.getByRole('button', { name: /^Merry-Go-Round/ }).click();
  await mapClick(page, rideX, 0.25);
  await expect(page.locator('.tool-status')).toContainText('Place entrance');
  await expect(page.locator('.ride-placement-preview')).toBeVisible();
  await screenshot(
    page,
    testInfo,
    mobile ? 'starter-ride-access-pixel-8-entrance' : 'starter-ride-access-desktop-entrance',
  );

  await mapClick(page, rideX, 0.25, 32, 16);
  await expect(page.locator('.tool-status')).toContainText('Place exit');
  await mapClick(page, rideX, 0.25, -32, 16);
  await expect(page.locator('.tool-status')).toContainText('Ride setup complete');
  await toolbarAction(page, 'Rides', mobile);
  const flatRide = page
    .locator('[data-panel="ride-list"] .list-row')
    .filter({ hasText: 'Merry-Go-Round' });
  await flatRide.click();
  const flatWindow = page.locator('[data-panel^="ride-"]');
  await expect(flatWindow.locator('.ride-status')).toHaveText('Closed');
  await flatWindow.getByRole('button', { name: 'Open' }).click();
  await expect(flatWindow.locator('.ride-status')).toHaveText('Open');

  await toolbarAction(page, 'New ride', mobile);
  await page.getByRole('tab', { name: 'Shops & Stalls' }).click();
  await page.getByRole('button', { name: /^Food Stall/ }).click();
  await mapClick(page, rideX, 0.25, 128, 64);
  await expect(page.locator('.tool-status')).toContainText('Food Stall is open');
  await expect(page.locator('.ride-stall-front-preview')).toBeVisible();

  await toolbarAction(page, 'Footpaths', mobile);
  await mapClick(page, 0.47, 0.25, 64, 32);
  await toolbarAction(page, 'New ride', mobile);
  await page.getByRole('tab', { name: 'Roller Coasters' }).click();
  await page.getByRole('button', { name: /^Steel Looping Coaster/ }).click();
  await mapClick(page, 0.47, 0.25);
  const construction = page.locator('[data-panel="construction"]');
  await expect(construction).toBeVisible();
  const placePiece = async (shape: string, slope: string, drive = 'Normal') => {
    if (['Station', 'Loop right'].includes(shape))
      await construction.getByLabel('Special elements').selectOption({ label: shape });
    else await construction.getByRole('button', { name: shape, exact: true }).click();
    await construction.getByRole('button', { name: slope, exact: true }).click();
    await construction.getByLabel('Drive').selectOption({ label: drive });
    await construction.getByRole('button', { name: 'Build piece' }).click();
  };
  await placePiece('Station', 'Level');
  await placePiece('Straight', 'Up', 'Chain lift');
  await placePiece('Straight', 'Level', 'Chain lift');
  await placePiece('Loop right', 'Level');
  await placePiece('Straight', 'Level');
  await placePiece('Right small', 'Level');
  await placePiece('Right medium', 'Level');
  await placePiece('Straight', 'Down');
  await placePiece('Straight', 'Down');
  await placePiece('Straight', 'Level');
  await placePiece('Right large', 'Level');
  await placePiece('Right small', 'Level');
  await expect(page.locator('.coaster-info')).toContainText('closed circuit');
  await expect(page.locator('.tool-status')).toContainText('Place entrance');
  await mapClick(page, 0.47, 0.25, 32, 16);
  await expect(page.locator('.tool-status')).toContainText('Place exit');
  await mapClick(page, 0.47, 0.25, -32, 16);
  await expect(page.locator('.tool-status')).toContainText('Test ride');
  await construction.getByRole('button', { name: 'Test' }).click();
  await expect(page.locator('.tool-status')).toContainText('Ride setup complete');
  await construction.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.coaster-info')).toContainText('Open');

  const rides = page.locator('[data-panel="ride-list"]');
  await toolbarAction(page, 'Rides', mobile);
  for (const name of ['Merry-Go-Round', 'Food Stall', 'Steel Looping Coaster']) {
    const row = rides.locator('.list-row').filter({ hasText: name });
    await expect(row).toBeVisible();
    await row.click();
    const detail = page.locator('[data-panel^="ride-"]');
    await expect(detail).toBeVisible();
    await expect(detail.locator('.ride-status')).toHaveText('Open');
  }
  await screenshot(
    page,
    testInfo,
    mobile ? 'starter-ride-access-pixel-8-open' : 'starter-ride-access-desktop-open',
  );

  const tickAtStart = Number((await page.locator('.hud').innerText()).match(/\btick (\d+)\b/)?.[1]);
  await toolbarAction(page, 'Game options', mobile);
  await page.getByRole('button', { name: '4×' }).click();
  const coasterDetail = page
    .locator('[data-panel^="ride-"]')
    .filter({ hasText: 'Steel Looping Coaster' });
  const served = coasterDetail
    .locator('.stat-row')
    .filter({ hasText: 'Guests served' })
    .locator('.stat-value');
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
  await screenshot(
    page,
    testInfo,
    mobile
      ? 'starter-ride-access-pixel-8-guests-riding'
      : 'starter-ride-access-desktop-guests-riding',
  );
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

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function centerMapOnTile(page: Page, x: number, y: number): Promise<void> {
  const toolbar = page.locator('.game-toolbar');
  await toolbar.getByRole('button', { name: 'Map', exact: true }).click();
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

async function mapTileClick(page: Page, x: number, y: number): Promise<void> {
  await centerMapOnTile(page, 28, 43);
  const bounds = await page.locator('#game').boundingBox();
  if (!bounds) throw new Error('Game viewport is missing');
  const clickTileX = x - 1;
  const dx = clickTileX - 28;
  const dy = y - 43;
  const screenX = bounds.width / 2 + (dx - dy) * 32;
  const screenY = bounds.height / 2 + (dx + dy) * 16 - 2 * 16;
  await page.mouse.click(bounds.x + screenX, bounds.y + screenY);
}

async function bringFinanceIntoView(page: Page): Promise<void> {
  const titlebar = page.locator('[data-panel="finance"] .ui-titlebar');
  const bounds = await titlebar.boundingBox();
  if (!bounds) throw new Error('Finance window is missing');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(24, 48, { steps: 8 });
  await page.mouse.up();
}

test('launches targeted campaigns only once a ride or stall exists to promote', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`);
    await mkdir(dirname(path), { recursive: true });
    await page.screenshot({ path, fullPage: true, timeout: 60_000 });
    await testInfo.attach(name, { path, contentType: 'image/png' });
  };

  await page.goto('/');
  page.setDefaultTimeout(15_000);
  await page.getByRole('button', { name: 'New game' }).click();
  const starterCard = page.locator('.scenario-card').filter({ hasText: 'Starter Park' });
  await starterCard.getByRole('button', { name: 'Start', exact: true }).click();
  const toolbar = page.locator('.game-toolbar');
  await expect(toolbar.getByRole('button', { name: 'Finances', exact: true })).toBeVisible();

  await toolbar.getByRole('button', { name: 'Finances', exact: true }).click();
  await page.getByRole('tab', { name: 'Marketing' }).click();
  const freeRides = page.locator('[data-campaign="2"]');
  const foodOffer = page.locator('[data-campaign="4"]');
  const parkAdvertising = page.locator('[data-campaign="1"]');
  await expect(freeRides).toBeDisabled();
  await expect(foodOffer).toBeDisabled();
  await expect(parkAdvertising).toBeEnabled();
  await screenshot('marketing-no-targets');

  await toolbar.getByRole('button', { name: 'Footpaths', exact: true }).click();
  for (const [x, y] of [
    [26, 43],
    [27, 43],
    [28, 43],
    [28, 42],
    [28, 41],
    [28, 40],
  ])
    await mapTileClick(page, x, y);

  await toolbar.getByRole('button', { name: 'New ride', exact: true }).click();
  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  await page.getByRole('button', { name: /^Merry-Go-Round/ }).click();
  await mapTileClick(page, 27, 42);
  await expect(page.locator('.tool-status')).toContainText('Place entrance');
  await page
    .getByRole('button', { name: /Place entrance at tile/ })
    .first()
    .click();
  await expect(page.locator('.tool-status')).toContainText('Place exit');
  await page
    .getByRole('button', { name: /Place exit at tile/ })
    .first()
    .click();
  await expect(page.locator('.tool-status')).toContainText('Ride setup complete');
  await page.keyboard.press('Shift+Backspace');
  await toolbar.getByRole('button', { name: 'Finances', exact: true }).click();
  await page.getByRole('tab', { name: 'Marketing' }).click();
  await bringFinanceIntoView(page);
  await expect(freeRides).toBeEnabled();
  await expect(foodOffer).toBeDisabled();

  await page.getByLabel('Length').selectOption('6');
  await expect(freeRides).toContainText('for 6 weeks');
  await freeRides.click();
  await expect(page.getByText(/^Running: free ride vouchers/)).toBeVisible();
  await screenshot('marketing-free-ride-vouchers-running');

  await toolbar.getByRole('button', { name: 'New ride', exact: true }).click();
  await page.getByRole('tab', { name: 'Shops & Stalls' }).click();
  await page.getByRole('button', { name: /^Food Stall/ }).click();
  await mapTileClick(page, 25, 43);
  await expect(page.locator('.tool-status')).toContainText('Food Stall is open');
  await page.keyboard.press('Shift+Backspace');
  await toolbar.getByRole('button', { name: 'Finances', exact: true }).click();
  await page.getByRole('tab', { name: 'Marketing' }).click();
  await bringFinanceIntoView(page);
  await expect(foodOffer).toBeEnabled();
  await foodOffer.click();
  await expect(page.getByText(/^Running: free food or drink vouchers/)).toBeVisible();
  await screenshot('marketing-food-offer-running');
});

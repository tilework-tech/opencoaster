import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  FLAT_RIDE_ANCHOR,
  STALL_TILE,
  STARTER_PATH_TILES,
  clickTile,
  paintPaths,
  screenshot,
  startStarterPark,
} from './support/park';

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
  page.setDefaultTimeout(15_000);
  await startStarterPark(page);
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
  await screenshot(page, testInfo, 'marketing-no-targets');

  await paintPaths(page, STARTER_PATH_TILES);

  await toolbar.getByRole('button', { name: 'New ride', exact: true }).click();
  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  await page.getByRole('button', { name: /^Merry-Go-Round/ }).click();
  await clickTile(page, FLAT_RIDE_ANCHOR);
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
  await screenshot(page, testInfo, 'marketing-free-ride-vouchers-running');

  await toolbar.getByRole('button', { name: 'New ride', exact: true }).click();
  await page.getByRole('tab', { name: 'Shops & Stalls' }).click();
  await page.getByRole('button', { name: /^Food Stall/ }).click();
  await clickTile(page, STALL_TILE);
  await expect(page.locator('.tool-status')).toContainText('Food Stall is open');
  await page.keyboard.press('Shift+Backspace');
  await toolbar.getByRole('button', { name: 'Finances', exact: true }).click();
  await page.getByRole('tab', { name: 'Marketing' }).click();
  await bringFinanceIntoView(page);
  await expect(foodOffer).toBeEnabled();
  await foodOffer.click();
  await expect(page.getByText(/^Running: free food or drink vouchers/)).toBeVisible();
  await screenshot(page, testInfo, 'marketing-food-offer-running');
});

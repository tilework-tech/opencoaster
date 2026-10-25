import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';

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

  await toolbar.getByRole('button', { name: 'New ride', exact: true }).click();
  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  await page.getByRole('button', { name: /^Merry-Go-Round/ }).click();
  await page.locator('#game').click({ position: { x: 800, y: 200 } });
  await expect(page.locator('.tool-status')).toContainText('Done.');
  await page.keyboard.press('Shift+Backspace');
  await toolbar.getByRole('button', { name: 'Finances', exact: true }).click();
  await page.getByRole('tab', { name: 'Marketing' }).click();
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
  await page.locator('#game').click({ position: { x: 760, y: 260 } });
  await expect(page.locator('.tool-status')).toContainText('Done.');
  await page.keyboard.press('Shift+Backspace');
  await toolbar.getByRole('button', { name: 'Finances', exact: true }).click();
  await page.getByRole('tab', { name: 'Marketing' }).click();
  await expect(foodOffer).toBeEnabled();
  await foodOffer.click();
  await expect(page.getByText(/^Running: free food or drink vouchers/)).toBeVisible();
  await screenshot('marketing-food-offer-running');
});

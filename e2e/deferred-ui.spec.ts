import { expect, test } from './support/test';
import { mkdir } from 'node:fs/promises';

test('management windows, desktop resizing, options and screenshot shortcut', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await expect(page.getByRole('tab', { name: 'Beginner Parks' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Challenging Parks' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Starter Park scenario preview' })).toBeVisible();
  await expect(page.locator('.scenario-objective')).toContainText('100 guests');
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Starter Park' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/deferred-ui-before.png' });

  const toolbar = page.locator('.game-toolbar');
  await toolbar.getByRole('button', { name: 'Staff', exact: true }).click();
  const staff = page.locator('[data-panel="staff"]');
  await staff.getByRole('button', { name: 'Hire Handyman' }).click();
  const mechanicsTab = staff.getByRole('tab', { name: 'Mechanics' });
  await mechanicsTab.click();
  await expect(mechanicsTab).toHaveAttribute('aria-selected', 'true');
  await expect(staff.getByRole('button', { name: 'Hire Mechanic' })).toBeVisible();
  await staff.getByRole('tab', { name: 'Handymen' }).click();
  const openWorker = staff.getByRole('button', { name: /Open Handyman .* details/ });
  await expect(openWorker).toBeVisible();
  await openWorker.click();
  const worker = page.locator('[data-panel^="worker-"]');
  await expect(worker.getByRole('tab', { name: 'Orders' })).toBeVisible();
  await expect(worker.getByRole('tab', { name: 'Statistics' })).toBeVisible();
  await worker.getByRole('tab', { name: 'Orders' }).click();
  await expect(worker.getByRole('checkbox').first()).toBeVisible();
  await worker.getByRole('button', { name: /Edit.*patrol area/ }).click();
  await expect(page.locator('.tool-status')).toContainText(/Patrol tool selected for worker \d+/);
  await page.locator('#game').click({ position: { x: 650, y: 300 } });
  await expect(page.locator('.tool-status')).toContainText('Patrol tile added');

  await toolbar.getByRole('button', { name: 'Game options', exact: true }).click();
  const options = page.locator('[data-panel="options"]');
  await expect(options.getByRole('tab', { name: 'Sound' })).toBeVisible();
  await expect(options.getByRole('tab', { name: 'Display' })).toBeVisible();
  await expect(options.getByRole('tab', { name: 'Controls' })).toBeVisible();

  const guests = toolbar.getByRole('button', { name: 'Guests', exact: true });
  await guests.click();
  const guestWindow = page.locator('[data-panel="guests"]');
  const guestBounds = await guestWindow.boundingBox();
  expect(guestBounds).not.toBeNull();
  expect(guestBounds!.y + guestBounds!.height).toBeLessThanOrEqual(732);
  const beforeWidth = await guestWindow.evaluate((el) => el.getBoundingClientRect().width);
  const resize = guestWindow.getByRole('button', { name: 'Resize Guests window' });
  const resizeBox = await resize.boundingBox();
  if (!resizeBox) throw new Error('Resize handle has no layout box');
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + 120, resizeBox.y + 90);
  await page.mouse.up();
  const afterWidth = await guestWindow.evaluate((el) => el.getBoundingClientRect().width);
  expect(afterWidth).toBeGreaterThan(beforeWidth);

  await page.screenshot({ path: 'docs/screenshots/deferred-ui-after.png' });
  const screenshot = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const download = await screenshot;
  expect(download.suggestedFilename()).toMatch(/opencoaster.*\.png/i);
});

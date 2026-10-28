import { expect, test } from './support/test';

test('new ride menu offers only the starting rides and filters them by tab', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Starter Park' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();

  await page
    .locator('.game-toolbar')
    .getByRole('button', { name: 'New ride', exact: true })
    .click();
  const attractions = page.getByRole('group', { name: 'New attraction' });

  await page.getByRole('tab', { name: 'Gentle rides' }).click();
  const gentleRides = attractions.locator('.ui-pane.active .ride-card:visible');
  await expect(gentleRides).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^Merry-Go-Round/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Ferris Wheel/ })).toBeVisible();

  await page.getByRole('tab', { name: 'Roller Coasters' }).click();
  await expect(page.getByRole('button', { name: /^Steel Looping Coaster/ })).toBeHidden();
  await expect(attractions.locator('.ui-pane.active')).toContainText(
    'Nothing in this group is unlocked yet.',
  );

  await page.getByRole('tab', { name: 'Shops & Stalls' }).click();
  await expect(page.getByRole('button', { name: /^Food Stall/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Merry-Go-Round/ })).toBeHidden();
});

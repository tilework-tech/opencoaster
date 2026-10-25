import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

test('mobile actions menu exposes labeled controls with 44px touch targets', async ({ page }) => {
  page.setDefaultTimeout(5_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).tap();

  const toolbar = page.locator('.game-toolbar');
  const menu = toolbar.getByRole('button', { name: 'Actions', exact: true });
  await menu.tap();
  const actions = [
    'Pause',
    'Footpaths',
    'New ride',
    'Rides',
    'Finances',
    'Staff',
    'Park',
    'Save / Load',
  ];
  for (const label of ['Actions', ...actions]) {
    const button = toolbar.getByRole('button', { name: label, exact: true });
    await expect(button).toBeVisible();
    const size = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(size.width, `${label} width`).toBeGreaterThanOrEqual(44);
    expect(size.height, `${label} height`).toBeGreaterThanOrEqual(44);
  }
  await toolbar.getByRole('button', { name: 'Rides', exact: true }).tap();
  await expect(page.locator('[data-panel="ride-list"]')).toBeVisible();
});

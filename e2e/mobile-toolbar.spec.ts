import { expect, test } from '@playwright/test';

test('mobile toolbar keeps far-end actions reachable by scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();

  const toolbar = page.locator('.game-toolbar');
  const bounds = await toolbar.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(bounds.clientWidth).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.scrollWidth).toBeGreaterThan(bounds.clientWidth);

  await toolbar.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
  const rides = toolbar.getByRole('button', { name: 'Rides' });
  await expect(rides).toBeInViewport();
  await rides.click();
  await expect(page.locator('[data-panel="rides"]')).toBeVisible();
});

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });

/** Interactive controls on screen that are smaller than the 44px touch minimum. */
async function undersizedTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const small: string[] = [];
    for (const node of document.querySelectorAll<HTMLElement>(
      '.game-toolbar button, .status-bar button, .ui-window button, .ui-window select, .ui-window input, .ui-window .check-row',
    )) {
      if (node.closest('.collapsed') || node.closest('[hidden]')) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const parent = node.closest('.ui-pane');
      if (parent && !parent.classList.contains('active')) continue;
      if (node instanceof HTMLInputElement && node.type === 'checkbox') continue;
      if (rect.width < 44 || rect.height < 44)
        small.push(
          `${node.tagName} ${node.getAttribute('aria-label') ?? node.textContent} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        );
    }
    return small;
  });
}

test('is playable on a phone: scrolling toolbar, bottom sheets, 44px targets, tap to build', async ({
  page,
}, testInfo) => {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`);
    await mkdir(dirname(path), { recursive: true });
    await testInfo.attach(name, {
      path: (await page.screenshot({ path })) && path,
      contentType: 'image/png',
    });
  };
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Starter Park' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  const toolbar = page.locator('.game-toolbar');
  await expect(page.locator('[data-panel="park"]')).toBeVisible();
  await screenshot('m1-park-sheet');
  expect(await undersizedTargets(page)).toEqual([]);

  const scrollable = await toolbar.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(scrollable).toBe(true);

  await toolbar.getByRole('button', { name: 'Finances', exact: true }).scrollIntoViewIfNeeded();
  await toolbar.getByRole('button', { name: 'Finances', exact: true }).tap();
  await expect(page.locator('[data-panel="finance"]')).toBeVisible();
  await expect(page.locator('[data-panel="park"]')).toHaveClass(/collapsed/);
  expect(await undersizedTargets(page)).toEqual([]);
  await page.locator('[data-panel="finance"]').getByRole('tab', { name: 'Research' }).tap();
  expect(await undersizedTargets(page)).toEqual([]);
  await screenshot('m2-finance-sheet');

  await toolbar.getByRole('button', { name: 'Footpaths', exact: true }).scrollIntoViewIfNeeded();
  await toolbar.getByRole('button', { name: 'Footpaths', exact: true }).tap();
  await page.locator('#game').tap({ position: { x: 190, y: 200 } });
  await expect(page.locator('.tool-status')).toContainText('Path placement requested');
  const paths = page.locator('[data-panel="paths"]');
  await paths.locator('.ui-titlebar').tap();
  await expect(paths).toHaveClass(/collapsed/);
  await paths.getByRole('button', { name: 'Close Footpaths' }).tap();
  await expect(paths).toHaveCount(0);

  await toolbar.getByRole('button', { name: 'New ride', exact: true }).scrollIntoViewIfNeeded();
  await toolbar.getByRole('button', { name: 'New ride', exact: true }).tap();
  await page.getByRole('tab', { name: 'Shops & Stalls' }).tap();
  expect(await undersizedTargets(page)).toEqual([]);
  await screenshot('m3-ride-select');
});

test('guest and footpath controls stay reachable on a phone', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();

  const toolbar = page.locator('.game-toolbar');
  await toolbar.getByRole('button', { name: 'Guests', exact: true }).scrollIntoViewIfNeeded();
  await toolbar.getByRole('button', { name: 'Guests', exact: true }).tap();
  const guests = page.locator('[data-panel="guests"]');
  await guests.getByRole('tab', { name: 'By location' }).tap();
  const locationFilter = guests.getByLabel('Filter guests by location');
  await expect(locationFilter).toBeVisible();
  const location = await locationFilter.locator('option').nth(1).getAttribute('value');
  expect(location).toBeTruthy();
  await locationFilter.selectOption(location!);
  await expect(guests.locator('.ui-pane.active > .ui-help')).toContainText(/^\d+ guests?$/);
  await guests.getByRole('tab', { name: 'Guests' }).tap();
  await expect(guests.locator('.guest-entry').first()).toBeVisible();
  await guests.locator('.guest-entry').first().tap();
  await expect(page.locator('[data-panel^="guest-"]')).toBeVisible();
  expect(await undersizedTargets(page)).toEqual([]);

  await toolbar.getByRole('button', { name: 'Footpaths', exact: true }).scrollIntoViewIfNeeded();
  await toolbar.getByRole('button', { name: 'Footpaths', exact: true }).tap();
  const paths = page.locator('[data-panel="paths"]');
  await expect(paths.getByRole('button', { name: 'Queue line' })).toBeVisible();
  await expect(paths.getByRole('button', { name: 'Follow terrain slope' })).toBeVisible();
  await expect(paths.getByRole('button', { name: 'Remove footpath' })).toBeVisible();
  const queue = paths.getByRole('button', { name: 'Queue line' });
  await queue.tap();
  await expect(queue).toHaveAttribute('aria-pressed', 'true');
  const slope = paths.getByRole('button', { name: 'Follow terrain slope' });
  await slope.tap();
  await expect(paths.getByLabel('Slope direction')).toBeVisible();
  const remove = paths.getByRole('button', { name: 'Remove footpath' });
  await remove.tap();
  await expect(remove).toHaveAttribute('aria-pressed', 'true');
  expect(await undersizedTargets(page)).toEqual([]);
});

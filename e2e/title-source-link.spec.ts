import { devices, expect, test } from './support/test';
import type { Page } from '@playwright/test';
import { createTestContext } from './support/test-contexts';

const REPO_URL = 'https://github.com/tilework-tech/opencoaster';

async function expectSourceLinkBesideMenu(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'OpenCoaster' })).toBeVisible();
  const link = page.getByRole('link', { name: /Source on GitHub/ });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', REPO_URL);
  await expect(link).toHaveAttribute('target', '_blank');
  const rel = (await link.getAttribute('rel')) ?? '';
  expect(rel.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));

  await expect(link).toBeInViewport({ ratio: 1 });
  const linkBox = await link.boundingBox();
  expect(linkBox).not.toBeNull();
  for (const name of ['New game', 'Sandbox', 'Continue', 'Load game', 'Import save file']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box).not.toBeNull();
    const overlaps =
      linkBox!.x < box!.x + box!.width &&
      box!.x < linkBox!.x + linkBox!.width &&
      linkBox!.y < box!.y + box!.height &&
      box!.y < linkBox!.y + linkBox!.height;
    expect(overlaps, `link overlaps ${name}`).toBe(false);
  }
}

test('the title screen links to the source on GitHub in a new tab on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expectSourceLinkBesideMenu(page);

  const link = page.getByRole('link', { name: /Source on GitHub/ });
  for (let i = 0; i < 12 && !(await link.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(link).toBeFocused();

  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expectSourceLinkBesideMenu(page);

  await page.getByRole('button', { name: 'Load game', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expectSourceLinkBesideMenu(page);
});

test('the title screen source link fits beside the menu on a Pixel 8', async ({ browser }) => {
  const { defaultBrowserType: _browserType, ...options } = devices['Pixel 8'];
  void _browserType;
  const context = await createTestContext(browser, options);
  const page = await context.newPage();
  await page.goto('/');
  await expectSourceLinkBesideMenu(page);
});

import { expect, test } from '@playwright/test';

test('Display keeps pixel scale by default and reports effective render scale', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Sandbox' }).click();

  const hud = page.locator('.hud');
  await expect(hud).toContainText('WebGL2', { timeout: 30_000 });
  await expect(hud).toContainText(/scale [\d.]+×/);

  const toolbar = page.locator('.game-toolbar');
  await toolbar.getByRole('button', { name: 'Game options', exact: true }).click();
  await page.getByRole('tab', { name: 'Display' }).click();
  const reduceResolution = page.getByRole('checkbox', {
    name: 'Reduce resolution when slow',
  });
  await expect(reduceResolution).not.toBeChecked();
  await reduceResolution.check();
  await expect(reduceResolution).toBeChecked();
  expect(
    await page.evaluate(() =>
      localStorage.getItem('opencoaster-option-reduce-resolution-when-slow'),
    ),
  ).toBe('true');

  await page.reload();
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await page
    .locator('.game-toolbar')
    .getByRole('button', { name: 'Game options', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Display' }).click();
  await expect(page.getByRole('checkbox', { name: 'Reduce resolution when slow' })).toBeChecked();

  const performanceOverlay = page.getByRole('checkbox', { name: 'Performance overlay' });
  await performanceOverlay.check();
  await expect(hud).toBeVisible();
  await expect(hud).toContainText(/scale [\d.]+×/);
  const effectiveScale = await page.locator('#game').evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    return element.width / element.clientWidth;
  });
  await expect(hud).toContainText(`scale ${effectiveScale.toFixed(2)}×`);
});

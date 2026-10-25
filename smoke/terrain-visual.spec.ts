import { expect, test } from '@playwright/test';

test('captures the WebGL2 starter park terrain', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.hud')).toContainText('WebGL2', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Game options' }).click();
  await page.getByRole('tab', { name: 'Display' }).click();
  const gridlines = page.getByRole('checkbox', { name: 'Gridlines' });
  await expect(gridlines).not.toBeChecked();
  await page.getByRole('button', { name: 'Game options' }).click();
  await page.mouse.move(640, 400);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(40);
  }
  await page.mouse.down();
  await page.mouse.move(509, 378);
  await page.mouse.up();
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: testInfo.outputPath('terrain-starter-before.png') });
  await page.getByRole('button', { name: 'Game options' }).click();
  await page.getByRole('tab', { name: 'Display' }).click();
  await gridlines.check();
  await expect(gridlines).toBeChecked();
  await page.getByRole('button', { name: 'Game options' }).click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: testInfo.outputPath('terrain-starter-gridlines.png') });
  await page.getByRole('button', { name: 'Game options' }).click();
  await page.getByRole('tab', { name: 'Display' }).click();
  await gridlines.uncheck();
});

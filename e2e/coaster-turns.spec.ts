import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import { steelShowcaseSave } from './support/steel-showcase';

test('a steel looping coaster draws connected track and supports in all four views', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const savePath = testInfo.outputPath('steel-showcase.ocsave');
  await mkdir(dirname(savePath), { recursive: true });
  await writeFile(savePath, steelShowcaseSave());

  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  const toolbar = page.locator('.game-toolbar');
  await toolbar.getByRole('button', { name: 'Game options', exact: true }).click();
  await page.getByRole('button', { name: 'Save, load and quit…' }).click();
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(page.locator('.save-menu')).toBeHidden();
  await expect(page.locator('.hud')).toContainText('WebGL2');

  for (let rotation = 0; rotation < 4; rotation++) {
    await expect(page.locator('.hud')).toContainText(`rot ${rotation}`);
    await page.waitForTimeout(1_500);
    const path = testInfo.outputPath(`steel-looping-view-${rotation}.png`);
    await page.screenshot({ path, timeout: 60_000 });
    await testInfo.attach(`steel-looping-view-${rotation}`, { path, contentType: 'image/png' });
    await toolbar.getByRole('button', { name: 'Rotate right', exact: true }).click();
  }
});

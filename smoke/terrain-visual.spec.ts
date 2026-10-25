import { expect, test } from '@playwright/test';
import sharp from 'sharp';

const PIXEL_NEIGHBOURS = [-1, 1, 0, 0] as const;
const PIXEL_ROW_OFFSETS = [0, 0, -1, 1] as const;

async function assertTerrainPixels(canvasScreenshot: Buffer): Promise<void> {
  const { data, info } = await sharp(canvasScreenshot)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const seen = new Uint8Array(info.width * info.height);
  const queue = new Uint32Array(info.width * info.height);
  let waterPixels = 0;
  let largestWaterRegion = 0;
  let clearColorPixels = 0;
  for (let pixel = 0; pixel < seen.length; pixel++) {
    const offset = pixel * info.channels;
    const red = data[offset]!;
    const green = data[offset + 1]!;
    const blue = data[offset + 2]!;
    if (Math.abs(red - 15) <= 2 && Math.abs(green - 20) <= 2 && Math.abs(blue - 26) <= 2)
      clearColorPixels++;
    if (blue > red + 45 && green > red + 25 && blue > green + 4) waterPixels++;
  }
  for (let start = 0; start < seen.length; start++) {
    const offset = start * info.channels;
    if (
      seen[start] ||
      data[offset + 2]! <= data[offset]! + 45 ||
      data[offset + 1]! <= data[offset]! + 25 ||
      data[offset + 2]! <= data[offset + 1]! + 4
    )
      continue;
    let read = 0;
    let write = 0;
    queue[write++] = start;
    seen[start] = 1;
    while (read < write) {
      const pixel = queue[read++]!;
      for (let direction = 0; direction < PIXEL_NEIGHBOURS.length; direction++) {
        const xOffset = PIXEL_NEIGHBOURS[direction]!;
        const yOffset = PIXEL_ROW_OFFSETS[direction]!;
        const x = pixel % info.width;
        const y = Math.floor(pixel / info.width);
        if (
          (xOffset < 0 && x === 0) ||
          (xOffset > 0 && x === info.width - 1) ||
          (yOffset < 0 && y === 0) ||
          (yOffset > 0 && y === info.height - 1)
        )
          continue;
        const neighbour = pixel + yOffset * info.width + xOffset;
        if (seen[neighbour]) continue;
        const neighbourOffset = neighbour * info.channels;
        if (
          data[neighbourOffset + 2]! <= data[neighbourOffset]! + 45 ||
          data[neighbourOffset + 1]! <= data[neighbourOffset]! + 25 ||
          data[neighbourOffset + 2]! <= data[neighbourOffset + 1]! + 4
        )
          continue;
        seen[neighbour] = 1;
        queue[write++] = neighbour;
      }
    }
    largestWaterRegion = Math.max(largestWaterRegion, write);
  }
  expect(clearColorPixels).toBeLessThan(500);
  expect(waterPixels).toBeGreaterThan(10_000);
  expect(largestWaterRegion / waterPixels).toBeGreaterThan(0.5);
}

test('captures the WebGL2 starter park terrain', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page.locator('section').getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.hud')).toContainText('WebGL2', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Close Park' }).click();
  await page.getByRole('button', { name: 'Game options' }).click();
  await page.getByRole('tab', { name: 'Display' }).click();
  const gridlines = page.getByRole('checkbox', { name: 'Gridlines' });
  await expect(gridlines).not.toBeChecked();
  await page.getByRole('button', { name: 'Game options' }).click();
  const pause = page.getByRole('button', { name: 'Pause' });
  if (await pause.isVisible()) await pause.click();
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
  const terrainCanvas = page.locator('#game');
  const withoutGridlines = await terrainCanvas.screenshot();
  await assertTerrainPixels(withoutGridlines);
  await page.getByRole('button', { name: 'Game options' }).click();
  await page.getByRole('tab', { name: 'Display' }).click();
  await gridlines.check();
  await expect(gridlines).toBeChecked();
  await page.getByRole('button', { name: 'Game options' }).click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: testInfo.outputPath('terrain-starter-gridlines.png') });
  const withGridlines = await terrainCanvas.screenshot();
  const beforePixels = await sharp(withoutGridlines).removeAlpha().raw().toBuffer();
  const afterPixels = await sharp(withGridlines).removeAlpha().raw().toBuffer();
  let changedPixels = 0;
  for (let offset = 0; offset < beforePixels.length; offset += 3) {
    if (
      Math.abs(beforePixels[offset]! - afterPixels[offset]!) > 2 ||
      Math.abs(beforePixels[offset + 1]! - afterPixels[offset + 1]!) > 2 ||
      Math.abs(beforePixels[offset + 2]! - afterPixels[offset + 2]!) > 2
    )
      changedPixels++;
  }
  expect(changedPixels).toBeGreaterThan(500);
  await page.getByRole('button', { name: 'Game options' }).click();
  await page.getByRole('tab', { name: 'Display' }).click();
  await gridlines.uncheck();
  await page.getByRole('button', { name: 'Game options' }).click();

  await page.getByRole('button', { name: 'Footpaths' }).click();
  for (const surface of ['Tarmac', 'Crazy paving', 'Dirt'])
    await expect(page.getByRole('button', { name: surface, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Scenery', exact: true }).click();
  const sceneryCategory = page.getByRole('combobox', { name: 'Scenery category' });
  await sceneryCategory.selectOption({ label: 'Gardens' });
  await expect(
    page.getByRole('combobox', { name: 'Scenery item' }).locator('option'),
  ).not.toHaveCount(0);
});

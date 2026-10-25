import { expect, test } from '@playwright/test';

async function startStarterPark(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Starter Park' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
}

async function placeCoaster(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const minimap = page.locator('.minimap');
  const bounds = await minimap.boundingBox();
  if (!bounds) throw new Error('Park map is missing');
  const dimensions = await minimap.evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
  }));
  const x = 28;
  const y = 43;
  const clickX = ((x - y + dimensions.height - 1 + 0.5) / dimensions.width) * bounds.width;
  const clickY = (((x + y) / 2 + 0.25) / dimensions.height) * bounds.height;
  await minimap.click({ position: { x: clickX, y: clickY } });
  await page.getByRole('button', { name: 'Close Map' }).click();
  const canvas = page.locator('#game');
  const rect = await canvas.boundingBox();
  if (!rect) throw new Error('Game viewport is missing');
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

test('desktop construction controls fit above the fold', async ({ page }) => {
  await startStarterPark(page);
  expect(
    await page.locator('#game').evaluate((canvas) => Boolean(canvas.getContext('webgl2'))),
  ).toBe(true);
  await expect(page.locator('.ownership-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'New ride', exact: true }).click();
  const ridePicker = await page.locator('[data-panel="ride-select"]').boundingBox();
  expect(ridePicker).not.toBeNull();
  expect(ridePicker!.y + ridePicker!.height).toBeLessThanOrEqual(760);
  await page.getByRole('tab', { name: 'Roller Coasters' }).click();
  await page.getByRole('button', { name: /^Steel Looping Coaster/ }).click();
  await placeCoaster(page);

  const panel = page.locator('[data-panel="construction"]');
  const build = await panel.getByRole('button', { name: 'Build piece' }).boundingBox();
  expect(build).not.toBeNull();
  expect(build!.y + build!.height).toBeLessThanOrEqual(800);
  await page.screenshot({
    path: 'docs/playtest/assets/p1-after-coaster-controls.png',
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.mouse.move(640, 400);
  await page.waitForTimeout(100);
  await panel.getByRole('button', { name: 'Build piece' }).click();
  await expect(page.locator('.coaster-info')).toContainText('Track 1 pieces');

  await page.getByRole('button', { name: 'Game options', exact: true }).click();
  await page.getByRole('button', { name: '4×', exact: true }).click();
  await expect(page.getByRole('button', { name: '2×', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: 'Rides', exact: true }).click();
  await page.locator('[data-panel="ride-list"] .list-row').first().click();
  await expect(page.locator('[data-panel="ride-0"] .ride-preview')).toBeVisible();
  await expect(page.locator('[data-panel="ride-0"] [role="tab"]')).toHaveCount(8);
  await page.screenshot({ path: 'docs/playtest/assets/p1-after-ride-preview.png', fullPage: true });
});

test('park windows return to their dragged position when reopened', async ({ page }) => {
  await startStarterPark(page);
  const park = page.locator('[data-panel="park"]');
  const initial = await park.boundingBox();
  expect(initial).not.toBeNull();
  await page.mouse.move(initial!.x + 70, initial!.y + 16);
  await page.mouse.down();
  await page.mouse.move(120, 140);
  await page.mouse.up();
  const moved = await park.boundingBox();
  await page.getByRole('button', { name: 'Close Park', exact: true }).click();
  await page.getByRole('button', { name: 'Park', exact: true }).click();
  const reopened = await page.locator('[data-panel="park"]').boundingBox();
  expect(reopened?.x).toBeCloseTo(moved?.x ?? -1, 0);
  expect(reopened?.y).toBeCloseTo(moved?.y ?? -1, 0);
});

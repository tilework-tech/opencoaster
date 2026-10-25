import { devices, expect, test, type Page } from '@playwright/test';

async function startStarterPark(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Starter Park' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(page.locator('.hud')).toContainText('WebGL2');
}

async function centerMapOnTile(page: Page, x: number, y: number): Promise<void> {
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const minimap = page.locator('.minimap');
  await expect(minimap).toHaveAttribute('width', '128');
  const bounds = await minimap.boundingBox();
  if (!bounds) throw new Error('Park map is missing');
  const size = await minimap.evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
    mapWidth: 64,
    mapHeight: 64,
  }));
  await minimap.click({
    position: {
      x: ((x - y + size.mapHeight + 0.5) / size.width) * bounds.width,
      y: (((x + y) / 2 + 0.5) / size.height) * bounds.height,
    },
  });
  await page.getByRole('button', { name: 'Close Map' }).click();
}

test('shows land rights in Park information with purchase prices and distinct sale types', async ({
  page,
}) => {
  await startStarterPark(page);
  await page.locator('[data-panel="park"]').getByRole('button', { name: 'Land rights' }).click();
  const landRights = page.locator('[data-panel="land-rights"]');
  await expect(landRights).toBeVisible();
  const panelBounds = await landRights.boundingBox();
  const objectiveBounds = await page.locator('.objective-strip').boundingBox();
  expect(panelBounds).not.toBeNull();
  expect(objectiveBounds).not.toBeNull();
  expect(
    panelBounds!.x < objectiveBounds!.x + objectiveBounds!.width &&
      panelBounds!.x + panelBounds!.width > objectiveBounds!.x &&
      panelBounds!.y < objectiveBounds!.y + objectiveBounds!.height &&
      panelBounds!.y + panelBounds!.height > objectiveBounds!.y,
  ).toBe(false);
  await expect(landRights).toContainText('Land available to buy');
  await expect(landRights).toContainText('$100.00 per tile');
  await expect(landRights).toContainText('Construction rights only');
  await expect(landRights).toContainText('$40.00 per tile');
  const landSwatch = landRights.locator('[data-ownership="land-sale"]');
  const rightsSwatch = landRights.locator('[data-ownership="rights-sale"]');
  await expect(landSwatch).toBeVisible();
  await expect(rightsSwatch).toBeVisible();
  expect(
    await landSwatch.evaluate((node) => getComputedStyle(node).getPropertyValue('--sale-color')),
  ).not.toBe(
    await rightsSwatch.evaluate((node) => getComputedStyle(node).getPropertyValue('--sale-color')),
  );
  await page.screenshot({ path: 'docs/playtest/assets/p1-land-rights-after.png' });

  const buyLand = landRights.getByRole('button', { name: 'Buy land' });
  const landOffer = landRights.locator('.land-rights-count').nth(0);
  await expect(landOffer).toContainText(/\d+ tiles · \$100\.00 per tile/);
  const landBefore = Number((await landOffer.textContent())?.match(/\d+/)?.[0]);
  const rightsOffer = landRights.locator('.land-rights-count').nth(1);
  await expect(rightsOffer).toContainText(/\d+ tiles · \$40\.00 per tile/);
  const rightsBefore = Number((await rightsOffer.textContent())?.match(/\d+/)?.[0]);
  expect(landBefore).not.toBe(rightsBefore);
  await buyLand.click();
  await expect(buyLand).toHaveAttribute('aria-pressed', 'true');
  await centerMapOnTile(page, 14, 40);
  const viewport = await page.locator('#game').boundingBox();
  if (!viewport) throw new Error('Game viewport is missing');
  const cash = page.locator('.status-cash .status-value');
  const startingCash = await cash.textContent();
  await page.mouse.click(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await expect(page.locator('.tool-status')).toContainText('Land purchase requested');
  await expect(cash).not.toHaveText(startingCash ?? '');
  await expect(landOffer).toContainText(`${landBefore - 1} tiles · $100.00 per tile`);

  const buyRights = landRights.getByRole('button', { name: 'Buy construction rights' });
  await buyRights.click();
  await expect(buyRights).toHaveAttribute('aria-pressed', 'true');
  await centerMapOnTile(page, 10, 40);
  await page.mouse.click(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await expect(page.locator('.tool-status')).toContainText(
    'Construction rights purchase requested',
  );
  await expect(rightsOffer).toContainText(`${rightsBefore - 1} tiles · $40.00 per tile`);

  await page.getByRole('button', { name: 'Footpaths', exact: true }).click();
  await centerMapOnTile(page, 14, 40);
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await expect(page.locator('.build-hover-tip')).toBeHidden();
  await centerMapOnTile(page, 10, 40);
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await expect(page.locator('.build-hover-tip')).toBeHidden();
});

test('shows an explanatory red build preview while hovering over unowned land', async ({
  page,
}) => {
  await startStarterPark(page);
  await page.getByRole('button', { name: 'Footpaths', exact: true }).click();
  await centerMapOnTile(page, 10, 40);
  const viewport = await page.locator('#game').boundingBox();
  if (!viewport) throw new Error('Game viewport is missing');
  const x = viewport.x + viewport.width / 2;
  const y = viewport.y + viewport.height / 2;
  await page.mouse.move(x, y);

  await expect(page.locator('.build-hover-tip')).toHaveText('Land not owned by park');
  const preview = page.locator('.track-preview');
  await expect(preview).toBeVisible();
  const redPreviewPixels = await preview.evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext('2d');
    if (!context) throw new Error('Build preview is missing a 2D context');
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let redPixels = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 3]! > 0 && pixels[i]! > pixels[i + 1]! * 1.5) redPixels++;
    return redPixels;
  });
  expect(redPreviewPixels).toBeGreaterThan(0);
  await page.screenshot({ path: 'docs/playtest/assets/p1-unowned-hover-after.png' });

  await page.getByRole('button', { name: 'Land', exact: true }).click();
  await page.mouse.move(x, y);
  await expect(page.locator('.build-hover-tip')).toHaveText('Land not owned by park');
});

test('land rights purchase controls fit the Pixel 8 bottom sheet', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['Pixel 8'], serviceWorkers: 'allow' });
  const page = await context.newPage();
  await startStarterPark(page);
  await page.locator('[data-panel="park"]').getByRole('button', { name: 'Land rights' }).tap();
  const landRights = page.locator('[data-panel="land-rights"]');
  await expect(landRights.getByRole('button', { name: 'Buy land' })).toBeVisible();
  await expect(landRights.getByRole('button', { name: 'Buy construction rights' })).toBeVisible();
  const bounds = await landRights.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await context.close();
});

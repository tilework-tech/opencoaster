import { expect, test } from '@playwright/test';

test('UI icon controls keep their accessible names and use native pixel art', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.locator('.game-toolbar')).toBeVisible();

  const toolbar = page.locator('.game-toolbar');
  const buttons = toolbar.locator('button[data-action]');
  const labels = await buttons.evaluateAll((items) =>
    items.map((item) => item.getAttribute('aria-label')),
  );
  expect(labels).toContain('Pause');
  expect(labels).toContain('New ride');
  expect(labels).toContain('Rotate right');
  expect(labels).toContain('Rotate left');
  expect(await toolbar.locator('svg.ui-icon').count()).toBe(0);

  const actionIcons = Object.fromEntries(
    await buttons.evaluateAll((items) =>
      items.map((item) => [
        item.getAttribute('data-action'),
        item.querySelector('img.ui-icon')?.getAttribute('data-icon-id'),
      ]),
    ),
  );
  expect(actionIcons['options']).toBe('options');
  expect(actionIcons['save-load']).toBe('saveLoad');
  expect(actionIcons['ride-select']).toBe('newRide');
  expect(actionIcons['ride-list']).toBe('wheel');

  await toolbar.getByRole('button', { name: 'Game options' }).click();
  const optionTabs = page.locator('.ui-window[data-panel="options"] .ui-tab');
  const optionTabIcons = await optionTabs
    .locator('img.ui-icon')
    .evaluateAll((images) => images.map((image) => image.getAttribute('data-icon-id')));
  expect(optionTabIcons).toEqual(['options', 'sound', 'news', 'view', 'info']);
  expect(new Set(optionTabIcons).size).toBe(5);

  const rendered = await buttons.locator('img.ui-icon').evaluateAll(async (images) => {
    await Promise.all(images.map((image) => image.decode()));
    return images.map((image) => ({
      id: image.getAttribute('data-icon-id'),
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      width: image.getBoundingClientRect().width,
      height: image.getBoundingClientRect().height,
      imageRendering: getComputedStyle(image).imageRendering,
    }));
  });
  expect(rendered.length).toBeGreaterThan(0);
  expect(rendered.every((image) => image.id && image.complete)).toBe(true);
  expect(
    rendered.every(
      (image) => image.naturalWidth === image.width && image.naturalHeight === image.height,
    ),
  ).toBe(true);
  expect(
    rendered.every((image) => Number.isInteger(image.width) && Number.isInteger(image.height)),
  ).toBe(true);
  expect(rendered.every((image) => image.imageRendering === 'pixelated')).toBe(true);

  const speedButtons = toolbar.locator('.toolbar-speed-button');
  expect(await speedButtons.count()).toBe(3);
  expect(
    await speedButtons.evaluateAll((items) =>
      items.every(
        (item) => item.querySelector('img.ui-icon') && item.querySelector('.toolbar-speed-label'),
      ),
    ),
  ).toBe(true);

  await expect(page.locator('.ui-window[data-panel="park"]')).toBeVisible();
  const windowIcons = page.locator('.ui-window img.ui-icon');
  expect(await windowIcons.count()).toBeGreaterThan(0);
  expect(
    await page
      .locator('.ui-titlebtn img.ui-icon')
      .first()
      .evaluate((image) => image.naturalWidth),
  ).toBe(16);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.getByRole('button', { name: 'Actions' }).click();
  await expect(page.locator('#toolbar-actions-menu')).toHaveClass(/open/);
  expect(await page.locator('#toolbar-actions-menu img.ui-icon').count()).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Rotate right' })).toHaveAttribute(
    'title',
    /Enter or Z/,
  );
  await expect(page.getByRole('button', { name: 'Rotate left' })).toHaveAttribute(
    'title',
    /Shift\+Enter or X/,
  );
});

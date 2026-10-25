import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test('keeps map camera controls reachable on a phone-sized screen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();

  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  const zoomOut = page.getByRole('button', { name: 'Zoom out' });
  const openActions = async () => {
    if (await zoomIn.isVisible()) return;
    await page.locator('.game-toolbar').getByRole('button', { name: 'Actions', exact: true }).tap();
  };
  await openActions();
  await expect(zoomIn).toBeVisible();
  await expect(zoomOut).toBeVisible();

  for (const control of [zoomIn, zoomOut]) {
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  }

  const initialFrame = await page.locator('#game').screenshot();
  await openActions();
  await zoomIn.tap();
  const zoomedFrame = await page.locator('#game').screenshot();
  expect(createHash('sha256').update(zoomedFrame).digest('hex')).not.toBe(
    createHash('sha256').update(initialFrame).digest('hex'),
  );
  await openActions();
  await zoomOut.tap();

  const beforePinch = await page.locator('#game').screenshot();
  const beforePinchHash = createHash('sha256').update(beforePinch).digest('hex');
  const session = await page.context().newCDPSession(page);
  const dispatchTouches = async (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: Array<{ id: number; x: number; y: number }>,
  ) => {
    await session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((point) => ({
        ...point,
        radiusX: 1,
        radiusY: 1,
        force: 1,
      })),
    });
  };
  await dispatchTouches('touchStart', [
    { id: 1, x: 100, y: 400 },
    { id: 2, x: 200, y: 400 },
  ]);
  // Zoom snaps to the nearest level in log space, so the spread must grow past √2 (about 1.41×)
  // to step from zoom 1 to 2; 100 → 180 px is 1.8×.
  await dispatchTouches('touchMove', [
    { id: 1, x: 60, y: 400 },
    { id: 2, x: 240, y: 400 },
  ]);
  await expect
    .poll(async () => {
      const afterPinch = await page.locator('#game').screenshot();
      return createHash('sha256').update(afterPinch).digest('hex');
    })
    .not.toBe(beforePinchHash);
  await dispatchTouches('touchEnd', []);
  await session.detach();
});

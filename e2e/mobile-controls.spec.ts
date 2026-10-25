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
  await zoomIn.tap();
  const zoomedFrame = await page.locator('#game').screenshot();
  expect(createHash('sha256').update(zoomedFrame).digest('hex')).not.toBe(
    createHash('sha256').update(initialFrame).digest('hex'),
  );
  await zoomOut.tap();

  const beforePinch = await page.locator('#game').screenshot();
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { id: 1, x: 100, y: 400 },
      { id: 2, x: 200, y: 400 },
    ],
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { id: 1, x: 80, y: 400 },
      { id: 2, x: 220, y: 400 },
    ],
  });
  const afterPinch = await page.locator('#game').screenshot();
  expect(createHash('sha256').update(afterPinch).digest('hex')).not.toBe(
    createHash('sha256').update(beforePinch).digest('hex'),
  );
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
});

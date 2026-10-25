import { devices, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type Rotation = 0 | 1 | 2 | 3;

async function startSandbox(page: Page, mobile = false): Promise<void> {
  if (!mobile) await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.locator('.game-toolbar')).toBeVisible();
  await expect(page.locator('.hud')).toContainText(/rot [0-3]/);
  await page.waitForTimeout(500);
}

async function centerTile(page: Page): Promise<string> {
  const bounds = await page.locator('#game').boundingBox();
  if (!bounds) throw new Error('The park viewport is missing');
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const status = await page.locator('.tool-status').innerText();
  const match = status.match(/Tile (\d+), (\d+)/);
  if (!match) throw new Error(`Could not read the tile at the viewport center: ${status}`);
  return `${match[1]},${match[2]}`;
}

async function rotation(page: Page): Promise<Rotation> {
  const hud = await page.locator('.hud').innerText();
  const match = hud.match(/\brot ([0-3])\b/);
  if (!match) throw new Error(`Camera rotation missing from HUD: ${hud}`);
  return Number(match[1]) as Rotation;
}

async function expectCenterTile(page: Page, expected: string): Promise<void> {
  expect(await centerTile(page)).toBe(expected);
}

test('toolbar controls preserve the viewport focus through four turns in both directions', async ({
  page,
}) => {
  await startSandbox(page);
  const toolbar = page.locator('.game-toolbar');
  const focus = await centerTile(page);
  const initialRotation = await rotation(page);

  await expect(toolbar.getByRole('button', { name: 'Rotate clockwise', exact: true })).toHaveAttribute(
    'title',
    /Enter|Z/,
  );
  await expect(
    toolbar.getByRole('button', { name: 'Rotate anticlockwise', exact: true }),
  ).toHaveAttribute('title', /Shift\+Enter|X/);

  await toolbar.getByRole('button', { name: 'Game options', exact: true }).click();
  await page.locator('[data-panel="options"]').getByRole('tab', { name: 'Controls' }).click();
  await expect(page.locator('[data-panel="options"]')).toContainText('Enter / Z');
  await expect(page.locator('[data-panel="options"]')).toContainText('Shift+Enter / X');

  await toolbar.getByRole('button', { name: 'Staff', exact: true }).click();
  for (let turn = 1; turn <= 4; turn++) {
    await toolbar.getByRole('button', { name: 'Rotate clockwise', exact: true }).click();
    await expect.poll(() => rotation(page)).toBe((initialRotation + turn) % 4);
    await expectCenterTile(page, focus);
  }
  for (let turn = 1; turn <= 4; turn++) {
    await toolbar.getByRole('button', { name: 'Rotate anticlockwise', exact: true }).click();
    await expect.poll(() => rotation(page)).toBe((initialRotation - turn + 4) % 4);
    await expectCenterTile(page, focus);
  }
});

test('Enter and Z rotate clockwise; Shift+Enter and X rotate anticlockwise', async ({ page }) => {
  await startSandbox(page);
  const focus = await centerTile(page);
  const initialRotation = await rotation(page);

  for (const [key, direction] of [
    ['Enter', 1],
    ['z', 1],
    ['Shift+Enter', -1],
    ['x', -1],
  ] as const) {
    await page.keyboard.press(key);
    await expect.poll(() => rotation(page)).toBe((initialRotation + direction + 4) % 4);
    await expectCenterTile(page, focus);
  }
});

test('Pixel 8 exposes both rotate controls and rotates both ways with a two-finger twist', async ({
  browser,
}) => {
  const { defaultBrowserType: _browserType, ...options } = devices['Pixel 8'];
  void _browserType;
  const context = await browser.newContext({ ...options, serviceWorkers: 'allow' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await startSandbox(page, true);
  const toolbar = page.locator('.game-toolbar');
  const focus = await centerTile(page);
  const initialRotation = await rotation(page);

  const actions = toolbar.getByRole('button', { name: 'Actions', exact: true });
  await actions.tap();
  await expect(toolbar.getByRole('button', { name: 'Rotate clockwise', exact: true })).toBeVisible();
  await expect(
    toolbar.getByRole('button', { name: 'Rotate anticlockwise', exact: true }),
  ).toBeVisible();
  await toolbar.getByRole('button', { name: 'Rotate clockwise', exact: true }).tap();
  await expect.poll(() => rotation(page)).toBe((initialRotation + 1) % 4);
  await expectCenterTile(page, focus);
  await actions.tap();

  const bounds = await page.locator('#game').boundingBox();
  if (!bounds) throw new Error('The park viewport is missing');
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const first = { id: 1, x: center.x - 50, y: center.y };
  const second = { id: 2, x: center.x + 50, y: center.y };
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [first, second].map((point) => ({ ...point, radiusX: 1, radiusY: 1, force: 1 })),
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      first,
      { id: 2, x: center.x, y: center.y + 50 },
    ].map((point) => ({ ...point, radiusX: 1, radiusY: 1, force: 1 })),
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => rotation(page)).toBe((initialRotation + 2) % 4);
  await expectCenterTile(page, focus);

  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [first, second].map((point) => ({ ...point, radiusX: 1, radiusY: 1, force: 1 })),
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      first,
      { id: 2, x: center.x, y: center.y - 50 },
    ].map((point) => ({ ...point, radiusX: 1, radiusY: 1, force: 1 })),
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => rotation(page)).toBe((initialRotation + 1) % 4);
  await expectCenterTile(page, focus);
  await context.close();
});

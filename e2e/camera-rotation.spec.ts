import { devices, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type Rotation = 0 | 1 | 2 | 3;

type CameraState = { x: number; y: number; zoom: number; rotation: Rotation };

async function centerWorldPoint(page: Page): Promise<{ x: number; y: number; z: number }> {
  return page.evaluate(async () => {
    const state = window as unknown as {
      __camera: CameraState;
      __map: {
        width: number;
        height: number;
        heights: Uint8Array;
        pathElements?: Int32Array;
        pathCount?: number;
      };
      __snapshot?: { tracks: { count: number; data: Int32Array } };
    };
    const { getCenterFocusElevation } = await import('/src/input/camera-controls.ts');
    const camera = state.__camera;
    const map = state.__map;
    const bounds = document.querySelector('#game')!.getBoundingClientRect();
    const z = getCenterFocusElevation(
      map,
      camera,
      { width: bounds.width, height: bounds.height },
      state.__snapshot,
    );
    const horizontal = camera.x / 32;
    const vertical = (camera.y + (z / 64) * 16) / 16;
    const rx = (horizontal + vertical) / 2;
    const ry = (vertical - horizontal) / 2;
    let x: number;
    let y: number;
    switch (camera.rotation) {
      case 0:
        x = rx;
        y = ry;
        break;
      case 1:
        x = ry;
        y = map.height - rx;
        break;
      case 2:
        x = map.width - rx;
        y = map.height - ry;
        break;
      case 3:
        x = map.width - ry;
        y = rx;
        break;
    }
    return { x: x * 256, y: y * 256, z };
  });
}

async function expectWorldPointCentered(page: Page, point: { x: number; y: number; z: number }) {
  const error = await page.evaluate(async (focus) => {
    const state = window as unknown as {
      __camera: CameraState;
      __map: { width: number; height: number };
    };
    const { project } = await import('/src/render/projection.ts');
    const expected = new Float64Array(2);
    project(
      focus.x,
      focus.y,
      focus.z,
      state.__map.width,
      state.__map.height,
      state.__camera.rotation,
      expected,
    );
    return Math.max(
      Math.abs(state.__camera.x - expected[0]!),
      Math.abs(state.__camera.y - expected[1]!),
    );
  }, point);
  expect(
    error,
    'the same elevated world point should remain within one tile of the center',
  ).toBeLessThanOrEqual(32);
}

async function startSandbox(page: Page, mobile = false): Promise<void> {
  if (!mobile) await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.locator('.game-toolbar')).toBeVisible();
  await expect(page.locator('.hud')).toContainText(/rot [0-3]/);
  await centerOnFlatGround(page);
}

/**
 * Rotation pivots on the surface under the viewport centre, which is ambiguous where tiles of
 * different height meet. Park the camera on the middle of a flat 3x3 block so the focus is stable.
 */
async function centerOnFlatGround(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const state = window as unknown as {
      __camera: { x: number; y: number; rotation: number };
      __map: { width: number; height: number; heights: Uint8Array; slope?: Uint8Array };
    };
    const { project } = await import('/src/render/projection.ts');
    const { width, height, heights, slope } = state.__map;
    const flat = (x: number, y: number) => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = (y + dy) * width + x + dx;
          if (heights[i] !== heights[y * width + x] || (slope?.[i] ?? 0) !== 0) return false;
        }
      }
      return true;
    };
    for (let r = 0; r < width / 2 - 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = width / 2 + dx;
          const y = height / 2 + dy;
          if (!flat(x, y)) continue;
          const out = new Float64Array(2);
          project(
            (x + 0.5) * 256,
            (y + 0.5) * 256,
            heights[y * width + x]! * 64,
            width,
            height,
            state.__camera.rotation as 0 | 1 | 2 | 3,
            out,
          );
          state.__camera.x = out[0]!;
          state.__camera.y = out[1]!;
          return;
        }
      }
    }
    throw new Error('No flat 3x3 block found near the map centre');
  });
  await expect.poll(() => centerTile(page)).toMatch(/^\d+,\d+$/);
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

async function cameraPose(page: Page): Promise<CameraState> {
  return page.evaluate(() => {
    const camera = (window as unknown as { __camera: CameraState }).__camera;
    return { x: camera.x, y: camera.y, zoom: camera.zoom, rotation: camera.rotation };
  });
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
  const initialRotation = await rotation(page);

  await expect(
    toolbar.getByRole('button', { name: 'Rotate right', exact: true }),
  ).toHaveAttribute('title', /Enter|Z/);
  await expect(
    toolbar.getByRole('button', { name: 'Rotate left', exact: true }),
  ).toHaveAttribute('title', /Shift\+Enter|X/);

  await toolbar.getByRole('button', { name: 'Game options', exact: true }).click();
  await page.locator('[data-panel="options"]').getByRole('tab', { name: 'Controls' }).click();
  await expect(page.locator('[data-panel="options"]')).toContainText('Enter / Z');
  await expect(page.locator('[data-panel="options"]')).toContainText('Shift+Enter / X');

  await toolbar.getByRole('button', { name: 'Staff', exact: true }).click();
  for (const zoom of [0.5, 1, 2, 4]) {
    await page.evaluate((value) => {
      (window as unknown as { __camera: { zoom: number } }).__camera.zoom = value;
    }, zoom);
    const worldPoint = await centerWorldPoint(page);
    const startPose = await cameraPose(page);
    for (let turn = 1; turn <= 4; turn++) {
      await toolbar.getByRole('button', { name: 'Rotate right', exact: true }).click();
      await expect.poll(() => rotation(page)).toBe((initialRotation + turn) % 4);
      await expectWorldPointCentered(page, worldPoint);
    }
    const clockwisePose = await cameraPose(page);
    expect(clockwisePose.rotation).toBe(startPose.rotation);
    expect(clockwisePose.zoom).toBe(startPose.zoom);
    expect(clockwisePose.x).toBeCloseTo(startPose.x, 10);
    expect(clockwisePose.y).toBeCloseTo(startPose.y, 10);
    for (let turn = 1; turn <= 4; turn++) {
      await toolbar.getByRole('button', { name: 'Rotate left', exact: true }).click();
      await expect.poll(() => rotation(page)).toBe((initialRotation - turn + 4) % 4);
      await expectWorldPointCentered(page, worldPoint);
    }
    const anticlockwisePose = await cameraPose(page);
    expect(anticlockwisePose.rotation).toBe(startPose.rotation);
    expect(anticlockwisePose.zoom).toBe(startPose.zoom);
    expect(anticlockwisePose.x).toBeCloseTo(startPose.x, 10);
    expect(anticlockwisePose.y).toBeCloseTo(startPose.y, 10);
  }
});

test('Enter and Z rotate clockwise; Shift+Enter and X rotate anticlockwise', async ({ page }) => {
  await startSandbox(page);
  const focus = await centerTile(page);
  let currentRotation = await rotation(page);

  for (const [key, direction] of [
    ['Enter', 1],
    ['z', 1],
    ['Shift+Enter', -1],
    ['x', -1],
  ] as const) {
    await page.keyboard.press(key);
    currentRotation = ((currentRotation + direction + 4) % 4) as Rotation;
    await expect.poll(() => rotation(page)).toBe(currentRotation);
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
  await expect(
    toolbar.getByRole('button', { name: 'Rotate right', exact: true }),
  ).toBeVisible();
  await expect(
    toolbar.getByRole('button', { name: 'Rotate left', exact: true }),
  ).toBeVisible();
  await toolbar.getByRole('button', { name: 'Rotate right', exact: true }).tap();
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
    touchPoints: [first, { id: 2, x: center.x, y: center.y + 50 }].map((point) => ({
      ...point,
      radiusX: 1,
      radiusY: 1,
      force: 1,
    })),
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
    touchPoints: [first, { id: 2, x: center.x, y: center.y - 50 }].map((point) => ({
      ...point,
      radiusX: 1,
      radiusY: 1,
      force: 1,
    })),
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => rotation(page)).toBe((initialRotation + 1) % 4);
  await expectCenterTile(page, focus);
  await context.close();
});

import { expect, test } from './support/test';
import type { Page } from './support/test';

interface CameraState {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
}

const readCamera = (page: Page): Promise<CameraState> =>
  page.evaluate(() => {
    const { x, y, zoom, rotation } = (window as unknown as { __camera: CameraState }).__camera;
    return { x, y, zoom, rotation };
  });

async function startSandbox(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.locator('.game-toolbar')).toBeVisible();
  // The first snapshot after start recentres the camera; let it settle before panning.
  await page.waitForTimeout(1500);
}

async function panAway(page: Page): Promise<CameraState> {
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(540, 330, { steps: 5 });
  await page.mouse.up();
  const camera = await readCamera(page);
  expect(camera.x).not.toBe(0);
  return camera;
}

const isCanvasAt = (page: Page, x: number, y: number): Promise<boolean> =>
  page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.id === 'game', [x, y]);

async function clickManyTiles(page: Page, count: number, label: string): Promise<void> {
  const before = await readCamera(page);
  let clicked = 0;
  for (let i = 0; clicked < count && i < count * 20; i++) {
    const x = 300 + ((i * 97) % 700);
    const y = 200 + ((i * 53) % 400);
    if (!(await isCanvasAt(page, x, y))) continue;
    clicked++;
    await page.mouse.click(x, y);
    await page.waitForTimeout(40);
    expect(await readCamera(page), `${label}: camera after click ${i} at ${x},${y}`).toEqual(
      before,
    );
  }
  expect(clicked, `${label}: tiles clicked`).toBe(count);
}

test('clicking tiles never moves the camera unless the click is a drag', async ({ page }) => {
  await startSandbox(page);
  await panAway(page);
  const toolbar = page.locator('.game-toolbar');

  await clickManyTiles(page, 20, 'select tool');

  await toolbar.getByRole('button', { name: 'Land', exact: true }).click();
  await clickManyTiles(page, 50, 'land tool');

  await toolbar.getByRole('button', { name: 'Footpaths', exact: true }).click();
  await clickManyTiles(page, 20, 'path tool');

  for (let turn = 1; turn <= 4; turn++) {
    await toolbar.getByRole('button', { name: 'Rotate right', exact: true }).click();
    await clickManyTiles(page, 5, `rotation ${turn}`);
  }
});

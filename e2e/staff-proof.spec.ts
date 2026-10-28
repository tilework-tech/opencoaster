import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from './support/test';
import type { Page, TestInfo } from './support/test';
import { staffScene } from './support/staff-scene';
import { serialize } from '../src/save/save';
import { centerCameraOn, createStarterWorld, startStarterPark } from './footpath-helpers';

const PROOF_DIR = process.env.PROOF_DIR;

async function forceCanvas2D(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return original.call(this, type as '2d', ...(args as []));
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

/** Loads every sprite category so nothing in the frame falls back to placeholder art. */
async function loadAllSprites(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { spritePages } = await import('/src/render/sprite-pages.ts');
    const manifest = (await (await fetch('/sprites/manifest.json')).json()) as {
      categories: Record<string, unknown>;
    };
    const categories = Object.keys(manifest.categories);
    for (const category of categories) spritePages.requestCategory(category);
    const deadline = Date.now() + 60_000;
    while (!categories.every((category) => spritePages.isLoaded(category))) {
      if (Date.now() > deadline) throw new Error('sprite categories did not finish loading');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });
}

async function save(path: string, bytes: Buffer, testInfo: TestInfo, name: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function canvasPng(page: Page): Promise<Buffer> {
  const url = await page.evaluate(() =>
    document.querySelector<HTMLCanvasElement>('#game')!.toDataURL('image/png'),
  );
  return Buffer.from(url.split(',')[1]!, 'base64');
}

async function pauseGame(page: Page): Promise<void> {
  const pause = page.locator('.game-toolbar').getByRole('button', { name: 'Pause', exact: true });
  if (await pause.isVisible()) await pause.click();
}

async function importSave(page: Page, path: string): Promise<void> {
  const toolbar = page.locator('.game-toolbar');
  await toolbar.getByRole('button', { name: 'Save / Load', exact: true }).click();
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(path);
  await expect(page.locator('.hud')).toContainText('tick');
}

async function openScene(
  page: Page,
  path: string,
  centre: { x: number; y: number },
): Promise<void> {
  await forceCanvas2D(page);
  await startStarterPark(page);
  await importSave(page, path);
  await pauseGame(page);
  await loadAllSprites(page);
  await page.waitForTimeout(2_000);
  await centerCameraOn(page, createStarterWorld(), centre, 3);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __camera: { zoom: number } }).__camera.zoom),
    )
    .toBe(3);
  await page.waitForTimeout(1_500);
}

test('staff scene before: litter, vomit, a full bin, long grass and a thirsty bed', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const scene = staffScene();
  const beforePath = testInfo.outputPath('staff-before.park');
  await mkdir(dirname(beforePath), { recursive: true });
  await writeFile(beforePath, scene.before);
  const dir = PROOF_DIR ?? testInfo.outputPath('proof');
  await openScene(page, beforePath, scene.centre);
  await save(`${dir}/staff-before-canvas.png`, await canvasPng(page), testInfo, 'before');
});

test('staff scene after: a worked path and role statistics', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const scene = staffScene();
  const afterPath = testInfo.outputPath('staff-after.park');
  await mkdir(dirname(afterPath), { recursive: true });
  await writeFile(afterPath, serialize(scene.sim.world));
  const dir = PROOF_DIR ?? testInfo.outputPath('proof');
  const toolbar = page.locator('.game-toolbar');
  await openScene(page, afterPath, scene.centre);
  await save(`${dir}/staff-after-canvas.png`, await canvasPng(page), testInfo, 'after');

  await toolbar.getByRole('button', { name: 'Staff', exact: true }).click();
  const staff = page.locator('[data-panel="staff"]');
  await staff.getByRole('tab', { name: 'Handymen' }).click();
  await staff.getByRole('button', { name: /Open Handyman .* details/ }).click();
  const worker = page.locator('[data-panel^="worker-"]');
  await worker.getByRole('tab', { name: 'Orders' }).click();
  await expect(worker.getByRole('checkbox', { name: 'Mow grass' })).toBeChecked();
  await save(`${dir}/handyman-orders.png`, await worker.screenshot(), testInfo, 'orders');
  await worker.getByRole('tab', { name: 'Statistics' }).click();
  await expect(worker).toContainText('Lawns mown');
  await expect(
    worker.locator('.stat-row').filter({ hasText: 'Lawns mown' }).locator('.stat-value'),
  ).not.toHaveText('0');
  await save(`${dir}/handyman-statistics.png`, await worker.screenshot(), testInfo, 'stats');

  await worker.getByRole('button', { name: /^Close/ }).click();
  await staff.getByRole('tab', { name: 'Mechanics' }).click();
  await staff.getByRole('button', { name: /Open Mechanic .* details/ }).click();
  const mechanic = page.locator('[data-panel^="worker-"]').last();
  await mechanic.getByRole('tab', { name: 'Statistics' }).click();
  await expect(
    mechanic.locator('.stat-row').filter({ hasText: 'Rides fixed' }).locator('.stat-value'),
  ).toHaveText('1');
  await save(`${dir}/mechanic-statistics.png`, await mechanic.screenshot(), testInfo, 'mechanic');
});

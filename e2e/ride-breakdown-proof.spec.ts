import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from './support/test';
import type { Page, TestInfo } from './support/test';
import { serialize } from '../src/save/save';
import { breakdownScene, naturalBreakdownScene } from './support/breakdown-scene';
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

test('a broken-down ride shows a mechanic walking to it and its Maintenance tab', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const scene = breakdownScene();
  const savePath = testInfo.outputPath('breakdown.park');
  await mkdir(dirname(savePath), { recursive: true });
  await writeFile(savePath, serialize(scene.sim.world));

  await forceCanvas2D(page);
  await startStarterPark(page);
  const toolbar = page.locator('.game-toolbar');
  await toolbar.getByRole('button', { name: 'Save / Load', exact: true }).click();
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(page.locator('.hud')).toContainText('tick');
  await toolbar.getByRole('button', { name: 'Pause', exact: true }).click();

  await loadAllSprites(page);
  await centerCameraOn(page, createStarterWorld(), { x: 27, y: 42 }, 2.5);
  await page.waitForTimeout(1_500);

  await toolbar.getByRole('button', { name: 'Rides', exact: true }).click();
  await page
    .locator('[data-panel="ride-list"] .list-row')
    .filter({ hasText: 'Merry-Go-Round' })
    .click();
  const win = page.locator('[data-panel="ride-0"]');
  await win.getByRole('tab', { name: 'Maintenance', exact: true }).click();
  await expect(win).toContainText('Broken down');
  await expect(win).toContainText('On the way');
  await expect(win).toContainText('Downtime');

  const dir = PROOF_DIR ?? testInfo.outputPath('proof');
  await save(
    `${dir}/breakdown-mechanic-walking-canvas.png`,
    await canvasPng(page),
    testInfo,
    'canvas',
  );
  await save(
    `${dir}/forced-breakdown-maintenance-tab.png`,
    await win.screenshot(),
    testInfo,
    'maintenance-tab',
  );
});

test('a natural breakdown shows reduced reliability and rolling downtime in Maintenance', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const scene = naturalBreakdownScene();
  const savePath = testInfo.outputPath('natural-breakdown.park');
  await mkdir(dirname(savePath), { recursive: true });
  await writeFile(savePath, serialize(scene.sim.world));

  await forceCanvas2D(page);
  await startStarterPark(page);
  const toolbar = page.locator('.game-toolbar');
  await toolbar.getByRole('button', { name: 'Save / Load', exact: true }).click();
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(page.locator('.hud')).toContainText('tick');

  await loadAllSprites(page);
  await centerCameraOn(page, createStarterWorld(), { x: 27, y: 42 }, 2.5);
  await page.waitForTimeout(1_500);
  await toolbar.getByRole('button', { name: 'Rides', exact: true }).click();
  await page
    .locator('[data-panel="ride-list"] .list-row')
    .filter({ hasText: 'Merry-Go-Round' })
    .click();

  const win = page.locator('[data-panel="ride-0"]');
  await win.getByRole('tab', { name: 'Maintenance', exact: true }).click();
  await expect(win).toContainText('Broken down');
  await expect(
    win.locator('.gauge-row').filter({ hasText: 'Reliability' }).locator('.gauge-text'),
  ).not.toHaveText('100%');
  await expect(
    win.locator('.stat-row').filter({ hasText: 'Downtime' }).locator('.stat-value'),
  ).not.toHaveText('0%');

  const dir = PROOF_DIR ?? testInfo.outputPath('proof');
  await save(
    `${dir}/breakdown-maintenance-tab.png`,
    await win.screenshot(),
    testInfo,
    'natural-maintenance-tab',
  );
});

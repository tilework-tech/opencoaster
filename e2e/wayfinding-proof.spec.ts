import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from './support/test';
import type { Page, TestInfo } from './support/test';
import { serialize } from '../src/save/save';
import { MAZE_CENTRE, wayfindingScene } from './support/wayfinding-scene';
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

test('guests lost in a maze cannot find the exit, and a lost guest buys a map', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const scene = wayfindingScene();
  const savePath = testInfo.outputPath('wayfinding.park');
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
  await centerCameraOn(page, createStarterWorld(), MAZE_CENTRE, 2.5);
  await page.waitForTimeout(1_500);

  const dir = PROOF_DIR ?? testInfo.outputPath('proof');
  await save(`${dir}/maze-guests-canvas.png`, await canvasPng(page), testInfo, 'maze');

  await toolbar.getByRole('button', { name: 'Guests', exact: true }).click();
  const guests = page.locator('[data-panel="guests"]');
  const leaver = guests.locator(`.ui-pane.active [data-guest-id="${scene.leaverIds[0]}"]`);
  await expect(leaver).toBeVisible();
  await save(`${dir}/guest-list.png`, await guests.screenshot(), testInfo, 'list');

  await leaver.click();
  const guest = page.locator('[data-panel^="guest-"]');
  await guest.getByRole('tab', { name: 'Recent thoughts' }).click();
  await expect(guest).toContainText("I can't find the exit!");
  await save(`${dir}/guest-thoughts.png`, await guest.screenshot(), testInfo, 'thoughts');

  await centerCameraOn(page, createStarterWorld(), { x: 32, y: 43 }, 2.5);
  await page.waitForTimeout(1_000);
  await save(`${dir}/kiosk-canvas.png`, await canvasPng(page), testInfo, 'kiosk');
});

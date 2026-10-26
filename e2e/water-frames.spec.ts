import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { serialize } from '../src/save/save';
import {
  calibrate,
  centreOnTile,
  expect,
  hoverUntil,
  openPage,
  PHONE_SHIFT,
  point,
  startStarterPark,
  toolbarAction,
} from './support/park';
import { waterWorld } from './support/water-scenes';

/**
 * Frame capture for reviewing the Water tool: imports a staged terrain save, drives the real
 * Water tool on each scene and writes a screenshot per step and per view rotation.
 * Set WATER_FRAMES_DIR to enable; WATER_FRAMES_RENDERER=canvas2d forces the Canvas2D renderer.
 */
const OUT = process.env.WATER_FRAMES_DIR;
const CANVAS2D = process.env.WATER_FRAMES_RENDERER === 'canvas2d';
const only = process.env.WATER_FRAMES_SCENES?.split(',');

async function importWorld(page: Page, bytes: Uint8Array): Promise<void> {
  await toolbarAction(page, 'Game options');
  await page.getByRole('button', { name: 'Save, load and quit…' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import save file' }).click();
  await (await chooser).setFiles({
    name: 'water.ocsave',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(bytes),
  });
  await expect(page.getByText('Imported save file.')).toBeAttached();
  await page.waitForTimeout(1500);
  const closeButtons = page.locator('.ui-window button[aria-label^="Close"]');
  while (await closeButtons.count()) await closeButtons.first().click();
}

for (const profile of ['desktop', 'pixel-8'] as const) {
  test(`water frames ${profile}`, async ({ browser }) => {
    test.skip(!OUT, 'set WATER_FRAMES_DIR to capture frames');
    test.setTimeout(900_000);
    const mobile = profile === 'pixel-8';
    const dir = join(OUT!, `${CANVAS2D ? 'canvas2d' : 'webgl2'}-${profile}`);
    await mkdir(dir, { recursive: true });
    const page = await openPage(browser, mobile);
    if (CANVAS2D)
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
          if (type.includes('webgl')) return null;
          return original.call(this, type as '2d', ...(args as []));
        } as typeof HTMLCanvasElement.prototype.getContext;
      });
    await startStarterPark(page);
    const { world, scenes } = waterWorld();
    await importWorld(page, serialize(world));
    await page.keyboard.press('Shift+Backspace');
    const tap = async (at: [number, number]): Promise<void> => {
      if (mobile) await page.touchscreen.tap(...at);
      else await page.mouse.click(...at);
    };
    const press = async (scope: Locator, name: string): Promise<void> => {
      const control = scope.getByRole('button', { name, exact: true });
      if (mobile) await control.tap();
      else await control.click();
    };
    for (const scene of scenes) {
      if (only && !only.includes(scene.name)) continue;
      const shift = mobile ? PHONE_SHIFT : 0;
      const centre = {
        x: scene.target.x + (scene.size >> 1),
        y: scene.target.y + (scene.size >> 1),
      };
      await centreOnTile(page, centre.x + shift, centre.y + shift);
      await toolbarAction(page, 'Water');
      const win = page.locator('.ui-window[data-panel="water"]');
      await expect(win).toBeVisible();
      const label = win.getByRole('status', { name: 'Tool size' });
      while ((await label.textContent()) !== `${scene.size}×${scene.size}`)
        await press(win, 'Larger tool size');
      const cal = await calibrate(
        page,
        centre,
        mobile,
        page.locator('.area-overlay .area-cursor'),
        world,
      );
      const target = point(cal, centre.x, centre.y);
      const frame = async (name: string): Promise<void> => {
        await hoverUntil(page, target, async () => {
          await expect(page.locator('.area-overlay .area-cursor')).toHaveCount(1, {
            timeout: 1500,
          });
        });
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(dir, `${scene.name}-${name}.png`) });
      };
      await frame('0-before');
      let n = 0;
      let mode: 'raise' | 'lower' = 'raise';
      for (const click of scene.clicks) {
        if (click !== mode) {
          await press(win, click === 'raise' ? 'Raise' : 'Lower');
          mode = click;
        }
        await hoverUntil(page, target, async () => {
          await expect(page.locator('.area-tip:not([hidden])')).toBeVisible({ timeout: 1500 });
        });
        await tap(target);
        n++;
        await page.waitForTimeout(800);
        await frame(`${n}-${click}`);
      }
      await press(win, 'Raise');
      await page.keyboard.press('Escape');
      const rotate = page
        .locator('.game-toolbar')
        .getByRole('button', { name: 'Rotate clockwise', exact: true });
      for (let r = 1; r <= 3; r++) {
        await rotate.click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: join(dir, `${scene.name}-rot${r}.png`) });
      }
      await rotate.click();
      await page.waitForTimeout(500);
      await toolbarAction(page, 'Water');
      await page.keyboard.press('Escape');
      await writeFile(join(dir, `${scene.name}.done`), '');
    }
    await page.context().close();
  });
}

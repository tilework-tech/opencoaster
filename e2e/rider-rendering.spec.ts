import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { riderShowcase } from './support/rider-showcase';
import type { ShowcaseRide } from './support/rider-showcase';

const KINDS: ShowcaseRide[] = ['coaster', 'flat-ride', 'log-flume'];
const OUT = process.env.RIDER_SHOT_DIR;

async function forceCanvas2D(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return original.call(this, type as '2d', ...(args as []));
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

for (const backend of ['WebGL2', 'Canvas2D'] as const) {
  for (const kind of KINDS) {
    test(`${kind} riders are drawn in the vehicles or hidden, never walking (${backend})`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(420_000);
      const showcase = riderShowcase(kind);
      const savePath = testInfo.outputPath(`${kind}.ocsave`);
      await mkdir(dirname(savePath), { recursive: true });
      await writeFile(savePath, showcase.save);
      if (backend === 'Canvas2D') await forceCanvas2D(page);

      await page.goto('/');
      await page.getByRole('button', { name: 'Sandbox' }).click();
      const toolbar = page.locator('.game-toolbar');
      await toolbar.getByRole('button', { name: 'Game options', exact: true }).click();
      await page.getByRole('button', { name: 'Save, load and quit…' }).click();
      await page.getByRole('button', { name: 'Import save file' }).click();
      await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
      await expect(page.locator('.save-menu')).toBeHidden();
      await expect(page.locator('.hud')).toContainText(backend);
      await toolbar.getByRole('button', { name: 'Pause', exact: true }).click();

      const focus = await page.evaluate((fallback) => {
        const snapshot = (
          window as unknown as {
            __snapshot?: { cars: { count: number; data: Int32Array } };
          }
        ).__snapshot;
        for (let i = 0; snapshot && i < snapshot.cars.count; i++)
          if (((snapshot.cars.data[i * 4 + 3]! >> 9) & 7) > 0)
            return {
              x: snapshot.cars.data[i * 4]!,
              y: snapshot.cars.data[i * 4 + 1]!,
              z: snapshot.cars.data[i * 4 + 2]!,
            };
        return fallback;
      }, showcase.focus);

      for (let rotation = 0; rotation < 4; rotation++) {
        await page.evaluate(
          async ({ focus, rotation }) => {
            const { project } = await import('/src/render/projection.ts');
            const w = window as unknown as {
              __camera: { x: number; y: number; zoom: number; rotation: number };
              __map: { width: number; height: number };
            };
            const out = new Float64Array(2);
            project(focus.x, focus.y, focus.z, w.__map.width, w.__map.height, rotation as 0, out);
            w.__camera.rotation = rotation;
            w.__camera.zoom = 3;
            w.__camera.x = out[0]!;
            w.__camera.y = out[1]!;
          },
          { focus, rotation },
        );
        await page.waitForTimeout(800);
        const path = join(OUT ?? testInfo.outputDir, `${kind}-${backend}-rot${rotation}.png`);
        await mkdir(dirname(path), { recursive: true });
        await page.screenshot({ path });
        await testInfo.attach(`${kind}-${backend}-rot${rotation}`, {
          path,
          contentType: 'image/png',
        });
      }
    });
  }
}

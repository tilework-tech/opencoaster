import { expect, test, type Browser, type Page } from '@playwright/test';
import { openPage, startScenario, toolbarAction } from './support/park';

async function visibleSceneryPoint(page: Page): Promise<{ name: string; x: number; y: number }> {
  return page.locator('#game').evaluate(async (canvas) => {
    const [{ SCENERY_CATALOG }, { project }, { sceneryBox, sceneryGroundZ }, { TILE_UNITS }] =
      await Promise.all([
        import('/src/sim/map/scenery.ts'),
        import('/src/render/projection.ts'),
        import('/src/render/ground-anchor.ts'),
        import('/src/sim/core/constants.ts'),
      ]);
    const state = window as unknown as {
      __camera: { x: number; y: number; zoom: number; rotation: 0 | 1 | 2 | 3 };
      __map: {
        width: number;
        height: number;
        heights: Uint8Array;
        slope: Uint8Array;
        sceneryElements: Int32Array;
        sceneryCount: number;
      };
    };
    const rect = canvas.getBoundingClientRect();
    const { __camera: camera, __map: map } = state;
    const out = new Float64Array(2);
    for (let i = 0; i < map.sceneryCount; i++) {
      const offset = i * 5;
      const tileX = map.sceneryElements[offset]!;
      const tileY = map.sceneryElements[offset + 1]!;
      const definition = SCENERY_CATALOG[map.sceneryElements[offset + 4]!];
      if (!definition) continue;
      const tile = tileY * map.width + tileX;
      const z = sceneryGroundZ(map.heights[tile]!, map.slope[tile]!, camera.rotation);
      project(
        tileX * TILE_UNITS + TILE_UNITS / 2,
        tileY * TILE_UNITS + TILE_UNITS / 2,
        z,
        map.width,
        map.height,
        camera.rotation,
        out,
      );
      const screenX = rect.width / 2 + (out[0]! - camera.x) * camera.zoom;
      const screenY = rect.height / 2 + (out[1]! - camera.y) * camera.zoom;
      const box = sceneryBox(definition);
      const point = {
        x: rect.left + screenX,
        y: rect.top + screenY - box.height * camera.zoom * 0.55,
      };
      if (
        point.x > rect.left + 12 &&
        point.x < rect.right - 12 &&
        point.y > rect.top + 12 &&
        point.y < rect.bottom - 80
      )
        return { name: definition.name, ...point };
    }
    throw new Error('The scenario has no scenery sprite in the visible game area');
  });
}

async function openInspectionPage(browser: Browser, mobile: boolean): Promise<Page> {
  const page = await openPage(browser, mobile);
  if (!mobile) await page.setViewportSize({ width: 1280, height: 800 });
  return page;
}

for (const mobile of [false, true]) {
  test(`inspect scenery by ${mobile ? 'tapping on Pixel 8' : 'clicking on desktop'}`, async ({
    browser,
  }) => {
    const page = await openInspectionPage(browser, mobile);
    try {
      await startScenario(page, 'Meadowbrook Green');
      await toolbarAction(page, 'Pause');
      const scenery = await visibleSceneryPoint(page);

      if (mobile) {
        await page.locator('#game').evaluate(async (canvas, point) => {
          Object.defineProperty(canvas, 'setPointerCapture', { value: () => {} });
          const send = (type: string, buttons: number) =>
            canvas.dispatchEvent(
              new PointerEvent(type, {
                pointerId: 2,
                pointerType: 'touch',
                isPrimary: true,
                bubbles: true,
                clientX: point.x,
                clientY: point.y,
                buttons,
              }),
            );
          send('pointerdown', 1);
          await new Promise((resolve) => setTimeout(resolve, 950));
          send('pointerup', 0);
        }, scenery);
      } else {
        await page.mouse.move(scenery.x, scenery.y);
        await expect(page.locator('.tool-status')).toContainText(scenery.name);
        await page.mouse.click(scenery.x, scenery.y);
      }
      const popup = page.locator('[data-object-info]');
      await expect(popup).toBeVisible();
      await expect(popup).toContainText(scenery.name);
      if (mobile) await expect(page.locator('.tool-status')).toContainText(scenery.name);
      await expect(popup.getByRole('button', { name: 'Remove' })).toBeVisible();
    } finally {
      await page.context().close();
    }
  });
}

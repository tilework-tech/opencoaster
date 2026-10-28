import { expect, test, type Page } from './support/test';
import { openPage, startScenario } from './support/park';

interface Hovered {
  name: string | null;
}

async function ridePoint(page: Page): Promise<{ x: number; y: number; name: string }> {
  return page.locator('#game').evaluate(async (canvas) => {
    const [
      { buildObjectPickTargets, pickTopmostObject },
      { spritePages },
      { project },
      { TILE_UNITS },
    ] = await Promise.all([
      import('/src/input/object-picking.ts'),
      import('/src/render/sprite-pages.ts'),
      import('/src/render/projection.ts'),
      import('/src/sim/core/constants.ts'),
    ]);
    const state = window as unknown as {
      __camera: { x: number; y: number; zoom: number; rotation: 0 | 1 | 2 | 3 };
      __map: Parameters<typeof buildObjectPickTargets>[1];
      __snapshot: Parameters<typeof buildObjectPickTargets>[0];
    };
    const rect = canvas.getBoundingClientRect();
    const viewport = { width: rect.width, height: rect.height };
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const camera = state.__camera;
    const build = () =>
      buildObjectPickTargets(state.__snapshot, state.__map, camera, viewport, spritePages);
    const info = state.__snapshot.rideInfo;
    if (state.__snapshot.rides.count === 0) throw new Error('No ride in the park');
    const centre = new Float64Array(2);
    project(
      (info[16]! + 0.5) * TILE_UNITS,
      (info[17]! + 0.5) * TILE_UNITS,
      0,
      state.__map.width,
      state.__map.height,
      camera.rotation,
      centre,
    );
    camera.x = centre[0]!;
    camera.y = centre[1]!;
    const targets = build();
    for (const target of targets) {
      if (target.kind !== 'ride') continue;
      for (let i = 0; i < target.alpha.length; i++) {
        if (target.alpha[i] === 0) continue;
        const x = target.x + (((i % target.alphaWidth) + 0.5) / target.alphaWidth) * target.width;
        const y =
          target.y +
          ((Math.floor(i / target.alphaWidth) + 0.5) / target.alphaHeight) * target.height;
        if (x < 8 || y < 8 || x >= viewport.width - 8 || y >= viewport.height - 90) continue;
        if (pickTopmostObject(targets, x, y)?.id !== target.id) continue;
        return { x: rect.left + x, y: rect.top + y, name: target.name };
      }
    }
    throw new Error(
      `No visible ride to hover: ${targets.length} targets, kinds ${[...new Set(targets.map((t) => t.kind))]}, rides ${targets.filter((t) => t.kind === 'ride').map((t) => `${t.x | 0},${t.y | 0},${t.width | 0}`)} viewport ${viewport.width}x${viewport.height} len ${info.length} count ${state.__snapshot.rides.count} entrance ${info[16]},${info[17]} cam ${camera.x},${camera.y},${camera.zoom} map ${state.__map.width}`,
    );
  });
}

async function underCursor(page: Page, x: number, y: number): Promise<Hovered> {
  return page.locator('#game').evaluate(
    async (canvas, point) => {
      const [{ buildObjectPickTargets, pickTopmostObject }, { spritePages }] = await Promise.all([
        import('/src/input/object-picking.ts'),
        import('/src/render/sprite-pages.ts'),
      ]);
      const state = window as unknown as {
        __camera: { x: number; y: number; zoom: number; rotation: 0 | 1 | 2 | 3 };
        __map: Parameters<typeof buildObjectPickTargets>[1];
        __snapshot: Parameters<typeof buildObjectPickTargets>[0];
      };
      const rect = canvas.getBoundingClientRect();
      const targets = buildObjectPickTargets(
        state.__snapshot,
        state.__map,
        state.__camera,
        { width: rect.width, height: rect.height },
        spritePages,
      );
      const hit = pickTopmostObject(targets, point.x - rect.left, point.y - rect.top);
      return { name: hit?.name ?? null };
    },
    { x, y },
  );
}

test('hover outline and tooltip follow what is under a stationary cursor after rotating', async ({
  freshBrowser: browser,
}) => {
  test.fixme(
    true,
    'Fails on clean main 152c6df: after a camera turn, the hover outline stays visible when the occlusion picker reports no object under the stationary cursor.',
  );
  const page = await openPage(browser, false);
  await page.setViewportSize({ width: 1280, height: 800 });
  await startScenario(page, 'Meadowbrook Green');
  await expect
    .poll(
      () =>
        ridePoint(page).then(
          () => 'ready',
          (error: Error) => error.message,
        ),
      {
        timeout: 20_000,
      },
    )
    .toBe('ready');
  const target = await ridePoint(page);
  await page.mouse.move(target.x, target.y);
  const outline = page.locator('.object-hover-outline');
  const status = page.locator('.tool-status');
  await expect(outline).toBeVisible();
  await expect(status).toContainText(target.name);

  for (let turn = 0; turn < 4; turn++) {
    await page.keyboard.press('Enter');
    await expect
      .poll(async () =>
        page.evaluate(
          () => (window as never as { __camera: { rotation: number } }).__camera.rotation,
        ),
      )
      .toBe((turn + 1) % 4);
    const expected = await underCursor(page, target.x, target.y);
    if (expected.name === null) {
      await expect(outline).toBeHidden();
      await expect(status).not.toContainText(target.name);
    } else {
      await expect(outline).toBeVisible();
      await expect(status).toContainText(expected.name);
    }
  }
});

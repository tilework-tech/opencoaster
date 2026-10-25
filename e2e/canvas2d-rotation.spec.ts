import { expect, test } from '@playwright/test';

test('Canvas2D survives two full view rotations and zoom changes without frame stalls', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return originalGetContext.call(this, type as '2d', ...(args as []));
    } as typeof HTMLCanvasElement.prototype.getContext;
    const gaps: number[] = [];
    let previous = 0;
    const observe = (time: number) => {
      if (previous) gaps.push(time - previous);
      previous = time;
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
    Object.defineProperty(window, '__frameGaps', { value: gaps });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  const hud = page.locator('.hud');
  const toolbar = page.locator('.game-toolbar');
  const rotate = toolbar.getByRole('button', { name: 'Rotate view', exact: true });
  await expect(hud).toContainText('Canvas2D');
  for (let turn = 0; turn < 8; turn++) {
    const before = await hud.innerText();
    const tick = Number(before.match(/tick (\d+)/)?.[1]);
    await page.evaluate(
      () => ((window as unknown as { __frameGaps: number[] }).__frameGaps.length = 0),
    );
    await rotate.click({ timeout: 5000 });
    await expect
      .poll(
        async () => {
          const text = await hud.innerText();
          const currentTick = Number(text.match(/tick (\d+)/)?.[1]);
          return currentTick > tick && text.includes(`rot ${(turn + 1) % 4}`);
        },
        { timeout: 5000 },
      )
      .toBe(true);
    const rotationGap = await page.evaluate(() =>
      Math.max(...(window as unknown as { __frameGaps: number[] }).__frameGaps),
    );
    expect(rotationGap, `view rotation ${turn + 1} stalled a frame`).toBeLessThan(750);
    if (turn === 3) {
      const beforeZoom = await page.evaluate(
        () => (window as unknown as { __camera: { zoom: number } }).__camera.zoom,
      );
      await toolbar.getByRole('button', { name: 'Zoom out', exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { __camera: { zoom: number } }).__camera.zoom),
        )
        .toBeLessThan(beforeZoom);
    }
    if (turn === 4) {
      const beforeZoom = await page.evaluate(
        () => (window as unknown as { __camera: { zoom: number } }).__camera.zoom,
      );
      await toolbar.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { __camera: { zoom: number } }).__camera.zoom),
        )
        .toBeGreaterThan(beforeZoom);
    }
  }
});

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { openPage, toolbarAction } from './support/park';
import { inspectionShowcase } from './support/inspection-showcase';

type Part = 'track' | 'station' | 'train' | 'entrance' | 'exit' | 'bench' | 'bin';

async function forceCanvas2D(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return original.call(this, type as '2d', ...(args as []));
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

async function loadShowcase(page: Page, testInfo: TestInfo): Promise<void> {
  const savePath = testInfo.outputPath('inspection.ocsave');
  await mkdir(dirname(savePath), { recursive: true });
  await writeFile(savePath, inspectionShowcase());
  await page.goto('/');
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await toolbarAction(page, 'Game options');
  await page.getByRole('button', { name: 'Save, load and quit…' }).click();
  await page.getByRole('button', { name: 'Import save file' }).click();
  await page.locator('.save-menu input[type="file"]').setInputFiles(savePath);
  await expect(page.locator('.save-menu')).toBeHidden();
  const close = page.locator('.ui-window button[aria-label^="Close"]');
  while (await close.count()) await close.first().click();
}

/** Centres the camera on a part of the showcase and returns a viewport point on its visible pixels. */
async function pointOnPart(
  page: Page,
  part: Part,
): Promise<{ x: number; y: number; name: string }> {
  const find = () =>
    page.locator('#game').evaluate(async (canvas, part) => {
      const [{ buildObjectPickTargets, pickTopmostObject }, { spritePages }] = await Promise.all([
        import('/src/input/object-picking.ts'),
        import('/src/render/sprite-pages.ts'),
      ]);
      const state = window as unknown as {
        __camera: { x: number; y: number; zoom: number; rotation: 0 | 1 | 2 | 3 };
        __map: Parameters<typeof buildObjectPickTargets>[1];
        __snapshot: Parameters<typeof buildObjectPickTargets>[0];
      };
      const { __camera: camera, __map: map, __snapshot: snapshot } = state;
      if (!snapshot) return null;
      const rect = canvas.getBoundingClientRect();
      const viewport = { width: rect.width, height: rect.height };
      const wanted = (t: ReturnType<typeof buildObjectPickTargets>[number]): boolean => {
        const sprite = t.sprite ?? '';
        if (part === 'bench' || part === 'bin')
          return t.kind === 'path-addition' && t.name.toLowerCase().startsWith(part);
        if (t.kind !== 'ride') return false;
        if (part === 'entrance' || part === 'exit') return sprite.includes(`/stations/${part}/`);
        if (part === 'train') return sprite.includes('/vehicles/');
        if (part === 'station') return sprite.includes('/track/station/');
        return sprite.includes('/track/') && !sprite.includes('/track/station/');
      };
      const visiblePixel = (
        targets: ReturnType<typeof buildObjectPickTargets>,
        target: (typeof targets)[number],
      ) => {
        for (let i = 0; i < target.alpha.length; i++) {
          if (target.alpha[i] === 0) continue;
          const x = target.x + (((i % target.alphaWidth) + 0.5) / target.alphaWidth) * target.width;
          const y =
            target.y +
            ((Math.floor(i / target.alphaWidth) + 0.5) / target.alphaHeight) * target.height;
          if (x < 4 || y < 4 || x >= viewport.width - 4 || y >= viewport.height - 100) continue;
          if (pickTopmostObject(targets, x, y)?.id !== target.id) continue;
          return { x: rect.left + x, y: rect.top + y, name: target.name };
        }
        return null;
      };
      camera.zoom = 2;
      let targets = buildObjectPickTargets(snapshot, map, camera, viewport, spritePages);
      const first = targets.find(wanted);
      if (!first) return null;
      camera.x += (first.x + first.width / 2 - viewport.width / 2) / camera.zoom;
      camera.y += (first.y + first.height / 2 - viewport.height / 2 - 40) / camera.zoom;
      targets = buildObjectPickTargets(snapshot, map, camera, viewport, spritePages);
      for (const target of targets.filter(wanted)) {
        const point = visiblePixel(targets, target);
        if (point) return point;
      }
      return null;
    }, part);
  const point = await expect
    .poll(find, { timeout: 30_000 })
    .not.toBeNull()
    .then(find)
    .catch(async (error) => {
      const keys = await page.locator('#game').evaluate(async () => {
        const [{ buildObjectPickTargets }, { spritePages }] = await Promise.all([
          import('/src/input/object-picking.ts'),
          import('/src/render/sprite-pages.ts'),
        ]);
        const w = window as unknown as {
          __camera: Parameters<typeof buildObjectPickTargets>[2];
          __map: Parameters<typeof buildObjectPickTargets>[1];
          __snapshot: Parameters<typeof buildObjectPickTargets>[0];
        };
        return buildObjectPickTargets(
          w.__snapshot,
          w.__map,
          w.__camera,
          { width: 1280, height: 800 },
          spritePages,
        ).map((t) => `${t.kind}:${t.name}:${t.sprite}`);
      });
      throw new Error(`No visible ${part} sprite. Targets: ${[...new Set(keys)].join(' | ')}`, {
        cause: error,
      });
    });
  if (!point) throw new Error(`No visible ${part} sprite`);
  return point;
}

async function touch(page: Page, point: { x: number; y: number }, holdMs: number): Promise<void> {
  await page.locator('#game').evaluate(
    async (canvas, { point, holdMs }) => {
      if (!Object.hasOwn(canvas, 'setPointerCapture'))
        Object.defineProperty(canvas, 'setPointerCapture', { value: () => {} });
      const send = (type: string, buttons: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 9,
            pointerType: 'touch',
            isPrimary: true,
            bubbles: true,
            clientX: point.x,
            clientY: point.y,
            buttons,
          }),
        );
      send('pointerdown', 1);
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      send('pointerup', 0);
    },
    { point, holdMs },
  );
}

/** Inspects a part: hover then click on desktop, long-press on Pixel 8. */
async function inspect(
  page: Page,
  mobile: boolean,
  part: Part,
  testInfo: TestInfo,
): Promise<{ name: string; x: number; y: number }> {
  const point = await pointOnPart(page, part);
  if (mobile) {
    await page.mouse.move(point.x, point.y);
    await expect(page.locator('.object-hover-outline')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${part}-hover.png`), timeout: 60_000 });
    await touch(page, point, 950);
  } else {
    await page.mouse.move(point.x, point.y);
    await expect(page.locator('.tool-status')).toContainText(point.name);
    await expect(page.locator('.object-hover-outline')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${part}-hover.png`), timeout: 60_000 });
    await page.mouse.click(point.x, point.y);
  }
  return point;
}

async function closeRideWindows(page: Page): Promise<void> {
  const close = page.locator('.ui-window button[aria-label^="Close"]');
  while (await close.count()) await close.first().click();
}

async function inspectParts(
  browser: Parameters<Parameters<typeof test>[2]>[0]['browser'],
  mobile: boolean,
  backend: 'WebGL2' | 'Canvas2D',
  testInfo: TestInfo,
): Promise<void> {
  test.setTimeout(420_000);
  const page = await openPage(browser, mobile);
  try {
    if (!mobile) await page.setViewportSize({ width: 1280, height: 800 });
    if (backend === 'Canvas2D') await forceCanvas2D(page);
    await loadShowcase(page, testInfo);
    await expect(page.locator('.hud')).toContainText(backend);
    await toolbarAction(page, 'Pause');

    for (const part of ['track', 'station', 'train', 'entrance', 'exit'] as const) {
      const hit = await inspect(page, mobile, part, testInfo);
      await expect(page.locator('[data-panel^="ride-"]:visible')).toHaveCount(1);
      await expect(page.locator('.tool-status')).toContainText(`${hit.name} information opened.`);
      await closeRideWindows(page);
    }

    const bin = await inspect(page, mobile, 'bin', testInfo);
    const popup = page.locator('[data-object-info]');
    await expect(popup).toContainText(bin.name);
    await expect(popup.getByRole('button', { name: 'Remove' })).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Repair' })).toHaveCount(0);
    await popup.getByRole('button', { name: 'Done' }).click();

    await inspect(page, mobile, 'bench', testInfo);
    await expect(popup).toContainText('Bench (vandalised)');
    const box = await popup.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: testInfo.outputPath('bench-popup.png'), timeout: 60_000 });
    await popup.getByRole('button', { name: 'Repair' }).click();
    await expect(popup).toBeHidden();
    await toolbarAction(page, 'Resume');
    await toolbarAction(page, 'Pause');
    await inspect(page, mobile, 'bench', testInfo);
    await expect(popup).toContainText('Bench');
    await expect(popup).not.toContainText('vandalised');
    await expect(popup.getByRole('button', { name: 'Repair' })).toHaveCount(0);
  } finally {
    await page.context().close();
  }
}

for (const backend of ['WebGL2', 'Canvas2D'] as const) {
  for (const mobile of [false, true]) {
    test(`coaster parts, ride entrance and exit, and path additions in ${backend} on ${mobile ? 'Pixel 8' : 'desktop'}`, async ({
      browser,
    }, testInfo) => inspectParts(browser, mobile, backend, testInfo));
  }
}

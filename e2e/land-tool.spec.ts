import { test } from './support/test';
import type { Locator, Page } from './support/test';
import {
  calibrate,
  centreOnTile,
  expect,
  hoverUntil,
  hudCash,
  openPage,
  PHONE_SHIFT,
  point,
  savedWorld,
  startStarterPark,
  starterWorld,
  toolbarAction,
} from './support/park';
import type { Calibration } from './support/park';
import type { World } from '../src/sim/core/world';

/** Owned grass at level 2 with flat tiles around it: x 27..29, y 41..43 of Starter Park. */
const FLAT = { x: 28, y: 42 };
/** Open ground away from the footpath, for edits that spread several tiles. */
const FAR = { x: 34, y: 43 };
const BORDER = { x: 30, y: 48 };

interface Setup {
  page: Page;
  mobile: boolean;
}

function selected(page: Page): Locator {
  return page.locator('.land-overlay .land-sel');
}

async function openLandTool(page: Page, mobile: boolean): Promise<Calibration> {
  const shift = mobile ? PHONE_SHIFT : 0;
  await centreOnTile(page, FLAT.x + shift, FLAT.y + shift);
  await toolbarAction(page, 'Land');
  await expect(page.getByRole('button', { name: 'Flatten', exact: true })).toBeVisible();
  return calibrate(page, FLAT, mobile, selected(page));
}

interface Preview {
  /** Vertex index -> height change the overlay announces. */
  vertices: Map<number, number>;
  ghostTiles: number[];
  selectedTiles: number[];
  corners: number;
  tip: string;
}

async function readPreview(page: Page): Promise<Preview> {
  const raw = await page.evaluate(() => {
    const q = (sel: string) => [...document.querySelectorAll<SVGElement>(`.land-overlay ${sel}`)];
    return {
      vertices: q('.land-stem').map((n) => [Number(n.dataset.vertex), Number(n.dataset.delta)]),
      ghostTiles: q('.land-ghost').map((n) => Number(n.dataset.tile)),
      selectedTiles: q('.land-sel').map((n) => Number(n.dataset.tile)),
      corners: q('.land-corner:not(.land-edge)').length,
      tip: document.querySelector('.land-tip')?.textContent ?? '',
    };
  });
  return { ...raw, vertices: new Map(raw.vertices as Array<[number, number]>) };
}

function tip(page: Page): Locator {
  return page.locator('.land-tip');
}

async function touchDrag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
    });
  await send('touchStart', ...from);
  const steps = 12;
  for (let i = 1; i <= steps; i++)
    await send(
      'touchMove',
      from[0] + ((to[0] - from[0]) * i) / steps,
      from[1] + ((to[1] - from[1]) * i) / steps,
    );
  await send('touchEnd', ...to);
  await cdp.detach();
}

for (const profile of ['desktop', 'pixel-8'] as const) {
  const mobile = profile === 'pixel-8';
  test.describe(`land tool on ${profile}`, () => {
    let setup: Setup;
    let cal: Calibration;

    test.beforeEach(async ({ freshBrowser: browser }) => {
      test.setTimeout(240_000);
      setup = { page: await openPage(browser, mobile), mobile };
      await startStarterPark(setup.page);
      cal = await openLandTool(setup.page, mobile);
    });

    test.afterEach(async () => {
      const testInfo = test.info();
      if (testInfo.status !== testInfo.expectedStatus)
        await setup.page.screenshot({ path: testInfo.outputPath('failure.png') });
      await setup.page.context().close();
    });

    test('hover previews exactly the corner, edge or tile that will change, with its price', async () => {
      const { page } = setup;
      const at = (fx: number, fy: number): [number, number] => point(cal, FLAT.x, FLAT.y, fx, fy);
      await hoverUntil(page, at(0.08, 0.08), async () => {
        await expect(page.locator('.land-overlay .land-corner')).toHaveCount(1, { timeout: 1500 });
        const preview = await readPreview(page);
        expect(preview.vertices.size).toBe(1);
        expect(preview.tip).toBe('Raise land: $5.00');
        expect(preview.ghostTiles.length).toBeGreaterThanOrEqual(1);
      });
      await hoverUntil(page, at(0.5, 0.1), async () => {
        await expect(page.locator('.land-overlay .land-edge')).toHaveCount(1, { timeout: 1500 });
        const preview = await readPreview(page);
        expect(preview.vertices.size).toBeGreaterThanOrEqual(2);
        expect(preview.tip).toBe(`Raise land: $${5 * preview.vertices.size}.00`);
      });
      await hoverUntil(page, at(0.5, 0.5), async () => {
        await expect(page.locator('.land-overlay .land-corner')).toHaveCount(0, { timeout: 1500 });
        const preview = await readPreview(page);
        expect(preview.selectedTiles).toHaveLength(1);
        expect(preview.vertices.size).toBeGreaterThanOrEqual(4);
        expect(preview.tip).toBe(`Raise land: $${5 * preview.vertices.size}.00`);
      });
      await page.getByRole('button', { name: 'Larger tool size' }).click();
      await page.getByRole('button', { name: 'Larger tool size' }).click();
      await expect(page.getByText('3×3', { exact: true })).toBeVisible();
      await hoverUntil(page, point(cal, FAR.x, FAR.y), async () => {
        await expect(selected(page)).toHaveCount(9, { timeout: 1500 });
        const preview = await readPreview(page);
        expect(preview.vertices.size).toBeGreaterThanOrEqual(16);
        expect(preview.ghostTiles.length).toBeGreaterThanOrEqual(9);
        expect(preview.tip).toBe(`Raise land: $${5 * preview.vertices.size}.00`);
      });
    });

    test('turning corner picking off selects whole tiles near a corner', async () => {
      const { page } = setup;
      const [x, y] = point(cal, FLAT.x, FLAT.y, 0.08, 0.08);
      await hoverUntil(page, [x, y], () =>
        expect(page.locator('.land-overlay .land-corner')).toHaveCount(1, { timeout: 1500 }),
      );
      await page.getByRole('checkbox', { name: 'Pick corners and edges' }).uncheck();
      await hoverUntil(page, [x + 1, y], () =>
        expect(page.locator('.land-overlay .land-corner')).toHaveCount(0, { timeout: 1500 }),
      );
      await expect
        .poll(async () => (await readPreview(page)).vertices.size)
        .toBeGreaterThanOrEqual(4);
    });

    test('lower and smooth show their effect or why there is none', async () => {
      const { page } = setup;
      const [x, y] = point(cal, FLAT.x, FLAT.y);
      await page.getByRole('button', { name: 'Lower', exact: true }).click();
      await hoverUntil(page, [x, y], async () => {
        await expect(tip(page)).toHaveText(/^Lower land: \$/, { timeout: 1500 });
        const lowering = await readPreview(page);
        expect(lowering.vertices.size).toBeGreaterThan(0);
        expect([...lowering.vertices.values()].every((d) => d < 0)).toBe(true);
      });
      await page.getByRole('button', { name: 'Smooth', exact: true }).click();
      await hoverUntil(page, [x + 1, y], () =>
        expect(tip(page)).toHaveText('Nothing to change here.', { timeout: 1500 }),
      );
      const before = await hudCash(page);
      if (mobile) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await expect(tip(page)).toHaveText('Nothing to change here.');
      await expect(page.locator('.tool-status')).toContainText('Smoothing land at');
      expect(await hudCash(page)).toBeGreaterThanOrEqual(before);
    });

    test('a tap does exactly what the preview showed', async () => {
      const { page } = setup;
      const [x, y] = point(cal, FLAT.x, FLAT.y, 0.92, 0.92);
      let preview!: Preview;
      await hoverUntil(page, [x, y], async () => {
        await expect(tip(page)).toHaveText(/^Raise land: \$/, { timeout: 1500 });
        preview = await readPreview(page);
        expect(preview.vertices.size).toBeGreaterThan(0);
      });
      const before = await hudCash(page);
      if (mobile) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await expect
        .poll(() => hudCash(page))
        .toBe(before - 500 * [...preview.vertices.values()].reduce((a, d) => a + Math.abs(d), 0));
      const world = await savedWorld(page);
      const reference = starterWorld();
      for (const [vertex, delta] of preview.vertices)
        expect(world.map.vertexHeights[vertex]).toBe(reference.map.vertexHeights[vertex] + delta);
      const changed = world.map.vertexHeights.filter(
        (h, v) => h !== reference.map.vertexHeights[v],
      );
      expect(changed.length).toBe(preview.vertices.size);
    });

    test('dragging up raises the land repeatedly and dragging down lowers it again', async () => {
      const { page } = setup;
      const [x, y] = point(cal, FAR.x, FAR.y);
      const step = 16 * (cal.tileWidth / 64);
      const before = await hudCash(page);
      if (mobile) await touchDrag(page, [x, y], [x, y - step * 3.5]);
      else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y - step * 3.5, { steps: 14 });
        await page.mouse.up();
      }
      await expect.poll(() => hudCash(page)).toBeLessThanOrEqual(before - 3 * 2000);
      const raised = await savedWorld(page);
      expect(raised.map.heights[raised.map.index(FAR.x, FAR.y)]).toBe(5);
      const total = (w: World) => w.map.vertexHeights.reduce((sum, h) => sum + h, 0);
      await toolbarAction(page, 'Land');
      await expect(page.getByRole('button', { name: 'Flatten', exact: true })).toBeVisible();
      if (mobile) await touchDrag(page, [x, y - step * 3], [x, y + step * 0.5]);
      else {
        await page.mouse.move(x, y - step * 3);
        await page.mouse.down();
        await page.mouse.move(x, y + step * 0.5, { steps: 14 });
        await page.mouse.up();
      }
      await expect.poll(async () => total(await savedWorld(page))).toBeLessThan(total(raised));
    });

    test('flatten previews its levelling and then levels the area to the first tile', async () => {
      const { page } = setup;
      const [bx, by] = point(cal, FAR.x, FAR.y);
      const step = 16 * (cal.tileWidth / 64);
      const totalHeight = (w: World) => w.map.vertexHeights.reduce((sum, h) => sum + h, 0);
      const beforeHeight = totalHeight(await savedWorld(page));
      if (mobile) await touchDrag(page, [bx, by], [bx, by - step * 3.5]);
      else {
        await page.mouse.move(bx, by);
        await page.mouse.down();
        await page.mouse.move(bx, by - step * 3.5, { steps: 10 });
        await page.mouse.up();
      }
      await expect(page.locator('.tool-status')).toContainText('Raising land at');
      await expect
        .poll(async () => totalHeight(await savedWorld(page)))
        .toBeGreaterThan(beforeHeight);
      await page.getByRole('button', { name: 'Flatten', exact: true }).click();
      await page.getByRole('button', { name: 'Larger tool size' }).click();
      await page.getByRole('button', { name: 'Larger tool size' }).click();
      const [x, y] = point(cal, FAR.x - 1, FAR.y - 1);
      let preview!: Preview;
      await hoverUntil(page, [x, y - 2 * step], async () => {
        await expect(tip(page)).toContainText('Flatten land: $', { timeout: 1500 });
        preview = await readPreview(page);
        expect(preview.vertices.size).toBeGreaterThan(0);
        expect(preview.selectedTiles).toHaveLength(9);
        expect(preview.ghostTiles.length).toBeGreaterThanOrEqual(9);
      });
      if (mobile) await page.touchscreen.tap(x, y - 2 * step);
      else await page.mouse.click(x, y - 2 * step);
      await expect
        .poll(async () => {
          const map = (await savedWorld(page)).map;
          const levels = preview.selectedTiles.map(
            (tile) => `${map.heights[tile]}${map.slope[tile] === 0 ? '' : '/'}`,
          );
          return new Set(levels).size === 1 && !levels[0].endsWith('/') ? 'flat' : levels.join(' ');
        })
        .toBe('flat');
    });

    test('land outside the park is refused with a reason and nothing changes', async () => {
      const { page } = setup;
      await page.getByRole('button', { name: 'Flatten', exact: true }).click();
      const [x, y] = point(cal, BORDER.x, BORDER.y);
      await hoverUntil(page, [x, y], () =>
        expect(tip(page)).toHaveText('Land not owned by park!', { timeout: 1500 }),
      );
      const before = await hudCash(page);
      if (mobile) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await expect(tip(page)).toHaveText('Land not owned by park!');
      expect(await hudCash(page)).toBeGreaterThanOrEqual(before);
    });

    test('a finger shows the preview while pressed', async () => {
      test.skip(!mobile, 'touch only');
      const { page } = setup;
      const [x, y] = point(cal, FLAT.x, FLAT.y);
      const cdp = await page.context().newCDPSession(page);
      const touch = (type: string, px: number, py: number) =>
        cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: type === 'touchEnd' ? [] : [{ x: px, y: py, id: 1, force: 1 }],
        });
      await page.mouse.move(5, 300);
      await touch('touchStart', x, y);
      await expect(tip(page)).toHaveText(/^Raise land: \$/);
      await touch('touchMove', x + 30, y);
      await touch('touchEnd', x + 30, y);
      await cdp.detach();
    });
  });
}

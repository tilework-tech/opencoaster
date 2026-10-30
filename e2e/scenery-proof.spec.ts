import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { devices, expect, test } from './support/test';
import type { Page } from './support/test';
import {
  SCENERY_CATALOG,
  SCENERY_GROUPS,
  SceneryItem,
  isWallScenery,
} from '../src/sim/map/scenery';

/**
 * Visual proof for the scenery expansion, run with `pnpm e2e:art-review`: every new decoration
 * photographed in the running game at all four camera rotations in both renderers, its placement
 * ghost, the menu on desktop and phone, and a small decorated park. Output goes to
 * `$SCENERY_PROOF_DIR` (default `.local/scenery-proof`).
 */
const OUT = resolve(process.env.SCENERY_PROOF_DIR ?? '.local/scenery-proof');
const FIRST_NEW = SceneryItem.SunflowerPatch;
const NEW_ITEMS = SCENERY_CATALOG.map((_, index) => index).filter((index) => index >= FIRST_NEW);

type Renderer = 'webgl2' | 'canvas2d';

interface Tile {
  x: number;
  y: number;
}

declare global {
  interface Window {
    __sim: { command(command: unknown): void };
    __map: {
      width: number;
      height: number;
      heights: Uint8Array;
      slope: Uint8Array;
      waterLevel: Uint8Array;
      ownership: Uint8Array;
      sceneryCount: number;
      sceneryElements: Int32Array;
    };
    __camera: { x: number; y: number; zoom: number; rotation: number };
  }
}

async function useCanvas2d(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return original.call(this, type as '2d', ...(args as []));
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

async function startStarterPark(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await page
    .locator('.scenario-card')
    .filter({ hasText: 'Starter Park' })
    .getByRole('button', { name: 'Start', exact: true })
    .click();
  await expect(page.locator('.game-toolbar')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__camera.x)).not.toBe(0);
}

/** A flat, dry, owned block of the given size nearest the park entrance. */
async function findFlatBlock(page: Page, width: number, height: number): Promise<Tile> {
  const found = await page.evaluate(
    ({ width, height }) => {
      const m = window.__map;
      const ok = (x: number, y: number): boolean => {
        const i = y * m.width + x;
        return (m.ownership[i]! & 1) !== 0 && m.waterLevel[i]! <= m.heights[i]! && m.slope[i] === 0;
      };
      let best: { x: number; y: number; d: number } | null = null;
      for (let y = 1; y < m.height - height; y++)
        for (let x = 1; x < m.width - width; x++) {
          const z = m.heights[y * m.width + x]!;
          let good = true;
          for (let j = 0; j < height && good; j++)
            for (let i = 0; i < width; i++)
              if (!ok(x + i, y + j) || m.heights[(y + j) * m.width + x + i] !== z) {
                good = false;
                break;
              }
          if (good) {
            const d = Math.abs(x - 31) + Math.abs(y - 42);
            if (!best || d < best.d) best = { x, y, d };
          }
        }
      return best;
    },
    { width, height },
  );
  if (!found) throw new Error('No flat owned block available');
  return { x: found.x, y: found.y };
}

async function command(page: Page, payload: unknown): Promise<void> {
  await page.evaluate((c) => window.__sim.command(c), payload);
}

async function stage(page: Page, width: number, height: number): Promise<Tile> {
  const origin = await findFlatBlock(page, width, height);
  await command(page, { type: 'clearScenery', x: origin.x, y: origin.y, width, height });
  await expect
    .poll(() =>
      page.evaluate(
        ({ x0, y0, width, height }) => {
          const m = window.__map;
          let n = 0;
          for (let i = 0; i < m.sceneryCount; i++) {
            const x = m.sceneryElements[i * 5]!;
            const y = m.sceneryElements[i * 5 + 1]!;
            if (x >= x0 && x < x0 + width && y >= y0 && y < y0 + height) n++;
          }
          return n;
        },
        { x0: origin.x, y0: origin.y, width, height },
      ),
    )
    .toBe(0);
  return origin;
}

async function placeAndWait(
  page: Page,
  placements: Array<{ item: number; x: number; y: number; rotation: number }>,
): Promise<void> {
  for (const p of placements) await command(page, { type: 'placeScenery', ...p });
  await expect
    .poll(() =>
      page.evaluate(
        (wanted) =>
          wanted
            .filter((p) => {
              const m = window.__map;
              for (let i = 0; i < m.sceneryCount; i++)
                if (
                  m.sceneryElements[i * 5] === p.x &&
                  m.sceneryElements[i * 5 + 1] === p.y &&
                  m.sceneryElements[i * 5 + 4] === p.item
                )
                  return false;
              return true;
            })
            .map((p) => `${p.item}@${p.x},${p.y}`),
        placements,
      ),
    )
    .toEqual([]);
}

/** Places one item on a tile, photographs it close up at the current rotation, and removes it. */
async function photograph(page: Page, tile: Tile, item: number, facing: number): Promise<Buffer> {
  await placeAndWait(page, [{ item, ...tile, rotation: facing }]);
  const anchor = await frameTile(page, tile, 3);
  const shot = await crop(page, anchor, { left: 110, right: 110, up: 300, down: 60 });
  await command(page, { type: 'removeScenery', ...tile });
  await expect
    .poll(() =>
      page.evaluate((t) => {
        const m = window.__map;
        for (let i = 0; i < m.sceneryCount; i++)
          if (m.sceneryElements[i * 5] === t.x && m.sceneryElements[i * 5 + 1] === t.y)
            return false;
        return true;
      }, tile),
    )
    .toBe(true);
  return shot;
}

async function rotateTo(page: Page, rotation: number): Promise<void> {
  const rotate = page
    .locator('.game-toolbar')
    .getByRole('button', { name: 'Rotate right', exact: true });
  for (let guard = 0; guard < 4; guard++) {
    const current = await page.evaluate(() => window.__camera.rotation);
    if (current === rotation) return;
    await rotate.click();
    await expect.poll(() => page.evaluate(() => window.__camera.rotation)).not.toBe(current);
  }
}

/** Centres the camera on a tile at the given zoom and returns the tile's anchor in page pixels. */
async function frameTile(page: Page, tile: Tile, zoom: number): Promise<[number, number]> {
  const point = await page.evaluate(
    async ({ tile, zoom }) => {
      const { project } = await import('/src/render/projection.ts');
      const { TILE_UNITS, Z_STEP } = await import('/src/sim/core/constants.ts');
      const m = window.__map;
      const camera = window.__camera;
      const index = tile.y * m.width + tile.x;
      const out = new Float64Array(2);
      project(
        (tile.x + 0.5) * TILE_UNITS,
        (tile.y + 0.5) * TILE_UNITS,
        m.heights[index]! * Z_STEP,
        m.width,
        m.height,
        camera.rotation as 0 | 1 | 2 | 3,
        out,
      );
      camera.x = out[0]!;
      camera.y = out[1]! - 40;
      camera.zoom = zoom;
      const rect = document.querySelector('#game')!.getBoundingClientRect();
      return [rect.x + rect.width / 2, rect.y + rect.height / 2 + 40 * zoom];
    },
    { tile, zoom },
  );
  await page.waitForTimeout(350);
  return point as [number, number];
}

async function crop(
  page: Page,
  anchor: [number, number],
  box: { left: number; right: number; up: number; down: number },
): Promise<Buffer> {
  return page.screenshot({
    clip: {
      x: Math.max(0, anchor[0] - box.left),
      y: Math.max(0, anchor[1] - box.up),
      width: box.left + box.right,
      height: box.up + box.down,
    },
  });
}

function label(text: string, width: number, height = 22): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#222"/><text x="6" y="16" font-family="monospace" font-size="14" fill="#fff">${text}</text></svg>`,
  );
}

async function sheet(
  rows: Array<{ title: string; cells: Buffer[] }>,
  cell: { width: number; height: number },
  file: string,
): Promise<void> {
  const columns = Math.max(...rows.map((r) => r.cells.length));
  const rowHeight = cell.height + 22;
  const layers: sharp.OverlayOptions[] = [];
  for (const [r, row] of rows.entries()) {
    layers.push({ input: label(row.title, cell.width * columns), left: 0, top: r * rowHeight });
    for (const [c, buffer] of row.cells.entries()) {
      const fitted = await sharp(buffer)
        .resize(cell.width, cell.height, { fit: 'contain', background: '#cfd8b8' })
        .toBuffer();
      layers.push({ input: fitted, left: c * cell.width, top: r * rowHeight + 22 });
    }
  }
  await mkdir(OUT, { recursive: true });
  await sharp({
    create: {
      width: cell.width * columns,
      height: rowHeight * rows.length,
      channels: 3,
      background: '#cfd8b8',
    },
  })
    .composite(layers)
    .png()
    .toFile(join(OUT, file));
}

const GROUP_ITEMS = SCENERY_GROUPS.map((group) => ({
  label: group.label,
  items: NEW_ITEMS.filter((item) => SCENERY_CATALOG[item]!.category === group.category),
})).filter((group) => group.items.length > 0);

for (const renderer of ['webgl2', 'canvas2d'] as Renderer[]) {
  test.describe(`@art-review scenery close views (${renderer})`, () => {
    test.setTimeout(900_000);

    test('every new decoration at all four camera rotations', async ({ page }) => {
      if (renderer === 'canvas2d') await useCanvas2d(page);
      await startStarterPark(page);
      if (renderer === 'canvas2d') await expect(page.locator('.hud')).toContainText('Canvas2D');
      const origin = await stage(page, 12, 12);
      const centre = { x: origin.x + 6, y: origin.y + 6 };
      const cells = new Map<number, Buffer[]>();
      for (let rotation = 0; rotation < 4; rotation++) {
        await rotateTo(page, rotation);
        for (const item of NEW_ITEMS)
          cells.set(item, [...(cells.get(item) ?? []), await photograph(page, centre, item, 0)]);
      }
      for (const group of GROUP_ITEMS)
        await sheet(
          group.items.map((item) => ({
            title: `${SCENERY_CATALOG[item]!.name} - ${renderer} - camera rotation 0,1,2,3`,
            cells: cells.get(item)!,
          })),
          { width: 220, height: 360 },
          `${renderer}-${group.label.toLowerCase().replace(/[^a-z]+/g, '-')}.png`,
        );
    });

    test('directional decorations turn with their placement facing', async ({ page }) => {
      if (renderer === 'canvas2d') await useCanvas2d(page);
      await startStarterPark(page);
      const origin = await stage(page, 12, 12);
      const centre = { x: origin.x + 6, y: origin.y + 6 };
      const rows = [];
      for (const item of NEW_ITEMS.filter((entry) => SCENERY_CATALOG[entry]!.directional)) {
        const cells: Buffer[] = [];
        for (let facing = 0; facing < 4; facing++)
          cells.push(await photograph(page, centre, item, facing));
        rows.push({
          title: `${SCENERY_CATALOG[item]!.name} - ${renderer} - placement facing 0,1,2,3 at camera rotation 0`,
          cells,
        });
      }
      for (let start = 0; start < rows.length; start += 5)
        await sheet(
          rows.slice(start, start + 5),
          { width: 220, height: 360 },
          `${renderer}-facings-${start / 5}.png`,
        );
    });

    test('a small park decorated with the new catalogue', async ({ page }) => {
      test.setTimeout(300_000);
      if (renderer === 'canvas2d') await useCanvas2d(page);
      await startStarterPark(page);
      const origin = await stage(page, 12, 12);
      const at = (x: number, y: number): Tile => ({ x: origin.x + x, y: origin.y + y });
      for (let i = 0; i < 12; i++) {
        await command(page, { type: 'placePath', ...at(i, 6) });
        if (i !== 6) await command(page, { type: 'placePath', ...at(6, i) });
      }
      const S = SceneryItem;
      const layout: Array<[number, number, number, number]> = [
        [5, 5, S.TieredFountain, 0],
        [7, 5, S.GardenStatue, 3],
        [5, 7, S.Sundial, 0],
        [7, 7, S.WishingWell, 0],
        [4, 4, S.FlowerUrn, 0],
        [8, 4, S.FlowerUrn, 0],
        [4, 8, S.FlowerUrn, 0],
        [8, 8, S.FlowerUrn, 0],
        [1, 1, S.SunflowerPatch, 0],
        [2, 1, S.SunflowerPatch, 0],
        [1, 2, S.LavenderRows, 0],
        [2, 2, S.LavenderRows, 0],
        [3, 2, S.PlanterBox, 1],
        [4, 1, S.RoseArch, 0],
        [9, 1, S.Boulder, 0],
        [10, 2, S.RockCluster, 0],
        [9, 3, S.FallenLog, 0],
        [10, 4, S.TreeStump, 0],
        [11, 1, S.ReedClump, 0],
        [2, 9, S.Scarecrow, 1],
        [1, 10, S.SunflowerPatch, 0],
        [3, 10, S.LavenderRows, 0],
        [10, 8, S.SignBoard, 1],
        [11, 11, S.Flagpole, 0],
        [8, 10, S.Obelisk, 0],
        [8, 1, S.Conifer, 0],
        [11, 4, S.BlossomTree, 0],
      ];
      await placeAndWait(
        page,
        layout.map(([x, y, item, rotation]) => ({ item, ...at(x, y), rotation })),
      );
      for (const rotation of [0, 1]) {
        await rotateTo(page, rotation);
        await frameTile(page, at(6, 6), 2);
        await page.waitForTimeout(400);
        await page.screenshot({
          path: join(OUT, `${renderer}-decorated-park-rotation-${rotation}.png`),
          clip: { x: 0, y: 40, width: 1280, height: 720 },
        });
      }
    });

    test('placement ghosts show the item, the price and clearance', async ({ page }) => {
      if (renderer === 'canvas2d') await useCanvas2d(page);
      await startStarterPark(page);
      const origin = await stage(page, 12, 12);
      const target = { x: origin.x + 5, y: origin.y + 5 };
      await page
        .locator('.game-toolbar')
        .getByRole('button', { name: 'Scenery', exact: true })
        .click();
      const cells: Array<{ title: string; cells: Buffer[] }> = [];
      for (const group of GROUP_ITEMS) {
        await page.getByRole('button', { name: group.label, exact: true }).click();
        for (const item of group.items) {
          const definition = SCENERY_CATALOG[item]!;
          await page
            .getByRole('button', {
              name: `${definition.name}, $${(definition.priceCents / 100).toFixed(2)}`,
              exact: true,
            })
            .click();
          const row: Buffer[] = [];
          for (const rotation of [0, 1]) {
            await rotateTo(page, rotation);
            const anchor = await frameTile(page, target, 3);
            await page.mouse.move(anchor[0], anchor[1]);
            await expect(page.locator('.placement-label')).toContainText(definition.name);
            await expect(page.locator('.placement-label')).toHaveAttribute('data-tone', 'ok');
            await page.waitForTimeout(250);
            row.push(await crop(page, anchor, { left: 150, right: 210, up: 290, down: 70 }));
          }
          cells.push({
            title: `${definition.name} ghost - ${renderer} - rotation 0 / 1`,
            cells: row,
          });
        }
      }
      for (let start = 0; start < cells.length; start += 5)
        await sheet(
          cells.slice(start, start + 5),
          { width: 360, height: 360 },
          `${renderer}-ghosts-${start / 5}.png`,
        );
    });
  });
}

test.describe('@art-review scenery menu', () => {
  test.setTimeout(300_000);

  test('desktop menu shows every group with thumbnails once art has loaded', async ({ page }) => {
    await startStarterPark(page);
    await page
      .locator('.game-toolbar')
      .getByRole('button', { name: 'Scenery', exact: true })
      .click();
    for (const group of SCENERY_GROUPS) {
      await page.getByRole('button', { name: group.label, exact: true }).click();
      const cards = page.locator('.scenery-card');
      await expect(cards.first()).toBeVisible();
      await page.waitForTimeout(600);
      await page.screenshot({
        path: join(OUT, `menu-desktop-${group.label.toLowerCase().replace(/[^a-z]+/g, '-')}.png`),
      });
    }
  });

  test.describe('on a phone', () => {
    const { defaultBrowserType: _browser, ...pixel8 } = devices['Pixel 8'];
    void _browser;
    test.use(pixel8);

    test('phone menu shows every group with thumbnails', async ({ page }) => {
      await startStarterPark(page);
      const toolbar = page.locator('.game-toolbar');
      const scenery = toolbar.getByRole('button', { name: 'Scenery', exact: true });
      if (!(await scenery.isVisible()))
        await toolbar.getByRole('button', { name: 'Actions', exact: true }).click();
      await scenery.click();
      for (const group of SCENERY_GROUPS) {
        await page.getByRole('button', { name: group.label, exact: true }).tap();
        await expect(page.locator('.scenery-card').first()).toBeVisible();
        await page.waitForTimeout(600);
        await page.screenshot({
          path: join(OUT, `menu-phone-${group.label.toLowerCase().replace(/[^a-z]+/g, '-')}.png`),
        });
      }
    });
  });
});

void isWallScenery;

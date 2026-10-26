import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { chromium, expect as baseExpect, test as baseTest } from '@playwright/test';
import type { Page } from '@playwright/test';
import { RIDE_CATALOG } from '../src/sim/rides/ride-types';
import { SCENERY_CATALOG } from '../src/sim/map/scenery';

interface ReviewItem {
  key: string;
  label: string;
  kind: 'scenery' | 'ground-bed' | 'path' | 'addition' | 'ride';
  index?: number;
  type?: number;
  surface?: number;
  flags?: number;
  broken?: boolean;
  slope?: boolean;
  legacy?: boolean;
}

declare global {
  interface Window {
    __artReview?: {
      initialise: () => Promise<void>;
      render: (
        item: ReviewItem,
        backend: 'webgl2' | 'canvas2d',
        zoom: number,
        rotation: number,
      ) => void;
      aliasLegacyFlowerbed: (enabled: boolean) => void;
    };
  }
}

const INVENTORY_ZOOMS = [1, 4];
const FLOWERBED_ZOOMS = [0.5, 1, 2, 4];
const ROTATIONS = [0, 1, 2, 3];
const CELL_WIDTH = 192;
const CELL_HEIGHT = 220;
const CROP = { left: 160, top: 120, width: 320, height: 400 };
const OUTPUT_DIR = resolve(process.env.ART_REVIEW_OUTPUT ?? 'docs/art/review');
const FLOWERBEDS_ONLY = process.env.ART_REVIEW_FLOWERBEDS_ONLY === '1';
const test = process.env.ART_REVIEW_CDP
  ? baseTest.extend<{ page: Page }>({
      page: async ({ browserName }, use) => {
        void browserName;
        const browser = await chromium.connectOverCDP(process.env.ART_REVIEW_CDP!);
        const page = await browser.newPage();
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setBypassServiceWorker', { bypass: true });
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Network.clearBrowserCache');
        await use(page);
        await cdp.detach();
        await page.close();
        await browser.close();
      },
    })
  : baseTest;
const expect = baseExpect;

function inventory(): ReviewItem[] {
  const items: ReviewItem[] = SCENERY_CATALOG.map((definition, index) => ({
    key: `scenery-${definition.sprite}`,
    label: `Scenery: ${definition.name}`,
    kind: 'scenery',
    index,
  }));
  const paths = [
    { key: 'path-tarmac', label: 'Path: Tarmac', surface: 0, flags: 0x0f },
    { key: 'path-crazy-paving', label: 'Path: Crazy paving', surface: 1, flags: 0x0f },
    { key: 'path-dirt', label: 'Path: Dirt', surface: 2, flags: 0x0f },
    { key: 'path-queue', label: 'Path: Queue', surface: 0, flags: 0x10f },
  ];
  items.push(...paths.map((path) => ({ ...path, kind: 'path' as const })));
  const additions = [
    { key: 'addition-shelter', label: 'Path addition: Rain shelter', flags: 0x4000 },
    { key: 'addition-bench', label: 'Path addition: Bench', flags: 0x2000 },
    { key: 'addition-bin', label: 'Path addition: Bin', flags: 0x1000 },
    { key: 'addition-lamp', label: 'Path addition: Lamp', flags: 0x8000 },
    {
      key: 'addition-bench-broken',
      label: 'Path addition: Vandalised bench',
      flags: 0x2000,
      broken: true,
    },
    {
      key: 'addition-bin-broken',
      label: 'Path addition: Vandalised bin',
      flags: 0x1000,
      broken: true,
    },
    {
      key: 'addition-lamp-broken',
      label: 'Path addition: Vandalised lamp',
      flags: 0x8000,
      broken: true,
    },
  ];
  items.push(...additions.map((addition) => ({ ...addition, kind: 'addition' as const })));
  for (const [type, ride] of Object.entries(RIDE_CATALOG))
    items.push({
      key: `ride-${type}`,
      label: `${ride.category === 'shop' || ride.category === 'stall' || ride.category === 'facility' ? 'Facility' : 'Ride'}: ${ride.name}`,
      kind: 'ride',
      type: Number(type),
    });
  return items;
}

function flowerbedReviewItems(): ReviewItem[] {
  return [
    {
      key: 'before-flat',
      label: 'Legacy art · flat grass + path',
      kind: 'scenery',
      index: 3,
      legacy: true,
    },
    {
      key: 'before-slope',
      label: 'Legacy art · sloped grass + path',
      kind: 'scenery',
      index: 3,
      legacy: true,
      slope: true,
    },
    { key: 'after-flat', label: 'Generated bed · flat grass + path', kind: 'ground-bed' },
    {
      key: 'after-slope',
      label: 'Generated bed · sloped grass + path',
      kind: 'ground-bed',
      slope: true,
    },
  ];
}

async function initialise(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const reviewSize = 640;
    const [
      { Canvas2DRenderer },
      { WebGL2Renderer },
      { spritePages },
      { createSnapshot },
      { project },
      { SCENERY_CATALOG },
      { PieceId },
    ] = await Promise.all([
      import('../src/render/canvas2d-renderer'),
      import('../src/render/webgl2-renderer'),
      import('../src/render/sprite-pages'),
      import('../src/worker/snapshot'),
      import('../src/render/projection'),
      import('../src/sim/map/scenery'),
      import('../src/sim/track/catalog'),
    ]);
    spritePages.start();
    const manifest = await fetch('/sprites/manifest.json').then((response) => response.json());
    const manifestDeadline = Date.now() + 30_000;
    while (spritePages.pageInfos.length === 0) {
      if (Date.now() > manifestDeadline) throw new Error('Sprite manifest did not finish loading');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    for (const category of Object.keys(manifest.categories)) spritePages.requestCategory(category);
    const deadline = Date.now() + 60_000;
    while (Object.keys(manifest.categories).some((category) => !spritePages.isLoaded(category))) {
      if (Date.now() > deadline) {
        const missing = Object.keys(manifest.categories).filter(
          (category) => !spritePages.isLoaded(category),
        );
        throw new Error(`Sprite pages did not finish loading: ${missing.join(', ')}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const canvases = {} as Record<'webgl2' | 'canvas2d', HTMLCanvasElement>;
    const renderers = {} as Record<'webgl2' | 'canvas2d', InstanceType<typeof Canvas2DRenderer>>;
    const canvas2d = document.createElement('canvas');
    canvas2d.id = 'art-review-canvas2d';
    const webgl2 = document.createElement('canvas');
    webgl2.id = 'art-review-webgl2';
    for (const canvas of [canvas2d, webgl2]) {
      canvas.width = reviewSize;
      canvas.height = reviewSize;
      canvas.style.cssText = `position:fixed;left:0;top:0;width:${reviewSize}px;height:${reviewSize}px;z-index:1000000;background:#151510`;
      document.body.append(canvas);
    }
    const renderer2d = new Canvas2DRenderer();
    renderer2d.attach(canvas2d);
    renderer2d.resize(reviewSize, reviewSize, 1);
    const rendererWebGL = new WebGL2Renderer();
    rendererWebGL.attach(webgl2);
    rendererWebGL.resize(reviewSize, reviewSize, 1);
    canvases.canvas2d = canvas2d;
    canvases.webgl2 = webgl2;
    renderers.canvas2d = renderer2d;
    renderers.webgl2 = rendererWebGL as unknown as InstanceType<typeof Canvas2DRenderer>;

    const originalManifest = (
      spritePages as unknown as { manifest: { sprites: Record<string, unknown> } }
    ).manifest;
    const legacy = originalManifest.sprites['scenery/flower-bed'];
    const originalShrub = originalManifest.sprites['scenery/shrub'];
    const originalShrubWidth = SCENERY_CATALOG[3]!.width;

    const makeMap = (item: ReviewItem) => {
      const width = 8;
      const height = 8;
      const tile = 4 * width + 4;
      const heights = new Uint8Array(width * height);
      const surface = new Uint8Array(width * height);
      const slope = new Uint8Array(width * height);
      if (item.slope) {
        const cornerHeights = new Uint8Array((width + 1) * (height + 1));
        for (let y = 5; y <= height; y++)
          for (let x = 0; x <= width; x++) cornerHeights[y * (width + 1) + x] = 1;
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const index = y * width + x;
            const corners = [
              cornerHeights[y * (width + 1) + x]!,
              cornerHeights[y * (width + 1) + x + 1]!,
              cornerHeights[(y + 1) * (width + 1) + x + 1]!,
              cornerHeights[(y + 1) * (width + 1) + x]!,
            ];
            const base = Math.min(...corners);
            heights[index] = base;
            slope[index] = corners.reduce(
              (mask, value, corner) => mask | ((value - base) << corner),
              0,
            );
          }
      }
      const map: {
        width: number;
        height: number;
        heights: Uint8Array;
        surface: Uint8Array;
        slope: Uint8Array;
        pathElements: Int32Array;
        pathCount: number;
        sceneryElements: Int32Array;
        sceneryCount: number;
      } = {
        width,
        height,
        heights,
        surface,
        slope,
        pathElements: new Int32Array(0),
        pathCount: 0,
        sceneryElements: new Int32Array(0),
        sceneryCount: 0,
      };
      const pathRows: number[][] = [];
      if (item.kind === 'path' || item.kind === 'addition')
        pathRows.push([
          4,
          4,
          0,
          item.flags ?? 0x0f,
          item.broken ? 0x40000000 : 0,
          item.surface ?? 0,
        ]);
      else if (item.kind === 'ground-bed' || item.legacy) {
        const pathTile = 3 * width + 4;
        pathRows.push([4, 3, heights[pathTile]!, 0x0f, 0, 0]);
      }
      if (pathRows.length) {
        map.pathElements = Int32Array.from(pathRows.flat());
        map.pathCount = pathRows.length;
      }
      if (item.kind === 'scenery') {
        map.sceneryElements = Int32Array.of(4, 4, 0, 0, item.index ?? 0);
        map.sceneryCount = 1;
      }
      return { map, tile };
    };

    window.__artReview = {
      initialise: async () => undefined,
      aliasLegacyFlowerbed: (enabled) => {
        originalManifest.sprites['scenery/shrub'] = enabled
          ? { ...legacy, native: undefined }
          : originalShrub;
        SCENERY_CATALOG[3]!.width = enabled ? 30 : originalShrubWidth;
      },
      render: (item, backend, zoom, rotation) => {
        const { map, tile } = makeMap(item);
        const snapshot = createSnapshot({
          guests: 0,
          staff: 0,
          vehicles: 0,
          litter: 0,
          rides: 1,
          tracks: 1,
          mapTiles: 64,
        });
        if (item.kind === 'ground-bed') snapshot.grounds[tile] = 0x10;
        if (item.kind === 'ride') {
          snapshot.rides.count = 1;
          snapshot.rideInfo[0] = 1;
          snapshot.rideInfo[1] = item.type ?? 0;
          snapshot.rideInfo[22] = 4;
          snapshot.rideInfo[23] = 4;
          if (item.type !== undefined) {
            const actual = (
              window as unknown as { __rideCatalog: Record<number, { usesTrack: boolean }> }
            ).__rideCatalog[item.type];
            if (actual?.usesTrack) {
              snapshot.tracks.count = 1;
              snapshot.tracks.data.set([
                4 * 256 + 128,
                4 * 256 + 128,
                64,
                (1 << 16) | PieceId.Flat,
              ]);
            }
          }
        }
        const renderer = renderers[backend];
        const canvas = canvases[backend];
        canvas.style.display = 'block';
        canvases[backend === 'webgl2' ? 'canvas2d' : 'webgl2'].style.display = 'none';
        renderer.setMap(map);
        renderer.resize(reviewSize, reviewSize, 1);
        const focus = new Float64Array(2);
        const groundZ = item.slope && !item.legacy ? 32 : 0;
        project(4 * 256 + 128, 4 * 256 + 128, groundZ, map.width, map.height, rotation as 0, focus);
        renderer.draw(snapshot, { x: focus[0]!, y: focus[1]!, zoom, rotation: rotation as 0 });
      },
    };
    (window as unknown as { __rideCatalog: Record<number, { usesTrack: boolean }> }).__rideCatalog =
      Object.fromEntries(
        Object.entries((await import('../src/sim/rides/ride-types')).RIDE_CATALOG).map(
          ([type, ride]) => [type, { usesTrack: ride.usesTrack }],
        ),
      );
    void SCENERY_CATALOG;
  });
}

async function makeCell(
  page: Page,
  item: ReviewItem,
  backend: 'webgl2' | 'canvas2d',
  zoom: number,
  rotation: number,
): Promise<Buffer> {
  await page.evaluate(
    ({ item, backend, zoom, rotation }) => {
      window.__artReview!.aliasLegacyFlowerbed(item.legacy === true);
      window.__artReview!.render(item, backend, zoom, rotation);
    },
    { item, backend, zoom, rotation },
  );
  const screenshot = await page.locator(`#art-review-${backend}`).screenshot({ type: 'png' });
  const label = Buffer.from(
    `<svg width="${CELL_WIDTH}" height="${CELL_HEIGHT}"><rect width="100%" height="100%" fill="#f1ecd9"/><text x="8" y="16" font-family="sans-serif" font-size="12" fill="#25261f">${item.label.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</text></svg>`,
  );
  const crop = await sharp(screenshot)
    .extract(CROP)
    .resize(CELL_WIDTH, CELL_HEIGHT - 20, {
      kernel: 'nearest',
      fit: 'contain',
      background: '#151510',
    })
    .png()
    .toBuffer();
  return sharp({
    create: { width: CELL_WIDTH, height: CELL_HEIGHT, channels: 4, background: '#f1ecd9' },
  })
    .composite([{ input: label }, { input: crop, left: 0, top: 20 }])
    .png()
    .toBuffer();
}

async function writeSheet(name: string, cells: readonly Buffer[]): Promise<void> {
  const columns = Math.min(5, cells.length);
  const rows = Math.ceil(cells.length / columns);
  const sheet = await sharp({
    create: {
      width: columns * CELL_WIDTH,
      height: rows * CELL_HEIGHT,
      channels: 4,
      background: '#d4cfbd',
    },
  })
    .composite(
      cells.map((input, index) => ({
        input,
        left: (index % columns) * CELL_WIDTH,
        top: Math.floor(index / columns) * CELL_HEIGHT,
      })),
    )
    .png({ compressionLevel: 9 })
    .toBuffer();
  await sharp(sheet).toFile(join(OUTPUT_DIR, `${name}.png`));
}

test('generates Playwright visual review contact sheets @art-review', async ({ page }) => {
  test.setTimeout(1_200_000);
  await mkdir(OUTPUT_DIR, { recursive: true });
  await page.goto(process.env.ART_REVIEW_BASE_URL ?? 'http://127.0.0.1:4173/');
  if (!(await page.locator('.game-toolbar').isVisible()))
    await page.getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.locator('.game-toolbar')).toBeVisible();
  await initialise(page);

  const backends = ['webgl2', 'canvas2d'] as const;
  if (!FLOWERBEDS_ONLY) {
    for (const backend of backends)
      for (const zoom of INVENTORY_ZOOMS)
        for (const rotation of ROTATIONS) {
          const cells: Buffer[] = [];
          for (const item of inventory())
            cells.push(await makeCell(page, item, backend, zoom, rotation));
          await writeSheet(`inventory-${backend}-zoom-${zoom}-rotation-${rotation}`, cells);
        }
  }

  for (const backend of backends)
    for (const zoom of FLOWERBED_ZOOMS)
      for (const rotation of ROTATIONS) {
        const cells: Buffer[] = [];
        for (const item of flowerbedReviewItems())
          cells.push(await makeCell(page, item, backend, zoom, rotation));
        await writeSheet(`flowerbeds-${backend}-zoom-${zoom}-rotation-${rotation}`, cells);
      }

  expect(await page.locator('#art-review-webgl2').count()).toBe(1);
  expect(await page.locator('#art-review-canvas2d').count()).toBe(1);
});

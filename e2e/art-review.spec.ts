import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { chromium, expect as baseExpect, test as baseTest } from '@playwright/test';
import type { Page } from '@playwright/test';
import { RIDE_CATALOG } from '../src/sim/rides/ride-types';
import { SCENERY_CATALOG } from '../src/sim/map/scenery';
import { project } from '../src/render/projection';
import { TILE_UNITS } from '../src/sim/core/constants';
import { pathAdditionPlacements } from '../src/render/ground-anchor';

interface ReviewItem {
  key: string;
  label: string;
  kind:
    | 'scenery'
    | 'ground-bed'
    | 'path'
    | 'addition'
    | 'ride'
    | 'background'
    | 'garden-fixture'
    | 'context';
  index?: number;
  type?: number;
  surface?: number;
  flags?: number;
  broken?: boolean;
  slope?: boolean;
  legacy?: boolean;
  withBeds?: boolean;
}

interface TrackRenderStats {
  trackPieces: number;
  circuitClosed: boolean;
  cars: number;
  opaquePixelsPerTrackSprite: Array<{ key: string; count: number }>;
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
      ) => TrackRenderStats | undefined;
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
const FACILITY_MIN_VISIBLE_PIXELS = 900;
const OUTPUT_DIR = resolve(process.env.ART_REVIEW_OUTPUT ?? 'docs/art/review');
const FLOWERBEDS_ONLY = process.env.ART_REVIEW_FLOWERBEDS_ONLY === '1';
const CANVAS_ONLY = process.env.ART_REVIEW_BACKENDS === 'canvas2d';
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
const renderStats = new WeakMap<Page, TrackRenderStats | undefined>();

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
  await page.evaluate(async (canvasOnly) => {
    const reviewSize = 640;
    const [
      { Canvas2DRenderer },
      { WebGL2Renderer },
      { spritePages },
      { createSnapshot, RideFlag, RideInfo },
      { project },
      { SCENERY_CATALOG },
      { CoasterScene },
      { createCoaster, flatOwnedSim, SMALL_CIRCUIT },
      { getConstructionCursor },
      { PieceMode },
      { pieceByName },
      { RideType },
      { writeSnapshot },
    ] = await Promise.all([
      import('../src/render/canvas2d-renderer'),
      import('../src/render/webgl2-renderer'),
      import('../src/render/sprite-pages.ts'),
      import('../src/worker/snapshot'),
      import('../src/render/projection'),
      import('../src/sim/map/scenery'),
      import('../src/render/coaster-scene'),
      import('../src/sim/rides/coaster-fixtures'),
      import('../src/sim/track/construction'),
      import('../src/sim/track/track-types'),
      import('../src/sim/track/catalog'),
      import('../src/sim/rides/ride-types'),
      import('../src/worker/snapshot'),
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

    const canvases = {} as Partial<Record<'webgl2' | 'canvas2d', HTMLCanvasElement>>;
    const renderers = {} as Partial<
      Record<'webgl2' | 'canvas2d', InstanceType<typeof Canvas2DRenderer>>
    >;
    const canvas2d = document.createElement('canvas');
    canvas2d.id = 'art-review-canvas2d';
    const canvasesToAttach = [canvas2d];
    if (!canvasOnly) {
      const webgl2 = document.createElement('canvas');
      webgl2.id = 'art-review-webgl2';
      canvases.webgl2 = webgl2;
      canvasesToAttach.push(webgl2);
    }
    for (const canvas of canvasesToAttach) {
      canvas.width = reviewSize;
      canvas.height = reviewSize;
      canvas.style.cssText = `position:fixed;left:0;top:0;width:${reviewSize}px;height:${reviewSize}px;z-index:1000000;background:#151510`;
      document.body.append(canvas);
    }
    const renderer2d = new Canvas2DRenderer();
    renderer2d.attach(canvas2d);
    renderer2d.resize(reviewSize, reviewSize, 1);
    canvases.canvas2d = canvas2d;
    renderers.canvas2d = renderer2d;
    if (!canvasOnly) {
      const rendererWebGL = new WebGL2Renderer();
      rendererWebGL.attach(canvases.webgl2!);
      rendererWebGL.resize(reviewSize, reviewSize, 1);
      renderers.webgl2 = rendererWebGL as unknown as InstanceType<typeof Canvas2DRenderer>;
    }

    const rendererAtlas = (renderer2d as unknown as { atlas: typeof spritePages }).atlas;
    const rendererManifestDeadline = Date.now() + 30_000;
    while (rendererAtlas.pageInfos.length === 0) {
      if (Date.now() > rendererManifestDeadline)
        throw new Error('Renderer sprite manifest did not finish loading');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    for (const category of Object.keys(manifest.categories))
      rendererAtlas.requestCategory(category);
    const rendererPagesDeadline = Date.now() + 60_000;
    while (Object.keys(manifest.categories).some((category) => !rendererAtlas.isLoaded(category))) {
      if (Date.now() > rendererPagesDeadline) {
        const missing = Object.keys(manifest.categories).filter(
          (category) => !rendererAtlas.isLoaded(category),
        );
        throw new Error(`Renderer sprite pages did not finish loading: ${missing.join(', ')}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const originalManifest = (
      spritePages as unknown as { manifest: { sprites: Record<string, unknown> } }
    ).manifest;
    const legacy = originalManifest.sprites['scenery/flower-bed'];
    const originalShrub = originalManifest.sprites['scenery/shrub'];
    const originalShrubWidth = SCENERY_CATALOG[3]!.width;

    const rideFixtures = new Map<number, { snapshot: ReturnType<typeof createSnapshot> }>();
    const makeRideFixture = (type: number) => {
      const cached = rideFixtures.get(type);
      if (cached) return cached;
      const sim = flatOwnedSim(1);
      const rideId = createCoaster(sim, type, 20, 16);
      for (const [name, originalMode] of SMALL_CIRCUIT) {
        const cursor = getConstructionCursor(sim.world, rideId);
        const mode =
          (type === RideType.LogFlume || type === RideType.RiverRapids) &&
          originalMode === PieceMode.ChainLift
            ? PieceMode.WaterLift
            : originalMode;
        sim.enqueue({
          type: 'placeTrack',
          rideId,
          pieceType: pieceByName(name)!.id,
          x: cursor.hasTrack ? cursor.x : 20,
          y: cursor.hasTrack ? cursor.y : 20,
          z: cursor.hasTrack ? cursor.z : 2,
          dir: cursor.hasTrack ? cursor.dir : 0,
          mode,
        });
        sim.step();
        if (sim.world.track.lastResult !== 0)
          throw new Error(`art review could not place ${name} for ride ${type}`);
      }
      sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
      sim.step();
      const snapshot = createSnapshot({
        guests: 0,
        staff: 0,
        vehicles: 8,
        cars: 64,
        litter: 0,
        rides: 1,
        tracks: 64,
        mapTiles: 48 * 48,
      });
      writeSnapshot(sim.world, snapshot);
      const fixture = { snapshot };
      rideFixtures.set(type, fixture);
      return fixture;
    };

    const makeMap = (item: ReviewItem) => {
      const rideType = item.kind === 'ride' ? item.type : undefined;
      const usesTrack =
        rideType !== undefined &&
        (window as unknown as { __rideCatalog: Record<number, { usesTrack: boolean }> })
          .__rideCatalog[rideType]?.usesTrack;
      const width = usesTrack ? 48 : 8;
      const height = usesTrack ? 48 : 8;
      const tile = 4 * width + 4;
      const heights = new Uint8Array(width * height);
      const surface = new Uint8Array(width * height);
      if (item.kind !== 'context') surface.fill(2);
      const slope = new Uint8Array(width * height);
      if (item.slope) {
        const cornerHeights = new Uint8Array((width + 1) * (height + 1));
        const slopeRow = item.kind === 'context' ? 6 : 5;
        for (let y = slopeRow; y <= height; y++)
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
      if (item.kind === 'context') {
        for (let x = 1; x <= 6; x++) {
          const addition = x === 1 ? 0x8000 : x === 3 ? 0x2000 : x === 5 ? 0x1000 : 0;
          pathRows.push([x, 4, 0, 0x0f | addition, x === 1 ? 0x40000000 : 0, 0]);
        }
      } else if (item.kind === 'path' || item.kind === 'addition')
        pathRows.push([
          4,
          4,
          0,
          item.flags ?? 0x0f,
          item.broken ? 0x40000000 : 0,
          item.surface ?? 0,
        ]);
      else if (item.kind === 'garden-fixture') {
        for (let x = 2; x <= 5; x++)
          pathRows.push([x, 4, 0, x === 2 ? 0x1000 | 0b1110 : 0x0f, 0, 0]);
      } else if (item.kind === 'ground-bed' || item.legacy) {
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
      } else if (item.kind === 'context') {
        map.sceneryElements = Int32Array.from([
          1, 1, 0, 0, 3, 2, 1, 0, 0, 3, 1, 2, 0, 0, 3, 6, 1, 0, 0, 3, 7, 1, 0, 0, 3,
        ]);
        map.sceneryCount = 5;
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
        const rideType = item.kind === 'ride' ? item.type : undefined;
        const usesTrack =
          rideType !== undefined &&
          (window as unknown as { __rideCatalog: Record<number, { usesTrack: boolean }> })
            .__rideCatalog[rideType]?.usesTrack;
        if (usesTrack) map.heights.fill(2);
        const snapshot = usesTrack
          ? makeRideFixture(rideType!).snapshot
          : createSnapshot({
              guests: item.kind === 'context' ? 3 : item.kind === 'garden-fixture' ? 1 : 0,
              staff: 0,
              vehicles: 0,
              litter: 0,
              rides: item.kind === 'background' ? 0 : item.kind === 'context' ? 5 : 1,
              tracks: 0,
              mapTiles: 64,
            });
        if (item.kind === 'ground-bed') snapshot.grounds[tile] = 0x10;
        if (item.kind === 'garden-fixture') {
          if (item.withBeds) {
            const bedRow = rotation === 1 || rotation === 2 ? 5 : 3;
            for (let x = 2; x <= 5; x++) snapshot.grounds[bedRow * 8 + x] = 0x10;
            const clusterSecondRow = bedRow === 3 ? 2 : 6;
            for (const y of [bedRow, clusterSecondRow])
              for (const x of [6, 7]) snapshot.grounds[y * 8 + x] = 0x10;
          }
          snapshot.guests.count = 1;
          snapshot.guests.data.set([3 * 256 + 128, 4 * 256 + 128, 0, 0]);
        }
        if (item.kind === 'ride' && !usesTrack) {
          snapshot.rides.count = 1;
          snapshot.rideInfo[0] = 1;
          snapshot.rideInfo[1] = item.type ?? 0;
          snapshot.rideInfo[22] = 4;
          snapshot.rideInfo[23] = 4;
        } else if (item.kind === 'context') {
          snapshot.grounds[4 * 8] = 0x10;
          const facilities = Object.entries(
            (
              window as unknown as {
                __rideCatalog: Record<number, { category: string; name: string }>;
              }
            ).__rideCatalog,
          ).filter(([, definition]) => ['shop', 'stall', 'facility'].includes(definition.category));
          const typeByName = Object.fromEntries(
            facilities.map(([type, definition]) => [definition.name, Number(type)]),
          );
          const placements: [number, number, number][] = [
            [typeByName['Food Stall']!, 1, 3],
            [typeByName['Drink Stall']!, 3, 3],
            [typeByName['Information Kiosk']!, 5, 3],
            [typeByName['Food Stall']!, 2, 5],
            [typeByName.Toilets!, 5, 5],
          ];
          snapshot.rides.count = placements.length;
          placements.forEach(([type, x, y], index) => {
            const offset = index * 25;
            snapshot.rideInfo[offset] = index + 1;
            snapshot.rideInfo[offset + 1] = type!;
            snapshot.rideInfo[offset + 22] = x!;
            snapshot.rideInfo[offset + 23] = y!;
          });
          snapshot.guests.count = 3;
          snapshot.guests.data.set([
            2 * 256 + 128,
            4 * 256 + 128,
            0,
            0,
            4 * 256 + 128,
            4 * 256 + 128,
            0,
            0,
            6 * 256 + 128,
            4 * 256 + 128,
            0,
            0,
          ]);
        }
        const renderer = renderers[backend];
        const canvas = canvases[backend];
        if (!renderer || !canvas) throw new Error(`${backend} renderer was not initialized`);
        canvas.style.display = 'block';
        const otherCanvas = canvases[backend === 'webgl2' ? 'canvas2d' : 'webgl2'];
        if (otherCanvas) otherCanvas.style.display = 'none';
        renderer.setMap(map);
        renderer.resize(reviewSize, reviewSize, 1);
        const focus = new Float64Array(2);
        const groundZ = item.slope && !item.legacy ? 32 : 0;
        const focusTile = usesTrack ? 20 : 4;
        project(
          focusTile * 256 + 128,
          focusTile * 256 + 128,
          groundZ,
          map.width,
          map.height,
          rotation as 0 | 1 | 2 | 3,
          focus,
        );
        renderer.draw(snapshot, {
          x: focus[0]!,
          y: focus[1]!,
          zoom,
          rotation: rotation as 0 | 1 | 2 | 3,
        });
        if (item.kind !== 'ride' || item.type === undefined) return undefined;
        const definition = (
          window as unknown as { __rideCatalog: Record<number, { usesTrack: boolean }> }
        ).__rideCatalog[item.type];
        if (!definition?.usesTrack) return undefined;
        const scene = new CoasterScene();
        scene.build(snapshot, map, rotation as 0 | 1 | 2 | 3);
        return {
          trackPieces: snapshot.tracks.count,
          circuitClosed: (snapshot.rideInfo[RideInfo.Flags]! & RideFlag.CircuitClosed) !== 0,
          cars: snapshot.cars.count,
          opaquePixelsPerTrackSprite: scene.items
            .slice(0, scene.length)
            .filter(
              (candidate) =>
                candidate.key.includes('/track/') || candidate.key.startsWith('track/'),
            )
            .map((entry) => {
              const hash = entry.key.lastIndexOf('#');
              const name = hash < 0 ? entry.key : entry.key.slice(0, hash);
              const frameIndex = hash < 0 ? 0 : Number(entry.key.slice(hash + 1));
              const frame = spritePages.resolve(name)?.frames[frameIndex];
              const image = frame && spritePages.pageImage(frame.page);
              if (!frame || !image) return { key: entry.key, count: 0 };
              const sample = document.createElement('canvas');
              sample.width = frame.width;
              sample.height = frame.height;
              const context = sample.getContext('2d');
              if (!context) return { key: entry.key, count: 0 };
              context.drawImage(
                image,
                frame.x,
                frame.y,
                frame.width,
                frame.height,
                0,
                0,
                frame.width,
                frame.height,
              );
              const pixels = context.getImageData(0, 0, frame.width, frame.height).data;
              let opaque = 0;
              for (let index = 3; index < pixels.length; index += 4)
                if (pixels[index]! > 0) opaque++;
              return { key: entry.key, count: opaque };
            }),
        };
      },
    };
    (
      window as unknown as {
        __rideCatalog: Record<number, { usesTrack: boolean; category: string; name: string }>;
      }
    ).__rideCatalog = Object.fromEntries(
      Object.entries((await import('../src/sim/rides/ride-types')).RIDE_CATALOG).map(
        ([type, ride]) => [
          type,
          { usesTrack: ride.usesTrack, category: ride.category, name: ride.name },
        ],
      ),
    );
    void SCENERY_CATALOG;
  }, CANVAS_ONLY);
}

async function makeCell(
  page: Page,
  item: ReviewItem,
  backend: 'webgl2' | 'canvas2d',
  zoom: number,
  rotation: number,
): Promise<Buffer> {
  const isFacility =
    item.kind === 'ride' &&
    ['shop', 'stall', 'facility'].includes(RIDE_CATALOG[item.type ?? 0]?.category ?? '');
  let background: Buffer | undefined;
  if (isFacility && zoom === 1) {
    background = await renderItem(
      page,
      { kind: 'background', key: 'background', label: 'Background' },
      backend,
      zoom,
      rotation,
    );
  }
  const screenshot = await renderItem(page, item, backend, zoom, rotation);
  if (item.kind === 'ride' && item.type !== undefined && RIDE_CATALOG[item.type]?.usesTrack) {
    await expectCompletedTrackRender(page, item, backend, screenshot);
    if (zoom === 1 && rotation === 0) {
      const safeName = RIDE_CATALOG[item.type]!.name.toLowerCase().replaceAll(' ', '-');
      await writeFile(join(OUTPUT_DIR, `game-${backend}-${safeName}.png`), screenshot);
    }
  }
  if (background) {
    const before = await sharp(background).raw().toBuffer({ resolveWithObject: true });
    const after = await sharp(screenshot).raw().toBuffer({ resolveWithObject: true });
    let visiblePixels = 0;
    for (let pixel = 0; pixel < before.info.width * before.info.height; pixel++) {
      const offset = pixel * before.info.channels;
      if (
        before.data[offset] !== after.data[offset] ||
        before.data[offset + 1] !== after.data[offset + 1] ||
        before.data[offset + 2] !== after.data[offset + 2]
      )
        visiblePixels++;
    }
    expect(visiblePixels, `${backend} ${item.label} at default zoom`).toBeGreaterThanOrEqual(
      FACILITY_MIN_VISIBLE_PIXELS,
    );
  }
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

async function expectCompletedTrackRender(
  page: Page,
  item: ReviewItem,
  backend: 'webgl2' | 'canvas2d',
  screenshot: Buffer,
): Promise<void> {
  const stats = renderStats.get(page);
  expect(stats?.trackPieces, `${item.label} placed through the track builder`).toBe(14);
  expect(stats?.circuitClosed, `${item.label} circuit is complete`).toBe(true);
  expect(stats?.cars, `${item.label} train cars`).toBeGreaterThan(0);
  expect(stats?.opaquePixelsPerTrackSprite.length, `${item.label} track sprites`).toBeGreaterThan(
    0,
  );
  expect(
    stats?.opaquePixelsPerTrackSprite.every(({ count }) => count > 0),
    `${item.label} opaque pixels per track piece`,
  ).toBe(true);
  const { data } = await sharp(screenshot)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let redMarkers = 0;
  for (let offset = 0; offset < data.length; offset += 4)
    if (data[offset] === 207 && data[offset + 1] === 86 && data[offset + 2] === 80) redMarkers++;
  expect(redMarkers, `${item.label} red track fallback pixels in ${backend}`).toBe(0);
}

async function renderItem(
  page: Page,
  item: ReviewItem,
  backend: 'webgl2' | 'canvas2d',
  zoom: number,
  rotation: number,
): Promise<Buffer> {
  const stats = await page.evaluate(
    ({ item, backend, zoom, rotation }) => {
      window.__artReview!.aliasLegacyFlowerbed(item.legacy === true);
      return window.__artReview!.render(item, backend, zoom, rotation);
    },
    { item, backend, zoom, rotation },
  );
  renderStats.set(page, stats);
  return page.locator(`#art-review-${backend}`).screenshot({ type: 'png' });
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

async function setupReviewPage(page: Page): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await page.goto(process.env.ART_REVIEW_BASE_URL ?? 'http://127.0.0.1:4173/');
  if (!(await page.locator('.game-toolbar').isVisible()))
    await page.getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.locator('.game-toolbar')).toBeVisible();
  await initialise(page);
}

const backends = CANVAS_ONLY ? (['canvas2d'] as const) : (['webgl2', 'canvas2d'] as const);

if (!FLOWERBEDS_ONLY) {
  for (const backend of backends)
    for (const zoom of INVENTORY_ZOOMS)
      for (const rotation of ROTATIONS)
        test(`captures ${backend} inventory at zoom ${zoom}, rotation ${rotation} @art-review`, async ({
          page,
        }) => {
          test.setTimeout(1_200_000);
          await setupReviewPage(page);
          const cells: Buffer[] = [];
          for (const item of inventory())
            cells.push(await makeCell(page, item, backend, zoom, rotation));
          await writeSheet(`inventory-${backend}-zoom-${zoom}-rotation-${rotation}`, cells);
        });
}

test('captures flowerbeds across renderers, zooms, and rotations @art-review', async ({ page }) => {
  test.setTimeout(1_200_000);
  await setupReviewPage(page);
  for (const backend of backends)
    for (const zoom of FLOWERBED_ZOOMS)
      for (const rotation of ROTATIONS) {
        const cells: Buffer[] = [];
        for (const item of flowerbedReviewItems())
          cells.push(await makeCell(page, item, backend, zoom, rotation));
        await writeSheet(`flowerbeds-${backend}-zoom-${zoom}-rotation-${rotation}`, cells);
      }
  expect(await page.locator('#art-review-webgl2').count()).toBe(CANVAS_ONLY ? 0 : 1);
  expect(await page.locator('#art-review-canvas2d').count()).toBe(1);
});

test('keeps path pixels visible beside a garden row, guests, and a bin in every renderer and rotation', async ({
  page,
}) => {
  test.setTimeout(1_200_000);
  await setupReviewPage(page);
  for (const backend of backends) {
    for (let rotation = 0; rotation < 4; rotation++) {
      const baseline = await renderItem(
        page,
        { key: 'garden-path-only', label: 'Path only', kind: 'garden-fixture', withBeds: false },
        backend,
        1,
        rotation,
      );
      const withBeds = await renderItem(
        page,
        { key: 'garden-row', label: 'Garden row', kind: 'garden-fixture', withBeds: true },
        backend,
        1,
        rotation,
      );
      await writeFile(join(OUTPUT_DIR, `garden-row-${backend}-rotation-${rotation}.png`), withBeds);
      const baselinePixels = await sharp(baseline).raw().toBuffer({ resolveWithObject: true });
      const bedPixels = await sharp(withBeds).raw().toBuffer({ resolveWithObject: true });
      const rotationCenter = new Float64Array(2);
      const rotationSample = new Float64Array(2);
      project(
        4.5 * TILE_UNITS,
        4.5 * TILE_UNITS,
        0,
        8,
        8,
        rotation as 0 | 1 | 2 | 3,
        rotationCenter,
      );
      const bedRow = rotation === 1 || rotation === 2 ? 5 : 3;
      const pathSampleY = bedRow === 3 ? 4.05 : 4.95;
      project(
        4.5 * TILE_UNITS,
        pathSampleY * TILE_UNITS,
        0,
        8,
        8,
        rotation as 0 | 1 | 2 | 3,
        rotationSample,
      );
      const x = Math.round(rotationSample[0]! - rotationCenter[0]! + 320);
      const y = Math.round(rotationSample[1]! - rotationCenter[1]! + 320);
      let unchangedPathArea = 0;
      for (let py = y - 2; py <= y + 2; py++)
        for (let px = x - 2; px <= x + 2; px++) {
          const pixel = (py * baselinePixels.info.width + px) * baselinePixels.info.channels;
          if (
            baselinePixels.data
              .subarray(pixel, pixel + 3)
              .equals(bedPixels.data.subarray(pixel, pixel + 3))
          )
            unchangedPathArea++;
        }
      expect(
        unchangedPathArea,
        `${backend} path pixels beside beds, rotation ${rotation}`,
      ).toBeGreaterThan(22);

      const guest = new Float64Array(2);
      project(3.5 * TILE_UNITS, 4.5 * TILE_UNITS, 0, 8, 8, rotation as 0 | 1 | 2 | 3, guest);
      const guestX = Math.round(guest[0]! - rotationCenter[0]! + 320);
      const guestY = Math.round(guest[1]! - rotationCenter[1]! + 320);
      let unchangedGuestArea = 0;
      for (let py = guestY - 22; py <= guestY + 4; py++)
        for (let px = guestX - 10; px <= guestX + 10; px++) {
          const pixel = (py * baselinePixels.info.width + px) * baselinePixels.info.channels;
          if (
            baselinePixels.data
              .subarray(pixel, pixel + 3)
              .equals(bedPixels.data.subarray(pixel, pixel + 3))
          )
            unchangedGuestArea++;
        }
      expect(
        unchangedGuestArea,
        `${backend} guest pixels beside beds, rotation ${rotation}`,
      ).toBeGreaterThan(450);

      const binPlacement = pathAdditionPlacements(0x1000 | 0b1110, 0)[0]!;
      const bin = new Float64Array(2);
      project(
        2.5 * TILE_UNITS + binPlacement.x,
        4.5 * TILE_UNITS + binPlacement.y,
        binPlacement.groundZ,
        8,
        8,
        rotation as 0 | 1 | 2 | 3,
        bin,
      );
      const binX = Math.round(bin[0]! - rotationCenter[0]! + 320);
      const binY = Math.round(bin[1]! - rotationCenter[1]! + 320);
      let unchangedBinArea = 0;
      for (let py = binY - 26; py <= binY + 2; py++)
        for (let px = binX - 10; px <= binX + 10; px++) {
          const pixel = (py * baselinePixels.info.width + px) * baselinePixels.info.channels;
          if (
            baselinePixels.data
              .subarray(pixel, pixel + 3)
              .equals(bedPixels.data.subarray(pixel, pixel + 3))
          )
            unchangedBinArea++;
        }
      expect(
        unchangedBinArea,
        `${backend} bin pixels beside beds, rotation ${rotation}`,
      ).toBeGreaterThan(420);
    }
  }
});

test('captures placeable art in a populated path scene @art-context-review', async ({ page }) => {
  test.setTimeout(1_200_000);
  await setupReviewPage(page);
  for (const backend of backends)
    for (const rotation of ROTATIONS) {
      const cell = await makeCell(
        page,
        {
          key: 'context',
          label: 'Facilities, shrubs, flowerbed, paths, and guests',
          kind: 'context',
          slope: true,
        },
        backend,
        1,
        rotation,
      );
      await writeSheet(`context-${backend}-rotation-${rotation}`, [cell]);
      await sharp(await page.locator(`#art-review-${backend}`).screenshot({ type: 'png' })).toFile(
        join(OUTPUT_DIR, `context-scene-${backend}-rotation-${rotation}.png`),
      );
    }
});

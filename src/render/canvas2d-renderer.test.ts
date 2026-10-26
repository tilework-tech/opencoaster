import { afterEach, describe, expect, it, vi } from 'vitest';
import { PATH_ADDITION_BROKEN, PathFlag, PathStyle } from '../sim/map/tile-map';
import { SceneryItem } from '../sim/map/scenery';
import { SCENERY_CATALOG } from '../sim/map/scenery';
import { SceneryResult } from '../sim/map/scenery';
import { sceneryBox } from './ground-anchor';
import { Canvas2DRenderer } from './canvas2d-renderer';
import type { CanvasAtlas } from './canvas-atlas';
import { createSnapshot } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import type { MapData } from './renderer';
import { SpritePages } from './sprite-pages';
import type { PageImage, SpriteEntry } from './sprite-pages';
import { ScenerySpotPreview } from '../app/tools/scenery-preview';
import { flowerbedPreviewGhost } from '../app/tools/flowerbed-preview';
import { pathAdditionPreviewGhosts } from '../app/tools/path-addition-preview';
import { FLOWER_BED } from '../sim/staff/grounds';
import { flowerBedSpriteName, scenerySpriteName } from './world-art';

class RecordingContext {
  readonly canvas = { width: 1, height: 1 };
  readonly fills: string[] = [];
  readonly arcs: string[] = [];
  readonly spriteSources: number[] = [];
  readonly images: unknown[][] = [];
  readonly imageTransforms: number[][] = [];
  private currentTransform = [1, 0, 0, 1, 0, 0];
  imageSmoothingEnabled = true;
  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.currentTransform = [a, b, c, d, e, f];
  }

  fillRect(): void {
    this.fills.push(this.fillStyle);
  }

  beginPath(): void {}

  moveTo(): void {}

  lineTo(): void {}

  quadraticCurveTo(): void {}

  closePath(): void {}

  fill(): void {
    this.fills.push(this.fillStyle);
  }

  arc(): void {
    this.arcs.push(this.fillStyle);
  }

  stroke(): void {}

  save(): void {}

  restore(): void {}

  transform(): void {}

  clip(): void {}

  drawImage(...args: unknown[]): void {
    this.images.push(args);
    this.imageTransforms.push(this.currentTransform);
    this.spriteSources.push(args[1] as number);
  }
}

function screenRect(
  context: RecordingContext,
  width: number,
  height: number,
): number[] | undefined {
  const index = context.images.findIndex(
    (args) => args.length === 9 && args[7] === width && args[8] === height,
  );
  if (index < 0) return undefined;
  const args = context.images[index]!;
  const [scaleX, , , scaleY, translateX, translateY] = context.imageTransforms[index]!;
  return [
    scaleX! * Number(args[5]) + translateX!,
    scaleY! * Number(args[6]) + translateY!,
    scaleX! * width,
    scaleY! * height,
  ];
}

function render(map: MapData): RecordingContext {
  const context = new RecordingContext();
  const canvas = {
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  const renderer = new Canvas2DRenderer();
  renderer.attach(canvas);
  renderer.resize(800, 600, 1);
  renderer.setMap(map);
  renderer.draw(null, { x: 0, y: 0, zoom: 1, rotation: 0 });
  return context;
}

const STUB_FRAME = { width: 30, height: 20 };

function installStubAtlas(names: string[], atlas: SpritePages): void {
  const sprites: Record<string, SpriteEntry> = {};
  for (const [index, name] of names.entries())
    sprites[name] = {
      category: 'world',
      frames: [
        { page: 0, x: index + 1, y: 2, width: 30, height: 20 },
        { page: 0, x: index + 2, y: 2, width: 30, height: 20 },
      ],
      anchor: { x: 15, y: 20 },
      footprint: { width: 1, height: 1 },
    };
  atlas.install(
    {
      pages: [{ file: 'atlas/world-0.png', width: 64, height: 64, category: 'world' }],
      categories: { world: { lazy: false, pages: [0] } },
      sprites,
    },
    new Map([[0, {} as PageImage]]),
  );
}

async function renderWithAtlas(
  map: MapData,
  names: string[],
  snapshot: Snapshot | null = null,
  camera: { x: number; y: number; zoom: number; rotation: 0 | 1 | 2 | 3 } = {
    x: 0,
    y: 0,
    zoom: 1,
    rotation: 0,
  },
  spriteGhosts: Parameters<Canvas2DRenderer['setSpriteGhosts']>[0] = [],
): Promise<RecordingContext> {
  const context = new RecordingContext();
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  const renderer = new Canvas2DRenderer();
  const atlas = new SpritePages();
  installStubAtlas(names, atlas);
  renderer.attach(canvas);
  renderer.resize(800, 600, 1);
  (renderer as unknown as { atlas: CanvasAtlas }).atlas = atlas;
  renderer.setMap(map);
  renderer.setSpriteGhosts(spriteGhosts);
  renderer.draw(snapshot, camera);
  return context;
}

function flatMap(): MapData {
  return {
    width: 5,
    height: 5,
    heights: new Uint8Array(25),
    surface: new Uint8Array(25),
    slope: new Uint8Array(25),
    waterLevel: new Uint8Array(25),
  };
}

describe('Canvas2D fallback map art', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('draws staff in their walking direction and advances their walk cycle', async () => {
    const snapshot = createSnapshot({ guests: 0, staff: 1, vehicles: 0, litter: 0 });
    snapshot.tick = 6;
    snapshot.staff.count = 1;
    snapshot.staff.data.set([0, 0, 0, 3 << 8]);
    const context = await renderWithAtlas(flatMap(), ['people/staff/0/direction-3'], snapshot);

    expect(context.spriteSources).toContain(2);
  });

  it('uses the saved paving style when drawing an ordinary path', () => {
    const map = flatMap();
    map.pathElements = Int32Array.of(2, 2, 0, 0, 0, PathStyle.CrazyPaving);
    map.pathCount = 1;

    expect(render(map).fills).toContain('#a9a193');
  });

  it('renders a roofed shelter on a path tile from the world sprite atlas', async () => {
    const map = flatMap();
    map.pathElements = Int32Array.of(2, 2, 0, PathFlag.Shelter, 0, PathStyle.Tarmac);
    map.pathCount = 1;

    const context = await renderWithAtlas(map, [
      'paths/tarmac/connection-00',
      'scenery/shelter/view-0',
    ]);

    expect(context.spriteSources).toEqual(expect.arrayContaining([1]));
  });

  it('draws intact and vandalised path additions at native frame size on flat and sloped paths', async () => {
    const rampSprites = Array.from(
      { length: 4 },
      (_, direction) => `paths/tarmac/ramp-${direction}`,
    );
    const cases = [
      { flag: PathFlag.Bench, data: 0, sprite: 'scenery/bench' },
      {
        flag: PathFlag.Bench,
        data: PATH_ADDITION_BROKEN,
        sprite: 'scenery/bench-broken',
      },
      { flag: PathFlag.Bin, data: 0, sprite: 'scenery/bin' },
      {
        flag: PathFlag.Bin,
        data: PATH_ADDITION_BROKEN,
        sprite: 'scenery/bin-broken',
      },
      { flag: PathFlag.Lamp, data: 0, sprite: 'scenery/lamp' },
      {
        flag: PathFlag.Lamp,
        data: PATH_ADDITION_BROKEN,
        sprite: 'scenery/lamp-broken',
      },
    ];

    for (const item of cases) {
      for (let rotation = 0; rotation < 4; rotation++) {
        const pivotRows: number[] = [];
        for (const sloped of [false, true]) {
          const edgeCenters: number[] = [];
          const map = flatMap();
          const flags = item.flag | 0b0101 | (sloped ? PathFlag.Sloped : 0);
          map.pathElements = Int32Array.of(2, 2, 0, flags, item.data, PathStyle.Tarmac);
          map.pathCount = 1;
          const names = Array.from({ length: 4 }, (_, view) => `${item.sprite}/view-${view}`);
          const context = await renderWithAtlas(map, [...rampSprites, ...names], null, {
            x: 0,
            y: 0,
            zoom: 1,
            rotation: rotation as 0 | 1 | 2 | 3,
          });
          const additions = context.images.filter(
            (args) =>
              Number(args[1]) > rampSprites.length && Number(args[1]) <= rampSprites.length + 4,
          );
          expect(additions, `${item.sprite} sloped=${sloped}`).toHaveLength(2);
          for (const addition of additions) {
            const view = Number(addition[1]) - rampSprites.length - 1;
            const width = STUB_FRAME.width;
            const height = STUB_FRAME.height;
            expect(addition.slice(-2), `${item.sprite} view=${view}`).toEqual([width, height]);
            edgeCenters.push((addition[5] as number) + width / 2);
            pivotRows.push((addition[6] as number) + height);
          }
          expect(edgeCenters, `${item.sprite} edge placement`).toHaveLength(2);
        }
        const flatPivots = pivotRows.slice(0, 2).sort((a, b) => a - b);
        const slopedPivots = pivotRows.slice(2, 4).sort((a, b) => a - b);
        expect(flatPivots.map((pivot, index) => pivot - slopedPivots[index]!)).toEqual([8, 8]);
      }
    }
  });

  it.each([
    ['straight', 0b0101, 2],
    ['corner', 0b0011, 2],
    ['T-junction', 0b0111, 1],
    ['crossroads', 0b1111, 0],
    ['dead-end', 0b0001, 3],
  ])('draws %s benches on every open edge in all rotations', async (_shape, edges, count) => {
    for (let rotation = 0; rotation < 4; rotation++) {
      const map = flatMap();
      map.pathElements = Int32Array.of(2, 2, 0, PathFlag.Bench | edges, 0, PathStyle.Tarmac);
      map.pathCount = 1;
      const names = Array.from({ length: 4 }, (_, view) => `scenery/bench/view-${view}`);
      const context = await renderWithAtlas(map, ['paths/tarmac/connection-00', ...names], null, {
        x: 0,
        y: 0,
        zoom: 1,
        rotation: rotation as 0 | 1 | 2 | 3,
      });
      const benches = context.images.filter((args) => Number(args[1]) > 1);
      expect(benches, `rotation ${rotation}`).toHaveLength(count);
      const spots = new Set(benches.map((args) => `${args[5]},${args[6]}`));
      expect(spots.size).toBe(count);
    }
  });

  it('draws four lamp posts on a crossroads in all rotations', async () => {
    for (let rotation = 0; rotation < 4; rotation++) {
      const map = flatMap();
      map.pathElements = Int32Array.of(2, 2, 0, PathFlag.Lamp | 0b1111, 0, PathStyle.Tarmac);
      map.pathCount = 1;
      const names = Array.from({ length: 4 }, (_, view) => `scenery/lamp/view-${view}`);
      const context = await renderWithAtlas(map, ['paths/tarmac/connection-00', ...names], null, {
        x: 0,
        y: 0,
        zoom: 1,
        rotation: rotation as 0 | 1 | 2 | 3,
      });
      expect(context.images.filter((args) => Number(args[1]) > 1)).toHaveLength(4);
    }
  });

  it('draws placeable trees as visible scenery elements', () => {
    const map = flatMap();
    map.sceneryElements = Int32Array.of(2, 2, 0, 0, SceneryItem.OakTree);
    map.sceneryCount = 1;

    expect(render(map).arcs).toContain('#397b35');
  });

  it('draws placed trees from the world atlas when its tree sprite is available', () => {
    const map = flatMap();
    map.sceneryElements = Int32Array.of(2, 2, 0, 0, SceneryItem.OakTree);
    map.sceneryCount = 1;
    const context = new RecordingContext();
    const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
    const renderer = new Canvas2DRenderer();
    renderer.attach(canvas);
    renderer.resize(800, 600, 1);
    renderer.setMap(map);
    const atlas: CanvasAtlas = new SpritePages();
    atlas.install(
      {
        pages: [{ file: 'atlas/world-0.png', width: 256, height: 128, category: 'world' }],
        categories: { world: { lazy: false, pages: [0] } },
        sprites: {
          'trees/tree-oak': {
            category: 'world',
            frames: [{ page: 0, x: 40, y: 0, width: 128, height: 105 }],
            anchor: { x: 64, y: 105 },
            footprint: { width: 1, height: 1 },
          },
        },
      },
      new Map([[0, {} as ImageBitmap]]),
    );
    (renderer as unknown as { atlas: CanvasAtlas }).atlas = atlas;

    renderer.draw(null, { x: 0, y: 0, zoom: 1, rotation: 0 });

    expect(context.spriteSources).toContain(40);
    expect(context.arcs).toEqual([]);
  });

  it('draws placed scenery trees inside the same catalog box used by WebGL2', async () => {
    const map = flatMap();
    map.sceneryElements = Int32Array.of(2, 2, 0, 0, SceneryItem.OakTree);
    map.sceneryCount = 1;

    const context = await renderWithAtlas(map, ['trees/tree-oak']);
    const image = context.images.find((args) => args[1] === 1);
    const definition = SCENERY_CATALOG[SceneryItem.OakTree]!;

    expect(image?.slice(-2)).toEqual([definition.width, definition.height * 12]);
  });

  it('renders scenery placement previews in the same screen rect as placed scenery on slopes', async () => {
    vi.stubGlobal('document', {
      createElement: (tag: string) =>
        tag === 'canvas'
          ? {
              width: 0,
              height: 0,
              getContext: () => ({ drawImage: () => {}, fillRect: () => {} }),
            }
          : {
              hidden: true,
              dataset: {},
              style: {},
              setAttribute: () => {},
              remove: () => {},
            },
    });
    const tileX = 2;
    const tileY = 2;
    const tile = tileY * 5 + tileX;
    for (let item = 0; item < SCENERY_CATALOG.length; item++) {
      for (let rotation = 0; rotation < 4; rotation++) {
        for (const zoom of [0.5, 1, 2]) {
          const map = flatMap();
          map.heights.fill(2);
          map.slope[tile] = 0b0110;
          map.sceneryElements = Int32Array.of(tileX, tileY, 0, 0, item);
          map.sceneryCount = 1;
          const definition = SCENERY_CATALOG[item]!;
          const key =
            definition.sprite === 'flower-bed'
              ? flowerBedSpriteName(tileX, tileY, rotation, map.slope[tile]!)
              : scenerySpriteName(definition.sprite);
          const placed = await renderWithAtlas(map, [key], null, {
            x: 0,
            y: 0,
            zoom,
            rotation: rotation as 0 | 1 | 2 | 3,
          });

          const preview = new ScenerySpotPreview(
            { append: () => {} } as never,
            {
              previewScenery: async () => SceneryResult.Ok,
            } as never,
          );
          const hover = {
            x: tileX,
            y: tileY,
            level: 2,
            slopeMask: map.slope[tile]!,
            item: item as SceneryItem,
            rotation: (rotation + 1) % 4,
            viewRotation: rotation,
            clientX: 0,
            clientY: 0,
          };
          preview.update(hover, 0);
          await Promise.resolve();
          const ghost = preview.update(hover, 0)!;
          expect(ghost).not.toBeNull();
          const previewMap = flatMap();
          previewMap.heights.fill(2);
          previewMap.slope[tile] = 0b0110;
          const previewDraw = await renderWithAtlas(
            previewMap,
            [key],
            null,
            { x: 0, y: 0, zoom, rotation: rotation as 0 | 1 | 2 | 3 },
            [ghost],
          );
          const { width: boxWidth, height: boxHeight } =
            definition.sprite === 'flower-bed' ? STUB_FRAME : sceneryBox(definition);
          const placedRect = screenRect(placed, boxWidth, boxHeight);
          const ghostRect = screenRect(previewDraw, boxWidth, boxHeight);
          expect(placedRect, `placed ${key} rotation=${rotation} zoom=${zoom}`).toBeDefined();
          expect(ghostRect, `preview ${key} rotation=${rotation} zoom=${zoom}`).toBeDefined();
          expect(ghostRect, `${key} rotation=${rotation} zoom=${zoom}`).toEqual(placedRect);
          preview.dispose();
        }
      }
    }
  });

  it('draws open-edge path addition previews from the source path tile', async () => {
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {}, fillRect: () => {} }),
      }),
    });
    const map = flatMap();
    map.pathElements = Int32Array.of(2, 2, 0, 0b0101, 0, PathStyle.Tarmac);
    map.pathCount = 1;
    const ghosts = pathAdditionPreviewGhosts(map, 2, 2, 'bench', 0);
    const context = await renderWithAtlas(
      map,
      [
        'paths/tarmac/connection-00',
        ...Array.from({ length: 4 }, (_, view) => `scenery/bench/view-${view}`),
      ],
      null,
      { x: 0, y: 0, zoom: 1, rotation: 0 },
      ghosts,
    );

    const previewImages = context.images.filter(
      (args) => args.length === 9 && args[7] === STUB_FRAME.width && args[8] === STUB_FRAME.height,
    );
    expect(previewImages).toHaveLength(2);
  });

  it('renders flowerbed previews at the placed flowerbed rect on sloped tiles in every view', async () => {
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {}, fillRect: () => {} }),
      }),
    });
    const tileX = 2;
    const tileY = 2;
    const tile = tileY * 5 + tileX;
    for (let rotation = 0; rotation < 4; rotation++) {
      for (const zoom of [0.5, 1, 2]) {
        const map = flatMap();
        map.heights.fill(2);
        map.slope[tile] = 0b0110;
        const snapshot = createSnapshot({
          guests: 0,
          staff: 0,
          vehicles: 0,
          litter: 0,
          mapTiles: 25,
        });
        snapshot.grounds[tile] = FLOWER_BED;
        const ghost = flowerbedPreviewGhost(tileX, tileY, 2, map.slope[tile]!, rotation);
        const key = flowerBedSpriteName(tileX, tileY, rotation, map.slope[tile]!);
        const placed = await renderWithAtlas(map, [key], snapshot, {
          x: 0,
          y: 0,
          zoom,
          rotation: rotation as 0 | 1 | 2 | 3,
        });
        const preview = await renderWithAtlas(
          map,
          [key],
          null,
          { x: 0, y: 0, zoom, rotation: rotation as 0 | 1 | 2 | 3 },
          [ghost],
        );
        const placedRect = screenRect(placed, STUB_FRAME.width, STUB_FRAME.height);
        const previewRect = screenRect(preview, STUB_FRAME.width, STUB_FRAME.height);
        expect(placedRect, `placed rotation=${rotation} zoom=${zoom}`).toBeDefined();
        expect(previewRect, `preview rotation=${rotation} zoom=${zoom}`).toBeDefined();
        expect(previewRect, `rotation=${rotation} zoom=${zoom}`).toEqual(placedRect);
      }
    }
  });

  it('draws queue rails over queue paths', () => {
    const map = flatMap();
    map.pathElements = Int32Array.of(2, 2, 0, PathFlag.Queue, 0, PathStyle.Tarmac);
    map.pathCount = 1;

    expect(render(map).fills).toContain('#d7bb65');
  });

  it('draws the generated flat grass and sand sprites when the atlas is available', () => {
    const map = flatMap();
    map.surface.fill(0);
    map.surface[12] = 1;
    const context = new RecordingContext();
    const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
    const renderer = new Canvas2DRenderer();
    renderer.attach(canvas);
    renderer.resize(800, 600, 1);
    renderer.setMap(map);
    const atlas: CanvasAtlas = new SpritePages();
    atlas.install(
      {
        pages: [{ file: 'atlas/world-0.png', width: 128, height: 64, category: 'world' }],
        categories: { world: { lazy: false, pages: [0] } },
        sprites: {
          'terrain/grass/surface': {
            category: 'world',
            frames: [{ page: 0, x: 10, y: 0, width: 64, height: 32 }],
            anchor: { x: 32, y: 16 },
            footprint: { width: 1, height: 1 },
          },
          'terrain/sand/surface': {
            category: 'world',
            frames: [{ page: 0, x: 20, y: 0, width: 64, height: 32 }],
            anchor: { x: 32, y: 16 },
            footprint: { width: 1, height: 1 },
          },
        },
      },
      new Map([[0, {} as ImageBitmap]]),
    );
    (renderer as unknown as { atlas: CanvasAtlas }).atlas = atlas;

    renderer.draw(null, { x: 0, y: 0, zoom: 1, rotation: 0 });

    expect(context.spriteSources).toContain(10);
    expect(context.spriteSources).toContain(20);
  });

  it('draws rock cliff faces with the camera-facing directional sprite', async () => {
    const map = flatMap();
    map.heights.fill(3);
    map.heights[13] = 0;
    map.surface[12] = 5;
    map.slope[12] = 0b0010;
    const cliffNames = [0, 1, 2, 3].map((direction) => `terrain/rock/cliff-face-${direction}`);

    for (let rotation = 0; rotation < 4; rotation++) {
      const context = await renderWithAtlas(map, ['terrain/rock/surface', ...cliffNames], null, {
        x: 0,
        y: 0,
        zoom: 1,
        rotation: rotation as 0 | 1 | 2 | 3,
      });

      expect(context.spriteSources).toContain(rotation + 2);
      if (rotation === 0)
        expect(context.spriteSources.filter((source) => source === 2)).toHaveLength(2);
    }
  });

  it('textures sloped rock surfaces with the generated rock sprite', async () => {
    const map = flatMap();
    map.surface[12] = 5;
    map.slope[12] = 0b0011;

    const context = await renderWithAtlas(map, ['terrain/rock/surface']);

    expect(context.spriteSources).toContain(1);
  });

  it('draws placeable scenery from its catalog sprite once the atlas has loaded', async () => {
    const map = flatMap();
    map.sceneryElements = Int32Array.of(2, 2, 0, 0, SceneryItem.OakTree);
    map.sceneryCount = 1;

    const context = await renderWithAtlas(map, ['trees/tree-oak']);

    expect(context.images).toHaveLength(1);
    expect(context.arcs).not.toContain('#397b35');
  });

  it('draws palm or cactus ambient scenery on sandy ground', async () => {
    const map = flatMap();
    map.surface.fill(1);
    const x = 4;
    const y = 1;
    const camera = { x: (x - y) * 32, y: (x + y) * 16, zoom: 1, rotation: 0 as const };
    const context = await renderWithAtlas(
      map,
      ['trees/tree-palm', 'trees/tree-cactus'],
      null,
      camera,
    );

    expect(context.images).toHaveLength(1);
    expect([1, 2, 3]).toContain(context.spriteSources[0]);
    expect(context.spriteSources).not.toContain(0);
  });
});

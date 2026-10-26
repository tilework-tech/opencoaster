import { describe, expect, it } from 'vitest';
import { PATH_ADDITION_BROKEN, PathFlag, PathStyle } from '../sim/map/tile-map';
import { SceneryItem } from '../sim/map/scenery';
import { SCENERY_CATALOG } from '../sim/map/scenery';
import { Canvas2DRenderer } from './canvas2d-renderer';
import type { CanvasAtlas } from './canvas-atlas';
import { createSnapshot } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import type { MapData } from './renderer';
import { SpritePages, spritePages } from './sprite-pages';
import type { PageImage, SpriteEntry } from './sprite-pages';

class RecordingContext {
  readonly canvas = { width: 1, height: 1 };
  readonly fills: string[] = [];
  readonly arcs: string[] = [];
  readonly spriteSources: number[] = [];
  readonly images: unknown[][] = [];
  imageSmoothingEnabled = true;
  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;

  setTransform(): void {}

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
    this.spriteSources.push(args[1] as number);
  }
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

function installStubAtlas(names: string[]): void {
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
  spritePages.install(
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
): Promise<RecordingContext> {
  const context = new RecordingContext();
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  const renderer = new Canvas2DRenderer();
  installStubAtlas(names);
  renderer.attach(canvas);
  renderer.resize(800, 600, 1);
  renderer.setMap(map);
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

    expect(context.spriteSources).toEqual(expect.arrayContaining([1, 2]));
  });

  it('draws intact and vandalised path additions in the shared box on flat and sloped paths', async () => {
    const rampSprites = Array.from(
      { length: 4 },
      (_, direction) => `paths/tarmac/ramp-${direction}`,
    );
    const cases = [
      { flag: PathFlag.Bench, data: 0, sprite: 'scenery/bench', width: 30, height: 18 },
      {
        flag: PathFlag.Bench,
        data: PATH_ADDITION_BROKEN,
        sprite: 'scenery/bench-broken/view-0',
        width: 30,
        height: 18,
      },
      { flag: PathFlag.Bin, data: 0, sprite: 'scenery/bin', width: 18, height: 26 },
      {
        flag: PathFlag.Bin,
        data: PATH_ADDITION_BROKEN,
        sprite: 'scenery/bin-broken/view-0',
        width: 18,
        height: 26,
      },
      { flag: PathFlag.Lamp, data: 0, sprite: 'scenery/lamp', width: 16, height: 32 },
      {
        flag: PathFlag.Lamp,
        data: PATH_ADDITION_BROKEN,
        sprite: 'scenery/lamp-broken/view-0',
        width: 16,
        height: 32,
      },
      {
        flag: PathFlag.Shelter,
        data: 0,
        sprite: 'scenery/shelter/view-0',
        width: 54,
        height: 52,
      },
    ];

    for (const item of cases) {
      for (let rotation = 0; rotation < 4; rotation++) {
        const sprite = item.sprite.replace('/view-0', `/view-${rotation}`);
        const pivotRows: number[] = [];
        for (const sloped of [false, true]) {
          const map = flatMap();
          const flags = item.flag | (sloped ? PathFlag.Sloped : 0);
          map.pathElements = Int32Array.of(2, 2, 0, flags, item.data, PathStyle.Tarmac);
          map.pathCount = 1;
          const context = await renderWithAtlas(map, [...rampSprites, sprite], null, {
            x: 0,
            y: 0,
            zoom: 1,
            rotation: rotation as 0 | 1 | 2 | 3,
          });
          const addition = context.images.find((args) => args[1] === rampSprites.length + 1);

          expect(addition?.slice(-2), `${sprite} sloped=${sloped}`).toEqual([
            item.width,
            item.height,
          ]);
          expect(addition?.[5], `${sprite} horizontal centering`).toBe(-item.width / 2);
          pivotRows.push((addition?.[6] as number) + item.height);
        }
        expect(pivotRows[0]! - pivotRows[1]!, `${sprite} ramp centre elevation`).toBe(7.75);
      }
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

import { describe, expect, it } from 'vitest';
import { PathFlag, PathStyle } from '../sim/map/tile-map';
import { SceneryItem } from '../sim/map/scenery';
import { Canvas2DRenderer } from './canvas2d-renderer';
import type { CanvasAtlas } from './canvas-atlas';
import type { MapData } from './renderer';
import { SpritePages } from './sprite-pages';

class RecordingContext {
  readonly canvas = { width: 1, height: 1 };
  readonly fills: string[] = [];
  readonly arcs: string[] = [];
  readonly spriteSources: number[] = [];
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

  drawImage(_image: CanvasImageSource, x: number): void {
    this.spriteSources.push(x);
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
  it('uses the saved paving style when drawing an ordinary path', () => {
    const map = flatMap();
    map.pathElements = Int32Array.of(2, 2, 0, 0, 0, PathStyle.CrazyPaving);
    map.pathCount = 1;

    expect(render(map).fills).toContain('#a9a193');
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
});

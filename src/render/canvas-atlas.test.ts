import { describe, expect, it, vi } from 'vitest';
import { drawAnchoredSprite, drawTileTexture } from './canvas-atlas';
import type { CanvasAtlas } from './canvas-atlas';
import { SpritePages } from './sprite-pages';

const image = {} as ImageBitmap;
const atlas: CanvasAtlas = new SpritePages('/sprites/');
atlas.install(
  {
    pages: [
      { file: 'atlas/world-0.png', width: 128, height: 128, category: 'world' },
      { file: 'atlas/vehicles-0.png', width: 64, height: 64, category: 'vehicles' },
    ],
    categories: {
      world: { lazy: false, pages: [0] },
      vehicles: { lazy: true, pages: [1] },
    },
    sprites: {
      'paths/tarmac/connection-00': {
        category: 'world',
        frames: [{ page: 0, x: 10, y: 20, width: 64, height: 36 }],
        anchor: { x: 32, y: 18 },
        footprint: { width: 1, height: 1 },
        native: true,
      },
      'water/surface': {
        category: 'world',
        frames: [
          { page: 0, x: 0, y: 0, width: 32, height: 32 },
          { page: 0, x: 0, y: 32, width: 32, height: 32 },
        ],
        anchor: { x: 0, y: 0 },
        footprint: { width: 1, height: 1 },
      },
      'vehicles/car': {
        category: 'vehicles',
        frames: [{ page: 1, x: 0, y: 0, width: 8, height: 8 }],
        anchor: { x: 4, y: 8 },
        footprint: { width: 1, height: 1 },
        native: true,
      },
    },
  },
  new Map([[0, image]]),
);

function fakeContext() {
  return {
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    transform: vi.fn(),
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D & {
    drawImage: ReturnType<typeof vi.fn>;
    transform: ReturnType<typeof vi.fn>;
  };
}

describe('canvas sprite helpers', () => {
  it('draws a native sprite with its anchor pixel on the requested point', () => {
    const ctx = fakeContext();
    expect(drawAnchoredSprite(ctx, atlas, 'paths/tarmac/connection-00', 100, 50)).toBe(true);
    expect(ctx.drawImage).toHaveBeenCalledWith(image, 10, 20, 64, 36, 68, 32, 64, 36);
  });

  it('selects an animation frame with a #n key suffix', () => {
    const ctx = fakeContext();
    expect(drawAnchoredSprite(ctx, atlas, 'water/surface#1', 10, 20)).toBe(true);
    expect(ctx.drawImage).toHaveBeenCalledWith(atlas.image, 0, 32, 32, 32, 10, 20, 32, 32);
  });

  it('reports missing sprites so callers can fall back to procedural drawing', () => {
    expect(drawAnchoredSprite(fakeContext(), atlas, 'paths/none', 0, 0)).toBe(false);
    expect(drawTileTexture(fakeContext(), atlas, 'water/none', 0, 0, 0, 64, 32)).toBe(false);
  });

  it('does not draw sprites whose category page has not loaded', () => {
    const ctx = fakeContext();
    expect(drawAnchoredSprite(ctx, atlas, 'vehicles/car', 0, 0)).toBe(false);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(atlas.isLoaded('vehicles')).toBe(false);
  });

  it('maps a square water texture frame onto the tile diamond below its top vertex', () => {
    const ctx = fakeContext();
    expect(drawTileTexture(ctx, atlas, 'water/surface', 3, 10, 20, 64, 32)).toBe(true);
    expect(ctx.transform).toHaveBeenCalledWith(1, 0.5, -1, 0.5, 10, 20);
    expect(ctx.drawImage).toHaveBeenCalledWith(image, 0, 32, 32, 32, 0, 0, 32, 32);
  });
});

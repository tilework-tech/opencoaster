import { describe, expect, it, vi } from 'vitest';
import { drawAnchoredSprite, drawTileTexture } from './canvas-atlas';
import type { CanvasAtlas } from './canvas-atlas';

const atlas: CanvasAtlas = {
  image: {} as ImageBitmap,
  sprites: {
    'paths/tarmac/connection-00': {
      frames: [{ x: 10, y: 20, width: 64, height: 36 }],
      anchor: { x: 32, y: 18 },
      native: true,
    },
    'water/surface': {
      frames: [
        { x: 0, y: 0, width: 32, height: 32 },
        { x: 0, y: 32, width: 32, height: 32 },
      ],
      anchor: { x: 0, y: 0 },
    },
  },
};

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
    expect(ctx.drawImage).toHaveBeenCalledWith(atlas.image, 10, 20, 64, 36, 68, 32, 64, 36);
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

  it('maps a square water texture frame onto the tile diamond below its top vertex', () => {
    const ctx = fakeContext();
    expect(drawTileTexture(ctx, atlas, 'water/surface', 3, 10, 20, 64, 32)).toBe(true);
    expect(ctx.transform).toHaveBeenCalledWith(1, 0.5, -1, 0.5, 10, 20);
    expect(ctx.drawImage).toHaveBeenCalledWith(atlas.image, 0, 32, 32, 32, 0, 0, 32, 32);
  });
});

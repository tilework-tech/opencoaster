import { describe, expect, it } from 'vitest';
import { chunkRange, LruCache, tileChunkRange } from './ground-chunks';
import { TILE_H, TILE_W, Z_PIXELS, rotateTile } from './projection';
import type { Rotation } from './projection';

describe('chunkRange', () => {
  it('covers every chunk a rectangle touches', () => {
    expect(chunkRange(-10, 0, 520, 511, 512)).toEqual({ x0: -1, y0: 0, x1: 1, y1: 0 });
  });

  it('puts a rectangle that ends exactly on a chunk boundary in the earlier chunk', () => {
    expect(chunkRange(0, 0, 512, 512, 512)).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
  });

  it('handles rectangles at negative coordinates', () => {
    expect(chunkRange(-1100, -600, -1, -1, 512)).toEqual({ x0: -3, y0: -2, x1: -1, y1: -1 });
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entry beyond capacity and reports it', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string>(2, (value) => evicted.push(value));
    cache.set(1, 'a');
    cache.set(2, 'b');
    expect(cache.get(1)).toBe('a');
    cache.set(3, 'c');
    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(1)).toBe('a');
    expect(cache.get(3)).toBe('c');
    expect(evicted).toEqual(['b']);
  });

  it('keeps more entries after its capacity is raised', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string>(1, (value) => evicted.push(value));
    cache.capacity = 3;
    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.set(3, 'c');
    expect(evicted).toEqual([]);
    expect(cache.get(1)).toBe('a');
  });

  it('reports every entry when cleared', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string>(4, (value) => evicted.push(value));
    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.clear();
    expect(evicted.sort()).toEqual(['a', 'b']);
    expect(cache.get(1)).toBeUndefined();
  });

  it('reports a replaced entry and can delete one explicitly', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string>(4, (value) => evicted.push(value));
    cache.set(1, 'a');
    cache.set(1, 'b');
    cache.delete(1);
    expect(evicted).toEqual(['a', 'b']);
    expect(cache.get(1)).toBeUndefined();
  });
});

describe('tileChunkRange', () => {
  const SIZE = 512;
  const scratch = new Float64Array(2);

  it('covers the whole drawn diamond of every tile under every rotation', () => {
    const width = 40;
    const height = 36;
    for (const rotation of [0, 1, 2, 3] as Rotation[]) {
      for (let y = 0; y < height; y += 3) {
        for (let x = 0; x < width; x += 3) {
          for (const level of [0, 2, 7]) {
            const [rx, ry] = rotateTile(x, y, width, height, rotation);
            const top = (rx + ry) * (TILE_H / 2) - level * Z_PIXELS;
            const centre = (rx - ry) * (TILE_W / 2);
            const range = tileChunkRange(x, y, level, width, height, rotation, SIZE, scratch);
            const vertices = [
              [centre, top],
              [centre + TILE_W / 2, top + TILE_H / 2],
              [centre, top + TILE_H],
              [centre - TILE_W / 2, top + TILE_H / 2],
            ];
            for (const [vx, vy] of vertices) {
              expect(Math.floor(vx / SIZE)).toBeGreaterThanOrEqual(range.x0);
              expect(Math.floor(vx / SIZE)).toBeLessThanOrEqual(range.x1);
              expect(Math.floor(vy / SIZE)).toBeGreaterThanOrEqual(range.y0);
              expect(Math.floor(vy / SIZE)).toBeLessThanOrEqual(range.y1);
            }
          }
        }
      }
    }
  });
});

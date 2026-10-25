import { TILE_UNITS } from '../sim/core/constants';
import { Z_PIXELS, project } from './projection';
import type { Rotation } from './projection';

export interface ChunkRange {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Inclusive chunk coordinates touched by the world-pixel rectangle `[left, right) x [top, bottom)`. */
export function chunkRange(
  left: number,
  top: number,
  right: number,
  bottom: number,
  size: number,
): ChunkRange {
  return {
    x0: Math.floor(left / size),
    y0: Math.floor(top / size),
    x1: Math.ceil(right / size) - 1,
    y1: Math.ceil(bottom / size) - 1,
  };
}

/**
 * Chunks touched by a tile's terrain, slopes and path fill. The tile's four map corners are
 * projected under the current rotation so the extent is right whichever diamond vertex a corner
 * becomes. Tiles on the map boundary also own cliff faces that hang down to sea level, and a
 * neighbour's height change can reshape those, so their extent reaches the ground plane.
 * Rock tiles with internal cliff faces also extend down to the ground plane.
 */
export function tileChunkRange(
  x: number,
  y: number,
  tileHeight: number,
  width: number,
  height: number,
  rotation: Rotation,
  chunkSize: number,
  scratch: Float64Array,
  extendsToGround = false,
): ChunkRange {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (let corner = 0; corner < 4; corner++) {
    project(
      (x + (corner & 1)) * TILE_UNITS,
      (y + (corner >> 1)) * TILE_UNITS,
      tileHeight * 64,
      width,
      height,
      rotation,
      scratch,
    );
    left = Math.min(left, scratch[0]);
    right = Math.max(right, scratch[0]);
    top = Math.min(top, scratch[1]);
    bottom = Math.max(bottom, scratch[1]);
  }
  const extendsDown = extendsToGround || x === 0 || y === 0 || x === width - 1 || y === height - 1;
  return chunkRange(
    left - 2,
    top - Z_PIXELS - 2,
    right + 2,
    bottom + 2 + (extendsDown ? (tileHeight + 1) * Z_PIXELS : 0),
    chunkSize,
  );
}

/** Least-recently-used map with a hook for releasing evicted values (e.g. GPU textures). */
export class LruCache<T> {
  private readonly entries = new Map<number, T>();

  constructor(
    public capacity: number,
    private readonly release: (value: T) => void,
  ) {}

  get(key: number): T | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: number, value: T): void {
    this.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as number;
      this.delete(oldest);
    }
  }

  delete(key: number): void {
    const value = this.entries.get(key);
    if (value === undefined) return;
    this.entries.delete(key);
    this.release(value);
  }

  clear(): void {
    for (const value of this.entries.values()) this.release(value);
    this.entries.clear();
  }

  keys(): IterableIterator<number> {
    return this.entries.keys();
  }
}

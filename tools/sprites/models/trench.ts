import { ramp } from '../palette';
import type { Sprite } from '../raster';

const STONE = ramp('stone');
const GLOOM = ramp('gloom');
const DIRT = ramp('dirt');

/** Pixels per tile edge and per level in the isometric view. */
export const TRENCH_WALL_WIDTH = 32;
export const TRENCH_WALL_HEIGHT = 32;
export const TRENCH_ARCH_WIDTH = 24;
export const TRENCH_ARCH_HEIGHT = 16;
export const TRENCH_FLOOR_SIZE = 16;

function sprite(width: number, height: number, pixels: Uint8Array): Sprite {
  return { width, height, anchor: { x: 0, y: 0 }, pixels };
}

function hash(a: number, b: number): number {
  let h = Math.imul(a + 0x9e37, 0x85ebca6b) ^ Math.imul(b + 0x7f4a, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return (h ^ (h >>> 12)) >>> 0;
}

const COURSE = 4;
/** Block lengths per course; each row sums to the wall width so the pattern tiles. */
const BLOCKS: readonly (readonly number[])[] = [
  [11, 10, 11],
  [6, 10, 10, 6],
  [10, 12, 10],
  [8, 8, 8, 8],
];

/** Stone tone (0-4) of the block pixel at (x, y) of an ashlar pattern; `joint` marks mortar. */
function ashlar(
  x: number,
  y: number,
  width: number,
  seed: number,
): { tone: number; joint: boolean } {
  const course = Math.floor(y / COURSE);
  const row = y - course * COURSE;
  const lengths = BLOCKS[(course + seed) % BLOCKS.length]!;
  const total = lengths.reduce((a, b) => a + b, 0);
  const scaled = ((x % width) * total) / width;
  let start = 0;
  let index = 0;
  for (; index < lengths.length; index++) {
    if (scaled < start + lengths[index]!) break;
    start += lengths[index]!;
  }
  const column = scaled - start;
  const joint = row === COURSE - 1 || column < 1;
  const noise = hash(course * 7 + seed, index * 13 + start);
  let tone = 2 + (noise % 5 === 0 ? -1 : noise % 3 === 0 ? 1 : 0);
  if (row === 0 && !joint) tone += 1;
  return { tone: Math.max(0, Math.min(4, tone)), joint };
}

/**
 * A retaining wall seen face-on, one tile edge wide and two levels tall: a lighter coping course
 * at the top, then staggered ashlar courses. Tiles horizontally.
 */
export function trenchWallTexture(): Sprite {
  const w = TRENCH_WALL_WIDTH;
  const h = TRENCH_WALL_HEIGHT;
  const pixels = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let colour: number;
      if (y === 0) colour = STONE[4]!;
      else if (y === 1) colour = STONE[3]!;
      else if (y === 2) colour = STONE[0]!;
      else {
        const { tone, joint } = ashlar(x, y - 3, w, 0);
        colour = joint ? STONE[1]! : STONE[tone]!;
      }
      pixels[y * w + x] = colour;
    }
  return sprite(w, h, pixels);
}

/**
 * The headwall of a trench seen face-on, as wide as the cut and one level tall: a semicircular
 * arch of alternating voussoirs with a keystone, set in ashlar, over a mouth that darkens
 * toward its centre.
 */
export function trenchArchTexture(): Sprite {
  const w = TRENCH_ARCH_WIDTH;
  const h = TRENCH_ARCH_HEIGHT;
  const pixels = new Uint8Array(w * h);
  const cx = w / 2;
  const cy = 8;
  const inner = 5;
  const outer = 8;
  const bins = 5;
  const tones = [3, 2, 4, 2, 3];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const above = dy < 0;
      const radius = above ? Math.hypot(dx, dy) : Math.abs(dx);
      let colour: number;
      if (radius < inner) {
        const edge = inner - radius;
        const shade = edge < 1.1 ? 2 : edge < 2.4 ? 1 : 0;
        colour = GLOOM[Math.min(3, shade + (y > h - 3 ? 1 : 0))]!;
      } else if (radius < outer) {
        if (above) {
          const along = ((Math.atan2(dx, -dy) + Math.PI / 2) / Math.PI) * bins;
          const bin = Math.min(bins - 1, Math.floor(along));
          const joint = along - bin < 0.12 || bin + 1 - along < 0.12;
          colour = STONE[joint ? 1 : tones[bin]!]!;
        } else {
          const along = (y - cy) / 3;
          const course = Math.floor(along);
          colour = STONE[along - course < 0.34 ? 1 : course % 2 === 0 ? 3 : 4]!;
        }
      } else {
        const { tone, joint } = ashlar(x, y, w, 1);
        colour = joint ? STONE[0]! : STONE[Math.max(1, Math.min(2, tone - 1))]!;
      }
      pixels[y * w + x] = colour;
    }
  return sprite(w, h, pixels);
}

/** Packed gravel of the cut's floor, seen from above; tiles in both directions. */
export function trenchFloorTexture(): Sprite {
  const n = TRENCH_FLOOR_SIZE;
  const pixels = new Uint8Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const noise = hash(x, y) % 10;
      pixels[y * n + x] = DIRT[noise < 2 ? 1 : noise < 8 ? 2 : 3]!;
    }
  return sprite(n, n, pixels);
}

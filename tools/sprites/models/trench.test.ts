import { describe, expect, it } from 'vitest';
import {
  TRENCH_ARCH_LEVELS,
  TRENCH_ARCH_TEXTURE_HEIGHT,
  TRENCH_ARCH_TEXTURE_WIDTH,
  TRENCH_WALL_TEXTURE_HEIGHT,
  TRENCH_WALL_TEXTURE_WIDTH,
} from '../../../src/render/trench-geometry';
import { Z_PIXELS } from '../../../src/render/projection';
import { ramp } from '../palette';
import {
  TRENCH_ARCH_SUPERSAMPLE,
  trenchArchTexture,
  trenchFloorTexture,
  trenchWallTexture,
} from './trench';

describe('trench textures', () => {
  it('are the sizes the terrain renderers map them with', () => {
    const arch = trenchArchTexture();
    expect([arch.width, arch.height]).toEqual([
      TRENCH_ARCH_TEXTURE_WIDTH,
      TRENCH_ARCH_TEXTURE_HEIGHT,
    ]);
    const wall = trenchWallTexture();
    expect([wall.width, wall.height]).toEqual([
      TRENCH_WALL_TEXTURE_WIDTH,
      TRENCH_WALL_TEXTURE_HEIGHT,
    ]);
    expect(arch.height / TRENCH_ARCH_SUPERSAMPLE / Z_PIXELS).toBe(TRENCH_ARCH_LEVELS);
  });

  it('open the arch onto a dark mouth under a coping course', () => {
    const arch = trenchArchTexture();
    const stone = new Set(ramp('stone'));
    const gloom = new Set(ramp('gloom'));
    const at = (x: number, y: number) => arch.pixels[y * arch.width + x]!;
    const k = TRENCH_ARCH_SUPERSAMPLE;
    expect(gloom.has(at(arch.width / 2, arch.height - 1))).toBe(true);
    expect(gloom.has(at(arch.width / 2, 6 * k))).toBe(true);
    for (let x = 0; x < arch.width; x++) expect(stone.has(at(x, 0))).toBe(true);
  });

  it('open a mouth wide enough for the track, most of the headwall across', () => {
    const arch = trenchArchTexture();
    const gloom = new Set(ramp('gloom'));
    const bottom = arch.height - 1;
    let mouth = 0;
    for (let x = 0; x < arch.width; x++)
      if (gloom.has(arch.pixels[bottom * arch.width + x]!)) mouth++;
    expect(mouth / arch.width).toBeGreaterThanOrEqual(0.62);
  });

  it('keep the wall, floor and arch to their ramps and the wall to its coping course', () => {
    const wall = trenchWallTexture();
    const stone = ramp('stone');
    expect(wall.pixels.every((p) => stone.includes(p))).toBe(true);
    for (let x = 0; x < wall.width; x++) expect(wall.pixels[x]).toBe(stone[4]);
    const floor = trenchFloorTexture();
    expect(floor.pixels.every((p) => ramp('dirt').includes(p))).toBe(true);
  });
});

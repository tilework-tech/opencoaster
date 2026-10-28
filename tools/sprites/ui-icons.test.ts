import { describe, expect, it } from 'vitest';
import { ICON_NAMES } from '../../src/ui/icons';
import { renderUiIconSprite } from './ui-icons';
import { TRANSPARENT } from './raster';

function componentSizes(pixels: Uint8Array, size: number): number[] {
  const seen = new Set<number>();
  const sizes: number[] = [];
  for (let start = 0; start < pixels.length; start++) {
    if (pixels[start] === TRANSPARENT || seen.has(start)) continue;
    const pending = [start];
    seen.add(start);
    let count = 0;
    while (pending.length) {
      const index = pending.pop()!;
      count++;
      const x = index % size;
      const y = Math.floor(index / size);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          const next = ny * size + nx;
          if (
            (dx || dy) &&
            nx >= 0 &&
            ny >= 0 &&
            nx < size &&
            ny < size &&
            pixels[next] !== TRANSPARENT &&
            !seen.has(next)
          ) {
            seen.add(next);
            pending.push(next);
          }
        }
    }
    sizes.push(count);
  }
  return sizes;
}

describe('generated UI icons', () => {
  it('renders every registered icon at both native pixel sizes', () => {
    for (const name of ICON_NAMES) {
      for (const size of [16, 24] as const) {
        const sprite = renderUiIconSprite(name, size);
        expect(sprite.width, `${name} width`).toBe(size);
        expect(sprite.height, `${name} height`).toBe(size);
        expect(
          sprite.pixels.some((pixel) => pixel !== TRANSPARENT),
          `${name} art`,
        ).toBe(true);
        const edge = [
          ...sprite.pixels.slice(0, size),
          ...sprite.pixels.slice(-size),
          ...Array.from({ length: size }, (_, index) => sprite.pixels[index * size]),
          ...Array.from({ length: size }, (_, index) => sprite.pixels[index * size + size - 1]),
        ];
        expect(
          edge.every((pixel) => pixel === TRANSPARENT),
          `${name} clear icon bounds`,
        ).toBe(true);
      }
    }
  });

  it.each([
    'land',
    'water',
    'scenery',
    'paths',
    'rides',
    'newRide',
    'coaster',
    'carousel',
    'ship',
    'wheel',
    'twist',
    'park',
    'entrance',
    'staff',
    'guests',
    'finances',
    'cash',
    'research',
    'map',
    'food',
    'drink',
    'demolish',
    'sun',
    'cloud',
  ] as const)('%s fills the native icon cell with shaded pixel art', (name) => {
    const sprite = renderUiIconSprite(name, 24);
    let minX = 24;
    let minY = 24;
    let maxX = -1;
    let maxY = -1;
    sprite.pixels.forEach((color, index) => {
      if (color === TRANSPARENT) return;
      const x = index % 24;
      const y = Math.floor(index / 24);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const longestSide = Math.max(width, height);
    const shortestSide = Math.min(width, height);
    expect(longestSide, `${name} largest dimension`).toBeGreaterThanOrEqual(18);
    expect(longestSide, `${name} largest dimension`).toBeLessThanOrEqual(22);
    expect(shortestSide, `${name} smallest dimension`).toBeGreaterThanOrEqual(10);
    expect(
      new Set(sprite.pixels.filter((color) => color !== TRANSPARENT)).size,
      `${name} palette`,
    ).toBeGreaterThanOrEqual(3);
  });

  it('draws the paths icon as an isometric footpath segment about 22px wide', () => {
    const sprite = renderUiIconSprite('paths', 24);
    const xs: number[] = [];
    const ys: number[] = [];
    sprite.pixels.forEach((color, index) => {
      if (color === TRANSPARENT) return;
      xs.push(index % 24);
      ys.push(Math.floor(index / 24));
    });
    expect(Math.max(...xs) - Math.min(...xs) + 1).toBeGreaterThanOrEqual(20);
    expect(Math.max(...xs) - Math.min(...xs) + 1).toBeLessThanOrEqual(22);
    expect(Math.max(...ys) - Math.min(...ys) + 1).toBeGreaterThanOrEqual(14);
    expect(Math.max(...ys) - Math.min(...ys) + 1).toBeLessThanOrEqual(21);
  });

  it.each(['rotateLeft', 'water', 'scenery', 'finances'] as const)(
    'keeps %s free of detached single-pixel flecks',
    (name) => {
      for (const size of [16, 24] as const) {
        expect(
          componentSizes(renderUiIconSprite(name, size).pixels, size),
          `${name} at ${size}px`,
        ).not.toContain(1);
      }
    },
  );
});

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

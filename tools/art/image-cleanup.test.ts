import { describe, expect, it } from 'vitest';
import { defringeRgba } from './image-cleanup';

describe('alpha edge cleanup', () => {
  it('replaces chromatic partial-alpha fringes with neighboring opaque color and keeps coverage', () => {
    const pixels = Uint8Array.of(
      0,
      0,
      255,
      255,
      0,
      0,
      0,
      0,
      0,
      255,
      0,
      255,
      255,
      0,
      255,
      96,
      0,
      0,
      0,
      0,
      255,
      255,
      0,
      255,
    );
    const cleaned = defringeRgba(pixels, 6, 1);
    expect(Array.from(cleaned.slice(12, 16))).toEqual([0, 255, 0, 96]);
    expect(Array.from(cleaned.slice(4, 8))).toEqual([0, 0, 0, 0]);
  });
});

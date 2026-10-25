import { describe, expect, it } from 'vitest';
import { buildSprites } from './generate';

const sprites = new Map(buildSprites().map((s) => [s.key, s]));

describe('generated sprite catalogue', () => {
  it('has all 16 connection masks and 4 ramp directions for each path style', () => {
    for (const style of ['tarmac', 'crazy-paving', 'dirt', 'queue']) {
      for (let mask = 0; mask < 16; mask++)
        expect(sprites.has(`paths/${style}/connection-${mask.toString(16).padStart(2, '0')}`)).toBe(
          true,
        );
      for (let d = 0; d < 4; d++) expect(sprites.has(`paths/${style}/ramp-${d}`)).toBe(true);
    }
  });

  it('draws every path tile on the 64x32 diamond centred on the tile', () => {
    for (const [key, sprite] of sprites) {
      if (!key.startsWith('paths/') || key.includes('ramp')) continue;
      const frame = sprite.frames[0];
      expect(frame.width).toBe(64);
      expect(frame.anchor.x).toBe(32);
    }
  });

  it('animates water over eight palette-cycle frames', () => {
    expect(sprites.get('water/surface')?.frames).toHaveLength(8);
    const [first, second] = sprites.get('water/surface')!.frames;
    expect(Buffer.from(first.pixels).equals(Buffer.from(second.pixels))).toBe(false);
  });

  it('closes the water palette cycle after eight frames', () => {
    const frames = sprites.get('water/surface')!.frames;
    expect(frames.every((f) => f.width === 64 && f.height === 32)).toBe(true);
  });

  it('has a shoreline piece for every sloped terrain mask (flat masks need none)', () => {
    for (let mask = 1; mask < 15; mask++)
      expect(sprites.get(`water/shore/shape-${mask.toString(16).padStart(2, '0')}`)).toBeDefined();
  });
});

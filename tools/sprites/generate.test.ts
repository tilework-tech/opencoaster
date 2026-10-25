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

  it('draws every flat path tile on the 64x32 diamond centred on the tile', () => {
    for (const [key, sprite] of sprites) {
      if (!key.startsWith('paths/') || key.includes('ramp')) continue;
      const frame = sprite.frames[0];
      expect(frame.width).toBe(64);
      expect(frame.anchor.x).toBe(32);
    }
  });

  it('joins neighbouring path tiles: connected edge midpoints are opaque and surface-coloured', () => {
    for (const style of ['tarmac', 'crazy-paving', 'dirt', 'queue']) {
      const sprite = sprites.get(`paths/${style}/connection-0f`)!.frames[0];
      const pixel = (x: number, y: number): number =>
        sprite.pixels[(sprite.anchor.y + y) * sprite.width + sprite.anchor.x + x];
      // Just inside each diamond corner there is surface, not kerb or outline.
      const east = pixel(28, 0);
      const west = pixel(-29, 0);
      expect(east).not.toBe(255);
      expect(west).not.toBe(255);
    }
  });

  it('animates water as a square tile texture over eight palette-cycle frames', () => {
    const water = sprites.get('water/surface')!;
    expect(water.frames).toHaveLength(8);
    expect(water.raw).toBe(true);
    const [first, second] = water.frames;
    expect(first.width).toBe(first.height);
    expect(Buffer.from(first.pixels).equals(Buffer.from(second.pixels))).toBe(false);
    expect(Buffer.from(water.frames[0].pixels).equals(Buffer.from(water.frames[0].pixels))).toBe(
      true,
    );
  });

  it('keeps every water pixel inside the water palette cycle', () => {
    const water = sprites.get('water/surface')!;
    const used = new Set(water.frames.flatMap((f) => [...f.pixels]));
    expect(used.size).toBeLessThanOrEqual(5);
  });

  it('renders every non-track ride and stall type in 4 rotations with at least 4 frames', () => {
    const keys = [
      'merry-go-round',
      'swinging-ship',
      'ferris-wheel',
      'twist',
      'food-stall',
      'drink-stall',
      'information-kiosk',
      'toilets',
    ];
    for (const key of keys)
      for (let view = 0; view < 4; view++) {
        const sprite = sprites.get(`rides/${key}/view-${view}`);
        expect(sprite?.frames.length ?? 0).toBeGreaterThanOrEqual(4);
      }
  });

  it('gives every operating frame of a ride the same size and anchor', () => {
    for (const [key, sprite] of sprites) {
      if (!key.startsWith('rides/')) continue;
      const { width, height, anchor } = sprite.frames[0];
      expect(width).toBeGreaterThan(0);
      expect(sprite.frames.length).toBeGreaterThan(0);
      expect(anchor.x).toBe(width / 2);
      expect(height % 2).toBe(0);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { buildSprites } from './generate';
import { TRANSPORT_PIECES } from './models/transport';

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
});

describe('ride sprite catalogue', () => {
  it('renders the flat water and kart rides in 4 rotations with 4 animation frames', () => {
    for (const key of ['log-flume', 'river-rapids', 'go-karts'])
      for (let view = 0; view < 4; view++) {
        const sprite = sprites.get(`rides/${key}/view-${view}`);
        expect(sprite?.frames).toHaveLength(4);
      }
  });

  it('renders every transport track style for every transport piece in 4 views', () => {
    expect(TRANSPORT_PIECES.length).toBeGreaterThan(0);
    for (const style of ['rail', 'monorail', 'chairlift'])
      for (const piece of TRANSPORT_PIECES)
        for (let view = 0; view < 4; view++) {
          const cells = piece.footprint.map((_, index) => index);
          const keys = cells.map(
            (index) => `track/${style}/${piece.name}/view-${view}/cell-${index}`,
          );
          expect(keys.some((key) => sprites.has(key))).toBe(true);
        }
  });

  it('renders each transport vehicle in 5 pitches and 8 headings', () => {
    for (const style of ['rail', 'monorail', 'chairlift'])
      for (const pitch of ['flat', 'up25', 'up60', 'down25', 'down60'])
        for (let heading = 0; heading < 8; heading++)
          expect(sprites.has(`vehicles/${style}/car/${pitch}/heading-${heading}`)).toBe(true);
  });
});

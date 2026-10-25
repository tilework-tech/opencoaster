import { describe, expect, it } from 'vitest';
import { PIECES } from '../../src/sim/track/catalog';
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

  it('renders every catalog track piece in the wood and steel styles in 4 rotations, with a sprite on its centre cell', () => {
    for (const style of ['wood', 'steel'])
      for (const piece of PIECES)
        for (let view = 0; view < 4; view++) {
          const cells = piece.footprint
            .map((_, index) =>
              sprites.has(`track/${style}/${piece.name}/view-${view}/cell-${index}`),
            )
            .filter(Boolean);
          expect(cells.length, `${style} ${piece.name} view ${view}`).toBeGreaterThan(0);
        }
  });

  it('has support segments, quarter caps and a base for every family in 4 rotations', () => {
    for (const family of ['wood', 'steel', 'junior', 'mouse'])
      for (const part of ['column', 'cap1', 'cap2', 'cap3', 'base'])
        for (let view = 0; view < 4; view++)
          expect(sprites.has(`track/${family}/support-${part}/view-${view}`)).toBe(true);
  });

  it('has chain, brake and block-brake art for lift- and brake-capable pieces', () => {
    for (const art of ['wood', 'steel'])
      for (const variant of ['chain', 'brake', 'block'])
        for (let view = 0; view < 4; view++)
          expect(sprites.has(`track/${art}/flat+${variant}/view-${view}/cell-0`)).toBe(true);
    expect(sprites.get('track/wood/flat+chain/view-0/cell-0')?.frames).toHaveLength(2);
    expect(sprites.has('track/wood/smallLeft+chain/view-0/cell-0')).toBe(false);
  });

  it('has cars at 8 headings for every pitch and bank class of every family', () => {
    for (const family of ['wood', 'steel', 'junior', 'mouse'])
      for (const pitch of ['down90', 'down60', 'down25', 'flat', 'up25', 'up60', 'up90'])
        for (const bank of ['level', 'left', 'right', 'inverted'])
          for (let heading = 0; heading < 8; heading++)
            expect(sprites.has(`vehicles/${family}/car/${pitch}/${bank}/heading-${heading}`)).toBe(
              true,
            );
  });
});

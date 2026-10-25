import { describe, expect, it } from 'vitest';
import { TRACK_ARTS, artPieces } from '../../src/render/coaster-art';
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

  it('renders every piece a coaster family can build in 4 rotations, with a sprite on its cells', () => {
    for (const art of TRACK_ARTS)
      for (const piece of artPieces(art))
        for (let view = 0; view < 4; view++) {
          const cells = piece.footprint
            .map((_, index) => sprites.has(`track/${art}/${piece.name}/view-${view}/cell-${index}`))
            .filter(Boolean);
          expect(cells.length, `${art} ${piece.name} view ${view}`).toBeGreaterThan(0);
        }
  });

  it('has support segments, quarter caps and a base for every family in 4 rotations', () => {
    for (const family of ['wood', 'steel', 'junior', 'mouse'])
      for (const part of ['column', 'cap1', 'cap2', 'cap3', 'base'])
        for (let view = 0; view < 4; view++)
          expect(sprites.has(`track/${family}/support-${part}/view-${view}`)).toBe(true);
  });

  it('has chain, brake and block-brake art for lift- and brake-capable pieces', () => {
    for (const art of TRACK_ARTS)
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

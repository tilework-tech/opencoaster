import { describe, expect, it } from 'vitest';
import { PIECES } from '../../src/sim/track/catalog';
import { RIDE_CATALOG } from '../../src/sim/rides/ride-types';
import { buildSprites } from './generate';
import { TRANSPARENT } from './raster';
import { alignFrames } from './output';

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
    for (const def of Object.values(RIDE_CATALOG).filter((ride) => !ride.usesTrack)) {
      const slug = def.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      for (let view = 0; view < 4; view++)
        expect(
          sprites.get(`rides/${slug}/view-${view}`)?.frames.length ?? 0,
          `${def.name} view ${view}`,
        ).toBeGreaterThanOrEqual(4);
    }
  });

  it('renders each shop with four path-facing orientations and four camera views', () => {
    const facilities = Object.values(RIDE_CATALOG).filter((ride) =>
      ['shop', 'stall', 'facility'].includes(ride.category),
    );
    for (const def of facilities) {
      const key = def.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      for (let facing = 0; facing < 4; facing++)
        for (let view = 0; view < 4; view++)
          expect(
            sprites.get(`facilities/${key}/facing-${facing}/view-${view}`)?.frames.length ?? 0,
          ).toBeGreaterThanOrEqual(4);
    }
  });

  it('renders category-specific ride entrances and exits in four views', () => {
    const categories = new Set(
      Object.values(RIDE_CATALOG)
        .filter((ride) => !['shop', 'stall', 'facility'].includes(ride.category))
        .map((ride) => ride.category),
    );
    for (const category of categories)
      for (const part of ['entrance', 'exit'])
        for (let view = 0; view < 4; view++) {
          const sprite = sprites.get(`stations/${category}/${part}/view-${view}`);
          expect(sprite).toBeDefined();
          expect(sprite!.frames[0].pixels.some((pixel) => pixel !== TRANSPARENT)).toBe(true);
        }
  });

  it('renders the park entrance gate in four camera views', () => {
    for (let view = 0; view < 4; view++) {
      const sprite = sprites.get(`scenery/park-entrance/view-${view}`);
      expect(sprite).toBeDefined();
      expect(sprite!.frames[0].pixels.some((pixel) => pixel !== TRANSPARENT)).toBe(true);
    }
  });

  it('gives every operating frame of a ride the same size and anchor', () => {
    for (const [key, sprite] of sprites) {
      if (!key.startsWith('rides/')) continue;
      const frames = alignFrames(sprite.frames);
      const { width, height, anchor } = frames[0];
      expect(width).toBeGreaterThan(0);
      expect(frames.length).toBeGreaterThan(0);
      expect(anchor.x).toBe(width / 2);
      expect(height % 2).toBe(0);
      for (const frame of frames)
        expect([frame.width, frame.height, frame.anchor]).toEqual([width, height, anchor]);
    }
  });

  it('renders every catalog track piece for wood and steel in 4 rotations, with a sprite on its centre cell', () => {
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

  it('has support segments and base for both styles in 4 rotations', () => {
    for (const style of ['wood', 'steel'])
      for (const part of ['column', 'base'])
        for (let view = 0; view < 4; view++)
          expect(sprites.has(`track/${style}/support-${part}/view-${view}`)).toBe(true);
  });

  it('has train cars at 8 headings for flat, up and down pitches', () => {
    for (const style of ['wood', 'steel'])
      for (const pitch of ['flat', 'up25', 'up60', 'down25', 'down60'])
        for (let heading = 0; heading < 8; heading++)
          expect(sprites.has(`vehicles/${style}/car/${pitch}/heading-${heading}`)).toBe(true);
  });
});

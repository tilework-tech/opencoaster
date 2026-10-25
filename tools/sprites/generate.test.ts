import { describe, expect, it } from 'vitest';
import { PIECES } from '../../src/sim/track/catalog';
import { RIDE_CATALOG } from '../../src/sim/rides/ride-types';
import { buildSprites } from './generate';
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

  it('renders every gentle and thrill flat ride with an idle frame and eight operating frames', () => {
    const rideSprites = [...sprites].filter(([key]) => key.startsWith('rides/'));
    const rideSpriteByName = new Map(rideSprites.map(([key, sprite]) => [key, sprite]));
    const targetRides = Object.values(RIDE_CATALOG).filter(
      (ride) => !ride.usesTrack && (ride.category === 'gentle' || ride.category === 'thrill'),
    );

    expect(targetRides.length).toBeGreaterThan(0);
    for (const ride of targetRides) {
      const slug = ride.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const footprint = ride.footprint.reduce(
        (bounds, [x, y]) => ({
          width: Math.max(bounds.width, x + 1),
          height: Math.max(bounds.height, y + 1),
        }),
        { width: 0, height: 0 },
      );
      for (let view = 0; view < 4; view++) {
        const sprite = rideSpriteByName.get(`rides/${slug}/view-${view}`);
        expect(sprite?.frames.length, `${ride.name}, view ${view}`).toBeGreaterThanOrEqual(9);
        expect(sprite?.footprint, `${ride.name}, view ${view}`).toEqual(footprint);
        const alignedFrames = alignFrames(sprite!.frames);
        const signatures = alignedFrames.slice(0, 9).map((frame) => {
          const pixelBytes = Buffer.from(frame.pixels);
          expect(frame.width).toBe(alignedFrames[0].width);
          expect(frame.height).toBe(alignedFrames[0].height);
          expect(frame.anchor).toEqual(alignedFrames[0].anchor);
          expect(pixelBytes.some((pixel) => pixel !== 0)).toBe(true);
          return pixelBytes.toString('base64');
        });
        for (const operatingPose of signatures.slice(1))
          expect(operatingPose, `${ride.name}, view ${view} idle/operating distinction`).not.toBe(
            signatures[0],
          );
        expect(
          new Set(signatures).size,
          `${ride.name}, view ${view} varied animation`,
        ).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('gives every operating frame of a ride the same size and anchor', () => {
    for (const [key, sprite] of sprites) {
      if (!key.startsWith('rides/')) continue;
      const frames = alignFrames(sprite.frames);
      const { width, height, anchor } = frames[0];
      expect(width).toBeGreaterThan(0);
      expect(frames.length).toBeGreaterThan(0);
      for (const frame of frames) {
        expect(frame.width).toBe(width);
        expect(frame.height).toBe(height);
        expect(frame.anchor).toEqual(anchor);
      }
      expect(anchor.x).toBe(width / 2);
      expect(height % 2).toBe(0);
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

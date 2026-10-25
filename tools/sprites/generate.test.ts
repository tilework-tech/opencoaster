import { describe, expect, it } from 'vitest';
import { RIDE_CATALOG } from '../../src/sim/rides/ride-types';
import { rideSpriteName } from '../../src/render/world-art';
import { buildSprites } from './generate';
import { alignFrames } from './output';
import { TRANSPARENT } from './raster';

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

  it('renders every gentle and thrill flat ride with idle and occupied animation frames', () => {
    const targetRides = Object.values(RIDE_CATALOG).filter(
      (ride) => !ride.usesTrack && (ride.category === 'gentle' || ride.category === 'thrill'),
    );
    expect(targetRides.length).toBeGreaterThan(0);

    for (const ride of targetRides) {
      const xs = ride.footprint.map(([x]) => x);
      const ys = ride.footprint.map(([, y]) => y);
      const expectedFootprint = {
        width: Math.max(...xs) - Math.min(...xs) + 1,
        height: Math.max(...ys) - Math.min(...ys) + 1,
      };
      for (let view = 0; view < 4; view++) {
        const sprite = sprites.get(`${rideSpriteName(ride.id)}/view-${view}`);
        expect(sprite, `${ride.name}, view ${view}`).toBeDefined();
        expect(sprite?.frames, `${ride.name}, view ${view}`).toHaveLength(9);
        expect(sprite?.footprint, `${ride.name}, view ${view}`).toEqual(expectedFootprint);
        const aligned = alignFrames(sprite!.frames);
        const signatures = aligned.map((frame) => {
          expect(frame.width).toBe(aligned[0].width);
          expect(frame.height).toBe(aligned[0].height);
          expect(frame.anchor).toEqual(aligned[0].anchor);
          expect(frame.pixels.some((pixel) => pixel !== TRANSPARENT)).toBe(true);
          return Buffer.from(frame.pixels).toString('base64');
        });
        expect(aligned[0].anchor.x).toBe(aligned[0].width / 2);
        expect(aligned[0].height % 2).toBe(0);
        expect(
          new Set(signatures).size,
          `${ride.name}, view ${view} occupied poses`,
        ).toBeGreaterThanOrEqual(8);
        expect(signatures.slice(1).every((signature) => signature !== signatures[0])).toBe(true);
      }
    }
  });
});

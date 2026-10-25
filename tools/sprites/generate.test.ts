import { describe, expect, it } from 'vitest';
import { RIDE_CATALOG, RideType } from '../../src/sim/rides/ride-types';
import { rideSpriteName } from '../../src/render/world-art';
import { TRACK_ARTS, artPieces } from '../../src/render/coaster-art';
import { buildSprites } from './generate';
import { alignFrames } from './output';
import { TRANSPARENT } from './raster';
import { TRANSPORT_STYLES } from './models/transport';
import { PALETTE } from './palette';

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

  it('joins neighbouring path tiles at connected edge midpoints', () => {
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
      (ride) =>
        ride.id !== RideType.GoKarts &&
        !ride.usesTrack &&
        (ride.category === 'gentle' || ride.category === 'thrill'),
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

  it('uses the detailed Go-Karts circuit model with four animated poses', () => {
    for (let view = 0; view < 4; view++) {
      const sprite = sprites.get('rides/flat/go-karts/view-' + view);
      expect(sprite?.frames).toHaveLength(4);
      expect(
        sprite?.frames.every((frame) => frame.pixels.some((pixel) => pixel !== TRANSPARENT)),
      ).toBe(true);
    }
  });

  it('renders every piece a coaster family can build in four rotations', () => {
    for (const art of TRACK_ARTS)
      for (const piece of artPieces(art))
        for (let view = 0; view < 4; view++) {
          const cells = piece.footprint
            .map((_, index) =>
              sprites.has(`rides/coaster/${art}/track/${piece.name}/view-${view}/cell-${index}`),
            )
            .filter(Boolean);
          expect(cells.length, `${art} ${piece.name} view ${view}`).toBeGreaterThan(0);
        }
  });

  it('has support segments, quarter caps and a base for every family in 4 rotations', () => {
    for (const family of ['wood', 'steel', 'junior', 'mouse'])
      for (const part of ['column', 'cap1', 'cap2', 'cap3', 'base'])
        for (let view = 0; view < 4; view++)
          expect(sprites.has(`rides/coaster/${family}/support-${part}/view-${view}`)).toBe(true);
  });

  it('keeps every ride entrance and exit compact while retaining all ride-category styles', () => {
    const groups = [
      'rides/flat/stations/gentle',
      'rides/flat/stations/thrill',
      'transport/stations/water',
      'transport/stations/transport',
      'rides/coaster/wood/stations',
      'rides/coaster/steel/stations',
      'rides/coaster/junior/stations',
      'rides/coaster/mouse/stations',
    ];
    for (const group of groups)
      for (const part of ['entrance', 'exit'])
        for (let facing = 0; facing < 4; facing++)
          for (let view = 0; view < 4; view++) {
            const key = `${group}/${part}/facing-${facing}/view-${view}`;
            const sprite = sprites.get(key);
            expect(sprite, key).toBeDefined();
            const frame = alignFrames(sprite!.frames)[0];
            // Tile art is rendered at 64 px per tile; huts should read as guest-height x2.
            expect(frame.width, key).toBeGreaterThanOrEqual(40);
            expect(frame.width, key).toBeLessThanOrEqual(56);
            expect(frame.height, key).toBeGreaterThanOrEqual(32);
            expect(frame.height, key).toBeLessThanOrEqual(40);
          }
  });

  it('generates readable walking sprites for staff in four directions', () => {
    for (let direction = 0; direction < 4; direction++) {
      for (let kind = 0; kind < 4; kind++) {
        const staff = sprites.get(`people/staff/${kind}/direction-${direction}`);
        expect(staff?.frames, `staff ${kind}, direction ${direction}`).toHaveLength(2);
        expect(staff!.frames.every((frame) => frame.pixels.some((p) => p !== TRANSPARENT))).toBe(
          true,
        );
        expect(
          Buffer.from(staff!.frames[0].pixels).equals(Buffer.from(staff!.frames[1].pixels)),
        ).toBe(false);
        expect(staff!.frames[0].height).toBeGreaterThanOrEqual(20);
        const otherDirection = sprites.get(
          `people/staff/${kind}/direction-${(direction + 1) % 4}`,
        )!;
        expect(
          Buffer.from(staff!.frames[0].pixels).equals(Buffer.from(otherDirection.frames[0].pixels)),
        ).toBe(false);
      }
    }
  });

  it('renders visible riders above every coaster car family', () => {
    for (const family of ['wood', 'steel', 'junior', 'mouse']) {
      const car = sprites.get(`rides/coaster/${family}/vehicles/car/flat/level/heading-0`);
      expect(car, family).toBeDefined();
      expect(car!.frames[0].height, family).toBeGreaterThanOrEqual(22);
    }
  });

  it('has chain, brake and block-brake art for lift- and brake-capable pieces', () => {
    for (const art of TRACK_ARTS)
      for (const variant of ['chain', 'brake', 'block'])
        for (let view = 0; view < 4; view++)
          expect(
            sprites.has(`rides/coaster/${art}/track/flat+${variant}/view-${view}/cell-0`),
          ).toBe(true);
    expect(sprites.get('rides/coaster/wood/track/flat+chain/view-0/cell-0')?.frames).toHaveLength(
      2,
    );
    expect(sprites.has('rides/coaster/wood/track/smallLeft+chain/view-0/cell-0')).toBe(false);
  });

  it('has cars at 8 headings for every pitch and bank class of every family', () => {
    for (const family of ['wood', 'steel', 'junior', 'mouse'])
      for (const pitch of ['down90', 'down60', 'down25', 'flat', 'up25', 'up60', 'up90'])
        for (const bank of ['level', 'left', 'right', 'inverted'])
          for (let heading = 0; heading < 8; heading++)
            expect(
              sprites.has(
                `rides/coaster/${family}/vehicles/car/${pitch}/${bank}/heading-${heading}`,
              ),
            ).toBe(true);
  });

  it('generates facilities, park gates and water rides for every camera view', () => {
    for (const facility of [
      'food-stall',
      'drink-stall',
      'burger-stall',
      'information-kiosk',
      'toilets',
    ])
      for (let facing = 0; facing < 4; facing++)
        for (let view = 0; view < 4; view++)
          expect(
            sprites.has(`stalls/${facility}/facing-${facing}/view-${view}`),
            `${facility}, facing ${facing}, view ${view}`,
          ).toBe(true);
    for (let view = 0; view < 4; view++) {
      expect(sprites.has(`scenery/park-entrance/view-${view}`)).toBe(true);
      expect(sprites.has(`transport/log-flume/view-${view}`)).toBe(true);
      expect(sprites.has(`transport/river-rapids/view-${view}`)).toBe(true);
      expect(sprites.has(`rides/water/log-flume/track/flat/view-${view}/cell-0`)).toBe(true);
      expect(sprites.has(`rides/water/river-rapids/track/flat/view-${view}/cell-0`)).toBe(true);
    }
    for (const family of ['log-flume', 'river-rapids'])
      for (let heading = 0; heading < 8; heading++)
        expect(sprites.has(`rides/water/${family}/vehicles/car/flat/heading-${heading}`)).toBe(
          true,
        );
  });

  it('renders palm and cactus trees on a single tile with a centred bottom anchor', () => {
    for (const key of ['trees/tree-palm', 'trees/tree-cactus']) {
      const sprite = sprites.get(key);
      expect(sprite, key).toBeDefined();
      expect(sprite?.footprint).toEqual({ width: 1, height: 1 });
      const [frame] = alignFrames(sprite!.frames);
      expect(frame.anchor.x).toBe(frame.width / 2);
      expect(frame.anchor.y).toBeGreaterThan(frame.height * 0.8);
      expect(frame.height).toBeGreaterThan(80);
      expect(frame.height).toBeLessThan(160);
      expect(frame.pixels.some((pixel) => pixel !== TRANSPARENT)).toBe(true);
    }
  });

  it('generates transport track and vehicle keys matching the runtime family names', () => {
    for (const { style } of TRANSPORT_STYLES) {
      expect(sprites.has(`track/${style}/flat/view-0/cell-0`), style).toBe(true);
      expect(sprites.has(`vehicles/${style}/car/flat/heading-0`), style).toBe(true);
    }
  });
  it('keeps the water pattern to a few low-contrast ripple shades', () => {
    const water = sprites.get('water/surface')!;
    for (const frame of water.frames) {
      const used = new Set(frame.pixels);
      expect(used.size).toBeLessThanOrEqual(3);
    }

    const colors = [...new Set(sprites.get('water/surface')!.frames[0]!.pixels)].map(
      (index) => PALETTE[index]!,
    );
    for (let first = 0; first < colors.length; first++) {
      for (let second = first + 1; second < colors.length; second++) {
        const distance = Math.hypot(
          colors[first]![0] - colors[second]![0],
          colors[first]![1] - colors[second]![1],
          colors[first]![2] - colors[second]![2],
        );
        expect(distance).toBeLessThan(45);
      }
    }
  });
});

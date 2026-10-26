import { describe, expect, it } from 'vitest';
import { RIDE_CATALOG, RideType } from '../../src/sim/rides/ride-types';
import { facilitySpriteKey, rideSpriteName } from '../../src/render/world-art';
import { TRACK_ARTS, artPieces } from '../../src/render/coaster-art';
import { buildSprites, rideFitScale } from './generate';
import { alignFrames } from './output';
import { TRANSPARENT } from './raster';
import { TRANSPORT_STYLES } from './models/transport';
import { PALETTE } from './palette';
import { terrainMeshTriangles } from '../../src/render/terrain-geometry';

const sprites = new Map(buildSprites().map((s) => [s.key, s]));

describe('generated sprite catalogue', () => {
  it('renders path additions in four views', () => {
    for (const key of [
      'scenery/shelter',
      'scenery/bench',
      'scenery/bin',
      'scenery/lamp',
      'scenery/bench-broken',
      'scenery/bin-broken',
      'scenery/lamp-broken',
      'litter/trash',
      'litter/vomit',
    ]) {
      const views = [];
      for (let view = 0; view < 4; view++) {
        const sprite = sprites.get(`${key}/view-${view}`);
        expect(sprite, `${key}, view ${view}`).toBeDefined();
        if (key === 'scenery/shelter')
          expect(sprite?.footprint, `${key}, view ${view} footprint`).toEqual({
            width: 1,
            height: 1,
          });
        const frame = sprite?.frames[0];
        const small = key.startsWith('litter/') || /(bin|lamp)/.test(key);
        const minimumWidth = small ? 10 : 20;
        const minimumHeight = key.startsWith('litter/') ? 6 : 14;
        expect(frame?.width, `${key}, view ${view} width`).toBeGreaterThan(minimumWidth);
        expect(frame?.height, `${key}, view ${view} height`).toBeGreaterThan(minimumHeight);
        expect(frame?.pixels.some((pixel) => pixel !== TRANSPARENT)).toBe(true);
        views.push(Buffer.from(frame!.pixels).toString('base64'));
      }
      // Lamp posts are rotationally symmetric, so every view legitimately matches.
      if (!key.includes('lamp'))
        expect(new Set(views).size, `${key} distinct camera views`).toBe(4);
    }
  });

  it('generates four broad shrub variants in every camera view', () => {
    const variantFrames: string[] = [];
    for (let variant = 0; variant < 4; variant++)
      for (let view = 0; view < 4; view++) {
        const key = `scenery/shrub/variant-${variant}/view-${view}`;
        const frame = sprites.get(key)?.frames[0];
        expect(frame, key).toBeDefined();
        expect(frame!.width, key).toBeGreaterThanOrEqual(28);
        expect(
          frame!.pixels.filter((pixel) => pixel !== TRANSPARENT).length,
          key,
        ).toBeGreaterThanOrEqual(500);
        if (view === 0) variantFrames.push(Buffer.from(frame!.pixels).toString('base64'));
      }
    expect(new Set(variantFrames).size).toBe(4);
  });

  it('anchors every generated directional scenery and path-addition sprite at its ground pivot', () => {
    const directionalScenery = [...sprites.keys()].filter(
      (key) => key.startsWith('scenery/') && /\/view-[0-3]$/.test(key),
    );
    expect(directionalScenery.length).toBeGreaterThan(0);
    for (const key of directionalScenery) {
      const sprite = sprites.get(key)!;
      const frame = sprite.frames[0]!;
      expect(frame.anchor.x, `${key} x`).toBe(frame.width / 2);
      if (!key.startsWith('scenery/flower-bed/'))
        expect(frame.anchor.y, `${key} ground pivot`).toBeGreaterThan(frame.height * 0.7);
      expect(frame.anchor.y, `${key} ground pivot`).toBeLessThanOrEqual(frame.height);
      if (key.startsWith('scenery/shelter/')) expect(sprite.raw, key).toBe(true);
      else if (!key.startsWith('scenery/park-entrance/')) expect(sprite.raw, key).toBeFalsy();
    }
  });

  it('keeps every flowerbed view inside its tile footprint with only a low flower crown above it', () => {
    const flowerHeightAllowance = 8;
    const corners = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ] as const;
    const contains = (
      px: number,
      py: number,
      triangle: number[],
      heights: number[],
      center: number,
      view: number,
    ) => {
      const projected = triangle.map((corner) => {
        let [x, y] = corners[corner]!;
        if (view === 1) [x, y] = [-y, x];
        else if (view === 2) [x, y] = [-x, -y];
        else if (view === 3) [x, y] = [y, -x];
        const z = (heights[corner]! - center) * 16;
        return [(x - y) * 32, (x + y) * 16 - z];
      });
      const [[ax, ay], [bx, by], [cx, cy]] = projected as [
        [number, number],
        [number, number],
        [number, number],
      ];
      const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      const wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denominator;
      const wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denominator;
      const wc = 1 - wa - wb;
      return wa >= -0.02 && wb >= -0.02 && wc >= -0.02;
    };
    for (let slopeMask = 0; slopeMask < 16; slopeMask++) {
      const heights = corners.map((_, corner) => (slopeMask >> corner) & 1);
      for (let variant = 0; variant < 4; variant++) {
        for (let view = 0; view < 4; view++) {
          const key =
            slopeMask === 0
              ? `scenery/flower-bed/variant-${variant}/view-${view}`
              : `scenery/flower-bed/slope-${slopeMask}/variant-${variant}/view-${view}`;
          const frame = sprites.get(key)!.frames[0]!;
          const triangles = terrainMeshTriangles(view);
          const diagonal = triangles[0].filter((corner) => triangles[1].includes(corner));
          const center = diagonal.reduce((sum, corner) => sum + heights[corner]!, 0) / 2;
          for (let y = 0; y < frame.height; y++) {
            for (let x = 0; x < frame.width; x++) {
              if (frame.pixels[y * frame.width + x] === TRANSPARENT) continue;
              const px = x + 0.5 - frame.anchor.x;
              const py = y + 0.5 - frame.anchor.y;
              const belongsToTile = Array.from(
                { length: flowerHeightAllowance + 1 },
                (_, lift) => py + lift,
              ).some((groundY) =>
                triangles.some((triangle) =>
                  contains(px, groundY, triangle, heights, center, view),
                ),
              );
              expect(belongsToTile, `${key} opaque pixel (${x},${y}) leaves its tile`).toBe(true);
            }
          }
        }
      }
    }
  });

  it('anchors generated scenery trees at ground level', () => {
    for (const key of ['trees/tree-palm', 'trees/tree-cactus']) {
      const sprite = sprites.get(key)!;
      expect(sprite.raw, key).toBe(true);
      const frame = sprite.frames[0]!;
      expect(frame.anchor.x, key).toBe(frame.width / 2);
      expect(frame.anchor.y, key).toBeGreaterThan(frame.height * 0.8);
    }
  });

  it('renders the shelter canopy wider than its support posts near the top of the sprite', () => {
    const { width, height, pixels } = sprites.get('scenery/shelter/view-0')!.frames[0];
    const widestUpperRow = Math.max(
      ...Array.from(
        { length: Math.ceil(height * 0.45) },
        (_, y) =>
          Array.from(pixels.subarray(y * width, (y + 1) * width)).filter(
            (pixel) => pixel !== TRANSPARENT,
          ).length,
      ),
    );

    expect(widestUpperRow).toBeGreaterThan(width * 0.5);
  });

  it('renders compact four-direction guest and staff walking sprites', () => {
    const guests = sprites.get('people/guest-walk');
    expect(guests?.frames).toHaveLength(8 * 4 * 4);
    for (const frame of guests?.frames ?? []) {
      expect(frame.height).toBeGreaterThanOrEqual(16);
      expect(frame.height).toBeLessThanOrEqual(21);
      expect(frame.width / frame.height).toBeLessThan(0.65);
      expect(frame.pixels.some((pixel) => pixel !== TRANSPARENT)).toBe(true);
    }

    const staffSignatures: string[] = [];
    for (let role = 0; role < 4; role++) {
      for (let direction = 0; direction < 4; direction++) {
        const staff = sprites.get(`people/staff/${role}/direction-${direction}`);
        expect(staff, `staff role ${role}, direction ${direction}`).toBeDefined();
        expect(staff?.frames).toHaveLength(4);
        for (const frame of staff?.frames ?? []) {
          expect(frame.height).toBeGreaterThanOrEqual(16);
          expect(frame.height).toBeLessThanOrEqual(21);
          expect(frame.width / frame.height).toBeLessThan(0.65);
        }
        expect(
          new Set(staff?.frames.map((frame) => Buffer.from(frame.pixels).toString('base64'))).size,
        ).toBe(4);
        if (direction === 0)
          staffSignatures.push(Buffer.from(staff!.frames[0]!.pixels).toString('base64'));
      }
    }
    expect(new Set(staffSignatures).size).toBe(4);

    for (let direction = 0; direction < 4; direction++) {
      const guestsFacing = guests?.frames.slice(direction * 4, direction * 4 + 4) ?? [];
      expect(
        new Set(guestsFacing.map((frame) => Buffer.from(frame.pixels).toString('base64'))).size,
      ).toBe(4);
    }
  });

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

  it('renders every flat ride as per-tile slices with an idle and eight operating poses', () => {
    const targetRides = Object.values(RIDE_CATALOG).filter(
      (ride) =>
        ride.id !== RideType.GoKarts &&
        !ride.usesTrack &&
        (ride.category === 'gentle' || ride.category === 'thrill'),
    );
    expect(targetRides.length).toBe(9);

    for (const ride of targetRides) {
      for (let view = 0; view < 4; view++) {
        const cells = ride.footprint.map((_, cell) =>
          sprites.get(`${rideSpriteName(ride.id)}/view-${view}/cell-${cell}`),
        );
        const present = cells.filter((cell) => cell !== undefined);
        expect(present.length, `${ride.name}, view ${view}`).toBeGreaterThan(0);
        expect(sprites.has(`${rideSpriteName(ride.id)}/view-${view}`)).toBe(false);
        const poses = Array.from({ length: 9 }, (_, frame) =>
          present
            .map((cell) => {
              const aligned = alignFrames(cell!.frames);
              return Buffer.from(aligned[Math.min(frame, aligned.length - 1)].pixels).toString(
                'base64',
              );
            })
            .join('|'),
        );
        for (const cell of present) {
          expect([1, 9]).toContain(cell!.frames.length);
          expect(cell!.footprint).toEqual({ width: 1, height: 1 });
          const aligned = alignFrames(cell!.frames);
          expect(aligned[0].anchor.x).toBe(aligned[0].width / 2);
          expect(aligned[0].pixels.length).toBeGreaterThan(0);
        }
        expect(new Set(poses).size, `${ride.name}, view ${view} poses`).toBeGreaterThanOrEqual(8);
        expect(poses.slice(1).every((pose) => pose !== poses[0])).toBe(true);
      }
    }
  });

  it('draws flat rides across their whole footprint', () => {
    const widthOf = (type: RideType): number => {
      const def = RIDE_CATALOG[type];
      const xs: number[] = [];
      def.footprint.forEach((_, cell) => {
        const sprite = sprites.get(`${rideSpriteName(type)}/view-0/cell-${cell}`);
        if (sprite) xs.push(alignFrames(sprite.frames)[0].width);
      });
      return xs.length;
    };
    expect(widthOf(RideType.MerryGoRound)).toBeGreaterThanOrEqual(7);
    expect(widthOf(RideType.SwingingShip)).toBe(5);
    expect(widthOf(RideType.FerrisWheel)).toBe(4);
    expect(widthOf(RideType.Enterprise)).toBeGreaterThanOrEqual(12);
  });

  it('never shrinks a ride and caps how much it enlarges one', () => {
    const slab = (half: number) => [
      {
        material: { ramp: [0, 1, 2, 3, 4] } as never,
        v: [
          [-half, -half, 0],
          [half, -half, 0],
          [half, half, 0],
        ] as never,
      },
    ];
    expect(rideFitScale([slab(0.4)])).toBeGreaterThan(1);
    expect(rideFitScale([slab(0.1)])).toBeCloseTo(1.3);
    expect(rideFitScale([slab(0.5)])).toBe(1);
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
        expect(staff?.frames, `staff ${kind}, direction ${direction}`).toHaveLength(4);
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
        expect(
          sprites.has(`rides/water/${family}/vehicles/car/flat/heading-${heading}/passengers-0`),
        ).toBe(true);
  });

  it('renders every placeable stall and facility with a readable native sprite silhouette', () => {
    const placeables = Object.entries(RIDE_CATALOG).filter(([, definition]) =>
      ['shop', 'stall', 'facility'].includes(definition.category),
    );
    expect(placeables.length).toBeGreaterThan(0);

    for (const [typeText] of placeables) {
      const type = Number(typeText);
      for (let facing = 0; facing < 4; facing++)
        for (let view = 0; view < 4; view++) {
          const key = facilitySpriteKey(type, facing, view);
          const sprite = sprites.get(key);
          expect(sprite, key).toBeDefined();
          for (const [frameIndex, frame] of sprite!.frames.entries()) {
            const opaquePixels = frame.pixels.filter((pixel) => pixel !== TRANSPARENT).length;
            expect(opaquePixels, `${key}, frame ${frameIndex}`).toBeGreaterThanOrEqual(900);
          }
        }
    }
  });

  it('renders water track geometry and passenger-dependent boat sprites', () => {
    const flat = sprites.get('rides/water/log-flume/track/flat/view-0/cell-0')!.frames[0];
    const climb = sprites.get('rides/water/log-flume/track/up25/view-0/cell-0')!.frames[0];
    const turn = sprites.get('rides/water/log-flume/track/smallRight/view-0/cell-0')!.frames[0];
    const emptyBoat = sprites.get('rides/water/log-flume/vehicles/car/flat/heading-0/passengers-0')!
      .frames[0];
    const loadedBoat = sprites.get(
      'rides/water/log-flume/vehicles/car/flat/heading-0/passengers-2',
    )!.frames[0];
    const fullLogBoat = sprites.get(
      'rides/water/log-flume/vehicles/car/flat/heading-0/passengers-4',
    )!.frames[0];
    const fullRaft = sprites.get(
      'rides/water/river-rapids/vehicles/car/flat/heading-0/passengers-7',
    )!.frames[0];
    const partialRaft = sprites.get(
      'rides/water/river-rapids/vehicles/car/flat/heading-0/passengers-3',
    )!.frames[0];
    expect(Buffer.from(climb.pixels).equals(Buffer.from(flat.pixels))).toBe(false);
    expect(Buffer.from(turn.pixels).equals(Buffer.from(flat.pixels))).toBe(false);
    expect(Buffer.from(loadedBoat.pixels).equals(Buffer.from(emptyBoat.pixels))).toBe(false);
    expect(Buffer.from(fullLogBoat.pixels).equals(Buffer.from(loadedBoat.pixels))).toBe(false);
    expect(Buffer.from(fullRaft.pixels).equals(Buffer.from(partialRaft.pixels))).toBe(false);
    expect(sprites.has('rides/water/log-flume/vehicles/car/flat/heading-0/passengers-0')).toBe(
      true,
    );
    expect(sprites.has('rides/water/log-flume/vehicles/car/flat/heading-0/passengers-2')).toBe(
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

  it('generates a textured rock top and four shaded, textured cliff faces', () => {
    const surface = sprites.get('terrain/rock/surface');
    expect(surface?.raw).toBe(true);
    const top = surface?.frames[0];
    expect(top?.width).toBe(16);
    expect(top?.height).toBe(16);
    expect(new Set(top?.pixels ?? []).size).toBeGreaterThan(3);
    expect(
      Array.from({ length: 16 * 15 }, (_, index) => index).filter(
        (index) => top!.pixels[index] !== top!.pixels[index + 1],
      ).length,
    ).toBeGreaterThan(20);

    const cliffs = [0, 1, 2, 3].map((direction) => {
      const face = sprites.get(`terrain/rock/cliff-face-${direction}`);
      expect(face?.raw).toBe(true);
      const frame = face?.frames[0];
      expect(frame?.width).toBe(64);
      expect(frame?.height).toBe(16);
      expect(new Set(frame?.pixels ?? []).size).toBeGreaterThan(3);
      let adjacentChanges = 0;
      for (let y = 0; y < frame!.height; y++)
        for (let x = 0; x < frame!.width - 1; x++)
          if (frame!.pixels[y * frame!.width + x] !== frame!.pixels[y * frame!.width + x + 1])
            adjacentChanges++;
      expect(adjacentChanges).toBeGreaterThan(100);
      return Buffer.from(frame?.pixels ?? []).toString('base64');
    });
    expect(new Set(cliffs).size).toBe(4);
    const averageShade = (pixels: string) =>
      Buffer.from(pixels, 'base64').reduce((sum, value) => sum + value, 0) /
      Buffer.from(pixels, 'base64').length;
    expect(averageShade(cliffs[1]!)).toBeGreaterThan(averageShade(cliffs[0]!));
    expect(averageShade(cliffs[3]!)).toBeGreaterThan(averageShade(cliffs[2]!));
  });

  it('generates transport track and vehicle keys matching the runtime family names', () => {
    for (const { style } of TRANSPORT_STYLES) {
      expect(sprites.has(`track/${style}/flat/view-0/cell-0`), style).toBe(true);
      expect(sprites.has(`vehicles/${style}/car/flat/heading-0`), style).toBe(true);
    }
  });

  it('draws the small turns used by normal transport circuits', () => {
    for (const { style } of TRANSPORT_STYLES)
      for (const turn of ['smallLeft', 'smallRight'])
        for (let view = 0; view < 4; view++) {
          const keys = [...sprites.keys()].filter((key) =>
            key.startsWith(`track/${style}/${turn}/view-${view}/`),
          );
          expect(keys.length, `${style} ${turn} view ${view} keys`).toBeGreaterThan(0);
          for (const key of keys)
            for (const [frameIndex, frame] of sprites.get(key)!.frames.entries())
              expect(
                frame.pixels.some((pixel) => pixel !== TRANSPARENT),
                `${key} frame ${frameIndex}`,
              ).toBe(true);
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

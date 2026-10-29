import { describe, expect, it } from 'vitest';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { PIECES } from '../sim/track/catalog';
import { pieceExit } from '../sim/track/construction';
import { fitPreview, previewLoop, ridePreviewItems } from './ride-preview';

const request = (type: number, rotation = 0) => ({
  type: type as RideType,
  dir: 0,
  rotation,
  phase: 0,
  tick: 0,
});

describe('ride preview items', () => {
  it('shows a flat ride as its whole-ride view', () => {
    expect(ridePreviewItems(request(2, 1)).map((i) => i.key)).toEqual([
      'rides/flat/swinging-ship/preview/view-1',
    ]);
  });

  it('builds the Observation Tower preview from its selected height and moving cabin', () => {
    const short = ridePreviewItems({ ...request(RideType.ObservationTower), towerHeight: 8 });
    const tall = ridePreviewItems({
      ...request(RideType.ObservationTower),
      towerHeight: 16,
      phase: 2,
      phaseProgress: 500,
    });
    expect(short).toHaveLength(7);
    expect(tall).toHaveLength(15);
    expect(Math.min(...tall.map(({ y }) => y))).toBeLessThan(Math.min(...short.map(({ y }) => y)));
    expect(tall.at(-1)?.key).toContain('/cabin/');
  });

  it('shows stalls and toilets as their shopfront sprites', () => {
    for (const type of [5, 6, 7, 8, 24]) {
      const [item] = ridePreviewItems(request(type));
      expect(item.key).toMatch(/^stalls\/[a-z-]+\/facing-1\/view-0$/);
    }
  });

  it('keeps the shopfront toward the viewer at every camera rotation', () => {
    for (let rotation = 0; rotation < 4; rotation++) {
      const [item] = ridePreviewItems(request(5, rotation));
      expect(item.key).toMatch(new RegExp(`/facing-${(1 - rotation + 4) & 3}/view-${rotation}$`));
    }
  });

  it('shows every track ride as a loop of its own track with a car, not just the station hut', () => {
    for (const def of Object.values(RIDE_CATALOG).filter((d) => d.usesTrack)) {
      const keys = ridePreviewItems(request(def.id)).map((i) => i.key);
      expect(keys.length, def.name).toBeGreaterThan(8);
      expect(
        keys.some((k) => k.includes('/stations/')),
        def.name,
      ).toBe(false);
      expect(
        keys.some((k) => k.includes('car/')),
        def.name,
      ).toBe(true);
    }
  });

  it('draws the cars last so they stand on the track', () => {
    const items = ridePreviewItems(request(9));
    expect(items[items.length - 1].key).toContain('vehicles/car');
  });

  it('shows a coaster as a train of several cars, with some on the slope of the hill', () => {
    const cars = ridePreviewItems(request(9)).filter((i) => i.key.includes('vehicles/car'));
    expect(cars.length).toBeGreaterThanOrEqual(3);
    expect(cars.some((c) => !c.key.includes('/flat/'))).toBe(true);
  });

  it('places the cars of a train on distinct spots along the track', () => {
    const cars = ridePreviewItems(request(9)).filter((i) => i.key.includes('vehicles/car'));
    expect(new Set(cars.map((c) => `${c.x},${c.y}`)).size).toBe(cars.length);
  });
});

describe('preview loop', () => {
  it('closes back on its starting piece', () => {
    const loop = previewLoop(9);
    const last = loop[loop.length - 1];
    const end = pieceExit(last.pieceType, last.x, last.y, 0, last.dir);
    expect({ x: end.x, y: end.y, dir: end.dir }).toEqual({
      x: loop[0].x,
      y: loop[0].y,
      dir: loop[0].dir,
    });
    expect(PIECES[loop[0].pieceType].name).toBe('station');
  });

  it('rises over a hill and comes back down to the station height', () => {
    const loop = previewLoop(9);
    expect(Math.max(...loop.map((p) => p.z))).toBeGreaterThan(0);
    const last = loop[loop.length - 1];
    expect(pieceExit(last.pieceType, last.x, last.y, last.z, last.dir).z).toBe(0);
  });

  it('only uses pieces the ride can build', () => {
    for (const def of Object.values(RIDE_CATALOG).filter((d) => d.usesTrack)) {
      const allowed = def.trackRules?.allowedPieces;
      for (const piece of previewLoop(def.id))
        if (allowed) expect(allowed, def.name).toContain(piece.pieceType);
    }
  });
});

describe('preview fit', () => {
  const bounds = { left: -30, top: -40, right: 30, bottom: 20 };

  it('uses a whole-number scale and centres the artwork', () => {
    const fit = fitPreview(bounds, { width: 300, height: 150 }, 4, 3);
    expect(fit.scale).toBe(2);
    expect(fit.originX).toBe(150);
    expect(fit.originY).toBe(75 + 20);
  });

  it('caps magnification of small art', () => {
    expect(
      fitPreview({ left: 0, top: 0, right: 8, bottom: 8 }, { width: 300, height: 150 }, 4, 3).scale,
    ).toBe(3);
  });

  it('shrinks art that does not fit instead of clipping it', () => {
    const fit = fitPreview(
      { left: 0, top: 0, right: 400, bottom: 300 },
      { width: 200, height: 100 },
      0,
      3,
    );
    expect(fit.scale).toBeCloseTo(1 / 3);
  });
});

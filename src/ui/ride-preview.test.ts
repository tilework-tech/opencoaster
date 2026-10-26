import { describe, expect, it } from 'vitest';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import type { RideType } from '../sim/rides/ride-types';
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

  it('shows stalls and toilets as their shopfront sprites', () => {
    for (const type of [5, 6, 7, 8, 24]) {
      const [item] = ridePreviewItems(request(type));
      expect(item.key).toMatch(/^stalls\/[a-z-]+\/facing-1\/view-0$/);
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

  it('draws the car last so it stands on the track', () => {
    const items = ridePreviewItems(request(9));
    expect(items[items.length - 1].key).toContain('vehicles/car');
  });
});

describe('preview loop', () => {
  it('closes back on its starting piece', () => {
    const loop = previewLoop();
    const last = loop[loop.length - 1];
    const end = pieceExit(last.pieceType, last.x, last.y, 0, last.dir);
    expect({ x: end.x, y: end.y, dir: end.dir }).toEqual({
      x: loop[0].x,
      y: loop[0].y,
      dir: loop[0].dir,
    });
    expect(PIECES[loop[0].pieceType].name).toBe('station');
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

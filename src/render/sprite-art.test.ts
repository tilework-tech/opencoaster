import { describe, expect, it } from 'vitest';
import { PIECES } from '../sim/track/catalog';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import {
  carSpriteKey,
  frameForTick,
  nativeSpriteWorldOffset,
  rideSpriteKey,
  rotatePathEdges,
  trackCells,
  trackStyleForRide,
} from './sprite-art';

describe('path views', () => {
  it('rotates connection bits with the camera so edges stay on the same world side', () => {
    expect(rotatePathEdges(0b0001, 0)).toBe(0b0001);
    expect(rotatePathEdges(0b0001, 1)).toBe(0b0010);
    expect(rotatePathEdges(0b1000, 1)).toBe(0b0001);
    expect(rotatePathEdges(0b0101, 2)).toBe(0b0101);
    expect(rotatePathEdges(0b0011, 3)).toBe(0b1001);
  });
});

describe('ride sprites', () => {
  it('names every non-track ride after its catalog name with a camera view', () => {
    expect(rideSpriteKey(RideType.MerryGoRound, 2)).toBe('rides/merry-go-round/view-2');
    expect(rideSpriteKey(RideType.GoKarts, 0)).toBe('rides/go-karts/view-0');
    for (const def of Object.values(RIDE_CATALOG))
      if (!def.usesTrack) expect(rideSpriteKey(def.id, 1)).toMatch(/^rides\/[a-z-]+\/view-1$/);
  });

  it('advances animation frames every eight ticks and wraps', () => {
    expect(frameForTick(0, 4)).toBe(0);
    expect(frameForTick(8, 4)).toBe(1);
    expect(frameForTick(32, 4)).toBe(0);
    expect(frameForTick(-5, 4)).toBe(0);
  });
});

describe('coaster sprites', () => {
  it('uses wood for the wooden-family rides and steel otherwise', () => {
    expect(trackStyleForRide(RideType.WoodenCoaster)).toBe('wood');
    expect(trackStyleForRide(RideType.SteelLoopingCoaster)).toBe('steel');
  });

  it('turns local footprint cells by the piece direction and picks the combined view', () => {
    const turn = PIECES.find((p) => p.name === 'smallRight')!;
    const upright = trackCells(turn.id, 0, 0, 'steel');
    expect(upright).toHaveLength(turn.footprint.length);
    expect(upright[0].key).toBe(`track/steel/smallRight/view-0/cell-0`);
    const east = trackCells(turn.id, 1, 0, 'steel');
    expect(east[0].key).toContain('view-1');
    const cell = turn.footprint[1];
    expect([east[1].dx, east[1].dy]).toEqual([-cell.j, cell.i]);
    expect(trackCells(turn.id, 1, 3, 'steel')[0].key).toContain('view-0');
  });

  it('names car sprites by heading octant and pitch', () => {
    expect(carSpriteKey('wood', 3, 'up25')).toBe('vehicles/wood/car/up25/heading-3');
  });
});

describe('native sprite placement', () => {
  it('shifts the quad so the manifest anchor lands on the projected point', () => {
    expect(nativeSpriteWorldOffset(64, 32)).toBe(0);
    expect(nativeSpriteWorldOffset(64, 48)).toBe(64);
    expect(nativeSpriteWorldOffset(64, 16)).toBe(-64);
  });
});

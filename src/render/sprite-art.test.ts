import { describe, expect, it } from 'vitest';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import {
  frameForTick,
  nativeSpriteWorldOffset,
  rideSpriteKey,
  rotatePathEdges,
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

describe('native sprite placement', () => {
  it('shifts the quad so the manifest anchor lands on the projected point', () => {
    expect(nativeSpriteWorldOffset(64, 32)).toBe(0);
    expect(nativeSpriteWorldOffset(64, 48)).toBe(64);
    expect(nativeSpriteWorldOffset(64, 16)).toBe(-64);
  });
});

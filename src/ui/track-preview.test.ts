import { describe, expect, it } from 'vitest';
import { rideGhostSprite } from './track-preview';
import { RideType } from '../sim/rides/ride-types';
import type { MapData } from '../render/renderer';

const map = { width: 4, height: 4, heights: new Uint8Array(16).fill(3) };

describe('ride placement sprite', () => {
  it('stands on the tile level and marks invalid spots refused', () => {
    const ghost = rideGhostSprite(
      { type: RideType.MerryGoRound, x: 1, y: 2, facing: 0, valid: false },
      map as MapData,
      0,
    );
    expect(ghost).toMatchObject({ x: 1, y: 2, level: 3, kind: 'ride', tone: 'refused' });
  });

  it('shows a different sprite for each camera rotation', () => {
    const sprites = [0, 1, 2, 3].map(
      (rotation) =>
        rideGhostSprite(
          { type: RideType.MerryGoRound, x: 1, y: 2, facing: 0, valid: true },
          map as MapData,
          rotation as 0 | 1 | 2 | 3,
        )?.sprite,
    );
    expect(new Set(sprites).size).toBe(4);
  });

  it('draws nothing outside the map', () => {
    expect(
      rideGhostSprite(
        { type: RideType.MerryGoRound, x: 9, y: 0, facing: 0, valid: true },
        map as MapData,
        0,
      ),
    ).toBeNull();
  });
});

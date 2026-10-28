import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { getRideRatings, createRide, setRideMode } from './ride-operations';
import { RIDE_CATALOG } from './ride-types';
import type { RideType } from './ride-types';

const GUEST_RATED_TYPES = Object.values(RIDE_CATALOG).filter(
  (definition) => definition.category !== 'stall' && definition.category !== 'facility',
);

describe('guest-facing ride rating coverage', () => {
  it.each(GUEST_RATED_TYPES)(
    '$name has a rating model for its default and available modes',
    (def) => {
      const sim = new Simulation({ seed: 1, width: 8, height: 8 });
      const rideId = createRide(sim.world, def.id as RideType, 4, 4);
      expect(rideId).toBeGreaterThanOrEqual(0);

      for (const mode of def.modes) {
        expect(setRideMode(sim.world, rideId, mode.mode)).toBe(true);
        const ratings = getRideRatings(sim.world, rideId);
        expect([ratings.excitement, ratings.intensity, ratings.nausea]).toEqual([
          Math.max(0, def.baseExcitement + (def.usesTrack ? 0 : mode.excitement)),
          Math.max(0, def.baseIntensity + (def.usesTrack ? 0 : mode.intensity)),
          Math.max(0, def.baseNausea + (def.usesTrack ? 0 : mode.nausea)),
        ]);
      }
    },
  );
});

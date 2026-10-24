import { describe, expect, it } from 'vitest';
import { NO_TRACK_ELEMENTS } from './track-elements';
import {
  MAX_RATING,
  NEUTRAL_PROFILE,
  calculateTrackedRideRatings,
  unmetRequirements,
} from './vehicle-ratings';
import type { RatingProfile, RideTestMetrics, TrackElementStats } from './vehicle-ratings';

const QUIET: RideTestMetrics = {
  maxSpeed: 0,
  averageSpeed: 0,
  dropCount: 0,
  highestDrop: 0,
  inversionCount: 0,
  maxVerticalGQ8: 0,
  minVerticalGQ8: 0,
  maxLateralGQ8: 0,
  rideLength: 0,
  airtimeTicks: 0,
};

function rate(extra: Partial<RideTestMetrics>, profile?: RatingProfile) {
  return calculateTrackedRideRatings({ ...QUIET, ...extra }, profile);
}

function elements(extra: Partial<TrackElementStats>): TrackElementStats {
  return { ...NO_TRACK_ELEMENTS, ...extra };
}

describe('turn terms', () => {
  it('rate larger flat turns higher and add intensity and nausea', () => {
    const none = rate({ elements: elements({}) });
    const large = rate({ elements: elements({ flatTurns: [0, 0, 20] }) });
    expect(large.excitement - none.excitement).toBe(50);
    expect(large.intensity - none.intensity).toBe(25);
    expect(large.nausea - none.nausea).toBe(100);
  });

  it('rates banked turns above flat ones in excitement', () => {
    const flat = rate({ elements: elements({ flatTurns: [0, 20, 0] }) });
    const banked = rate({ elements: elements({ bankedTurns: [0, 20, 0] }) });
    expect(banked.excitement - flat.excitement).toBe(15);
    expect(banked.intensity).toBe(flat.intensity);
  });

  it('adds no intensity for sloped turns and caps the counted turns', () => {
    const base = rate({ elements: elements({}) });
    const sloped = rate({ elements: elements({ slopedTurns: [0, 0, 0, 20] }) });
    expect(sloped.intensity).toBe(base.intensity);
    expect(sloped.excitement - base.excitement).toBe(30);
    expect(sloped.nausea - base.nausea).toBe(60);
  });
});

describe('helix terms', () => {
  it('adds excitement and intensity per helix and nausea beyond the fifth', () => {
    const none = rate({});
    const five = rate({ elements: elements({ helices: 5 }) });
    const eight = rate({ elements: elements({ helices: 8 }) });
    expect(five.excitement - none.excitement).toBe(19);
    expect(five.intensity - none.intensity).toBe(11);
    expect(five.nausea).toBe(none.nausea);
    expect(eight.nausea - none.nausea).toBe(60);
  });

  it('stops counting after the caps', () => {
    const nine = rate({ elements: elements({ helices: 9 }) });
    const twenty = rate({ elements: elements({ helices: 20 }) });
    expect(twenty.excitement).toBe(nine.excitement);
    expect(twenty.nausea - nine.nausea).toBe(20);
  });
});

describe('sheltered track terms', () => {
  it('adds per-length, per-section and rolling-piece terms', () => {
    const none = rate({});
    const length = rate({ elements: elements({ shelteredLength: 100 }) });
    expect(length.excitement - none.excitement).toBe(14);
    expect(length.intensity - none.intensity).toBe(15);
    expect(length.nausea - none.nausea).toBe(25);

    const rolling = rate({ elements: elements({ shelteredRollingPieces: 2 }) });
    expect(rolling.excitement - none.excitement).toBe(40);
    expect(rolling.nausea - none.nausea).toBe(30);

    const sections = rate({ elements: elements({ shelteredSections: 20 }) });
    expect(sections.excitement - none.excitement).toBe(130);
  });
});

describe('scenery term', () => {
  it('adds 0.05 per item near the station up to 47 items', () => {
    const none = rate({});
    expect(rate({ sceneryItems: 10 }).excitement - none.excitement).toBe(50);
    expect(rate({ sceneryItems: 500 }).excitement - none.excitement).toBe(235);
  });

  it('gives an underground station a fixed 0.40', () => {
    const none = rate({});
    expect(rate({ sceneryItems: 30, undergroundStation: true }).excitement - none.excitement).toBe(
      40,
    );
  });
});

describe('base values and multipliers', () => {
  const profile: RatingProfile = {
    base: { excitement: 100, intensity: 100, nausea: 100 },
    multiplierPercent: { excitement: 150, intensity: 50, nausea: 100 },
  };

  it('multiplies the sum of base and track terms instead of adding the base afterwards', () => {
    const track = { maxVerticalGQ8: 256, minVerticalGQ8: 0 };
    const neutral = rate(track);
    const rated = rate(track, profile);
    expect(rated.excitement).toBe(Math.trunc(((neutral.excitement + 100) * 150) / 100));
    expect(rated.intensity).toBe(Math.trunc(((neutral.intensity + 100) * 50) / 100));
    expect(rated.nausea).toBe(neutral.nausea + 100);
  });

  it('applies the intensity penalty to the base-inclusive excitement before multiplying', () => {
    const intense = rate(
      { inversionCount: 20 },
      { ...profile, base: { ...profile.base, excitement: 400 } },
    );
    const plain = rate(
      { inversionCount: 20 },
      { ...NEUTRAL_PROFILE, base: { ...profile.base, excitement: 400 } },
    );
    expect(intense.excitement).toBeGreaterThan(plain.excitement);
  });
});

describe('requirements', () => {
  const requirements = { minDropCount: 2, minLength: 100 };
  const profile: RatingProfile = { ...NEUTRAL_PROFILE, requirements, requirementDivisor: 2 };
  const run = { dropCount: 3, rideLength: 200 * 256, maxVerticalGQ8: 512 };

  it('leaves ratings alone when every requirement is met', () => {
    expect(unmetRequirements({ ...QUIET, ...run }, requirements)).toBe(0);
    expect(rate(run, profile)).toEqual(rate(run));
  });

  it('divides all three ratings once per unmet requirement', () => {
    const one = rate({ ...run, dropCount: 1 }, profile);
    const plain = rate({ ...run, dropCount: 1 });
    expect(one.excitement).toBe(Math.trunc(plain.excitement / 2));
    expect(one.intensity).toBe(Math.trunc(plain.intensity / 2));
    expect(one.nausea).toBe(Math.trunc(plain.nausea / 2));
    const two = rate({ ...run, dropCount: 1, rideLength: 0 }, profile);
    expect(unmetRequirements({ ...QUIET, ...run, dropCount: 1, rideLength: 0 }, requirements)).toBe(
      2,
    );
    expect(two.intensity).toBe(
      Math.trunc(Math.trunc(rate({ ...run, dropCount: 1, rideLength: 0 }).intensity / 2) / 2),
    );
  });

  it('checks negative G, lateral G, inversions, speed, drop height and shelter', () => {
    const all = {
      minNegativeGQ8: -64,
      minLateralGQ8: 100,
      minInversions: 1,
      minMaxSpeedQ8: 1000,
      minDropHeight: 64,
      minShelteredLength: 10,
    };
    expect(unmetRequirements(QUIET, all)).toBe(6);
    expect(
      unmetRequirements(
        {
          ...QUIET,
          minVerticalGQ8: -100,
          maxLateralGQ8: 200,
          inversionCount: 1,
          maxSpeed: 1000,
          highestDrop: 64,
          elements: elements({ shelteredLength: 10 }),
        },
        all,
      ),
    ).toBe(0);
  });
});

describe('air time', () => {
  it('adds excitement at one eighth and nausea at one sixteenth of the air time', () => {
    const none = rate({});
    const air = rate({ airtimeTicks: 160 });
    expect(air.excitement - none.excitement).toBe(20);
    expect(air.nausea - none.nausea).toBe(10);
  });

  it('counts at most 200 ticks of air time', () => {
    expect(rate({ airtimeTicks: 5000 })).toEqual(rate({ airtimeTicks: 200 }));
    expect(rate({ airtimeTicks: 200 }).excitement - rate({}).excitement).toBe(25);
  });

  it('costs limited-air-time rides excitement beyond 96 ticks', () => {
    const limited: RatingProfile = { ...NEUTRAL_PROFILE, limitedAirTime: true };
    const base = rate({ inversionCount: 2 }, limited);
    expect(rate({ inversionCount: 2, airtimeTicks: 96 }, limited).excitement).toBe(base.excitement);
    expect(rate({ inversionCount: 2, airtimeTicks: 200 }, limited).excitement).toBe(
      base.excitement - 13,
    );
    expect(rate({ inversionCount: 2, airtimeTicks: 200 }, limited).nausea - base.nausea).toBe(12);
  });
});

describe('drop height term', () => {
  it('uses 0.49 excitement, 0.98 intensity and 0.16 nausea per 32-unit step', () => {
    const none = rate({});
    const tall = rate({ highestDrop: 32 * 100 });
    expect(tall.excitement - none.excitement).toBe(49);
    expect(tall.intensity - none.intensity).toBe(98);
    expect(tall.nausea - none.nausea).toBe(16);
  });
});

describe('clamp', () => {
  it('limits ratings to 32767', () => {
    const huge = rate({ inversionCount: 50_000, maxLateralGQ8: 40_000 });
    expect(huge.intensity).toBe(MAX_RATING);
  });
});

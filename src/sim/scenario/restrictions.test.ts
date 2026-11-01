import { describe, expect, it } from 'vitest';
import { RideType } from '../rides/ride-types';
import { parseScenarioFile } from './scenario-file';
import { restrictionLines } from './restrictions';

const base = {
  id: 'rules-park',
  name: 'Rules Park',
  seed: 7,
  map: { width: 48, height: 40 },
  finance: { startingCash: 5_000_000, startingLoan: 0, maxLoan: 10_000_000, annualInterestBps: 0 },
  pricing: { mode: 'admission', admissionPrice: 300 },
  research: {
    availableItemIds: [RideType.MerryGoRound, RideType.FoodStall],
    inventions: [{ itemId: RideType.Twist, category: 0, workUnits: 9_000 }],
  },
  entrance: { side: 'south', length: 4 },
  objective: { kind: 'guestsAndRating', target: 150, rating: 600, byYear: 1 },
};

function parse(restrictions: unknown, extra: Record<string, unknown> = {}) {
  return parseScenarioFile({ ...base, ...extra, restrictions });
}

describe('scenario restrictions in scenario files', () => {
  it('reads every rule', () => {
    const def = parse({
      forbidTreeRemoval: true,
      forbidLandscaping: true,
      maxConstructionHeight: 6,
      forbiddenRideTypeIds: [RideType.TopSpin, RideType.Enterprise],
      forbidMarketing: true,
    });
    expect(def.restrictions).toEqual({
      forbidTreeRemoval: true,
      forbidLandscaping: true,
      maxConstructionHeight: 6,
      forbiddenRideTypeIds: [RideType.TopSpin, RideType.Enterprise],
      forbidMarketing: true,
    });
  });

  it('treats a missing object, missing fields or false flags as unrestricted', () => {
    for (const def of [parseScenarioFile(base), parse({}), parse({ forbidMarketing: false })])
      expect(restrictionLines(def.restrictions ?? {})).toEqual([]);
  });

  it('accepts the smallest and largest height caps', () => {
    expect(parse({ maxConstructionHeight: 4 }).restrictions?.maxConstructionHeight).toBe(4);
    expect(parse({ maxConstructionHeight: 96 }).restrictions?.maxConstructionHeight).toBe(96);
  });

  it.each([
    [{ forbidTreeRemoval: 'yes' }, 'restrictions.forbidTreeRemoval'],
    [{ maxConstructionHeight: 3 }, 'restrictions.maxConstructionHeight'],
    [{ maxConstructionHeight: 97 }, 'restrictions.maxConstructionHeight'],
    [{ maxConstructionHeight: 5.5 }, 'restrictions.maxConstructionHeight'],
    [{ forbiddenRideTypeIds: [999] }, 'restrictions.forbiddenRideTypeIds[0]'],
    [{ forbiddenRideTypeIds: [16, 16] }, 'restrictions.forbiddenRideTypeIds[1]'],
    [{ forbiddenRideTypeIds: 16 }, 'restrictions.forbiddenRideTypeIds'],
    [{ forbiddenRideTypeIds: ['16'] }, 'restrictions.forbiddenRideTypeIds[0]'],
    [{ forbidHills: true }, 'restrictions.forbidHills'],
    [[], 'restrictions'],
  ])('rejects %j naming the field', (restrictions, field) => {
    expect(() => parse(restrictions)).toThrow(`Scenario rules-park: ${field}`);
  });

  it('rejects a forbidden ride type the park could still build or research', () => {
    expect(() => parse({ forbiddenRideTypeIds: [RideType.MerryGoRound] })).toThrow(
      /forbidden.*research\.availableItemIds/,
    );
    expect(() => parse({ forbiddenRideTypeIds: [RideType.Twist] })).toThrow(
      /forbidden.*research\.inventions/,
    );
    expect(() =>
      parse(
        { forbiddenRideTypeIds: [RideType.FerrisWheel] },
        { prebuilt: [{ type: 'ferrisWheel', row: 4, lateral: 3 }] },
      ),
    ).toThrow(/forbidden.*prebuilt/);
  });
});

describe('restriction descriptions', () => {
  it('describes each active rule in plain language with units', () => {
    expect(
      restrictionLines({
        forbidTreeRemoval: true,
        forbidLandscaping: true,
        maxConstructionHeight: 6,
        forbiddenRideTypeIds: [RideType.TopSpin],
        forbidMarketing: true,
      }),
    ).toEqual([
      'Trees may not be removed.',
      'Land and water may not be reshaped.',
      'Nothing may be built more than 6 height levels above the ground.',
      'Banned attractions: Top Spin.',
      'Marketing campaigns are not allowed.',
    ]);
  });

  it('has nothing to say about an unrestricted park', () => {
    expect(restrictionLines({})).toEqual([]);
  });
});

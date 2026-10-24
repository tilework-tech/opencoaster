import { describe, expect, it } from 'vitest';
import { hashWorld } from '../core/hash';
import { PieceMode } from '../track/track-types';
import { buildCircuit, createCoaster, flatOwnedSim, run } from './coaster-fixtures';
import { getRideTestMeasurements, isRideTested } from './ride-operations';
import { RideType } from './ride-types';

type Layout = Array<readonly [string, PieceMode]>;

const N = PieceMode.Normal;
const L = PieceMode.ChainLift;
const flats = (n: number): Layout => Array.from({ length: n }, () => ['flat', N] as const);
const piece = (...names: string[]): Layout => names.map((name) => [name, N] as const);

const LIFT4: Layout = [
  ['flatToUp25', L],
  ['up25', L],
  ['up25ToFlat', L],
];
const LIFT8: Layout = [
  ['flatToUp25', L],
  ['up25', L],
  ['up25', L],
  ['up25', L],
  ['up25ToFlat', L],
];
const DROP8 = piece('flatToDown25', 'down25', 'down25', 'down25', 'down25ToFlat');

interface Parts {
  lift: Layout;
  top?: Layout;
  drop: Layout;
  back?: Layout;
}

/** Station, lift, `top` run, two small turns, drop, `back` run and two more turns. */
function circuit({ lift, top = [], drop, back = [] }: Parts): Layout {
  return [
    ['station', N],
    ...lift,
    ...top,
    ...piece('smallRight', 'smallRight'),
    ...drop,
    ...back,
    ...piece('smallRight', 'smallRight'),
  ];
}

const BASE = circuit({ lift: LIFT8, drop: DROP8, back: flats(1) });
const CORKSCREW_BASE = circuit({ lift: LIFT8, top: flats(4), drop: DROP8, back: flats(5) });
const CORKSCREW = circuit({
  lift: LIFT8,
  top: flats(4),
  drop: DROP8,
  back: piece('corkscrewRight'),
});
const S_BENDS = circuit({
  lift: LIFT8,
  top: flats(9),
  drop: DROP8,
  back: piece('sBendLeft', 'sBendRight'),
});
const HELIX = circuit({
  lift: LIFT4,
  top: flats(1),
  drop: piece('flatToLeftBank', 'smallHelixLeftDown', 'leftBankToFlat'),
});
const BANKED_DROP = circuit({
  lift: LIFT4,
  top: flats(1),
  drop: piece(
    'flatToRightBank',
    'rightBankFlatToDown25',
    'rightBankDown25',
    'rightBankDown25ToFlat',
    'rightBankToFlat',
  ),
});
const BANK_ON_SLOPE = circuit({
  lift: LIFT8,
  drop: piece(
    'flatToDown25',
    'down25FlatToRightBank',
    'rightBankDown25',
    'down25RightBankToFlat',
    'down25ToFlat',
  ),
  back: flats(1),
});

function tested(layout: Layout, seed = 1) {
  const sim = flatOwnedSim(seed);
  const rideId = createCoaster(sim, RideType.SteelLoopingCoaster);
  buildCircuit(sim, rideId, layout);
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
  run(sim, 9000);
  const slot = sim.world.rides.idToSlot[rideId];
  const r = sim.world.rides.cols;
  return {
    sim,
    rideId,
    ok: isRideTested(sim.world, rideId),
    measured: getRideTestMeasurements(sim.world, rideId),
    excitement: r.excitement[slot],
    intensity: r.intensity[slot],
    nausea: r.nausea[slot],
  };
}

describe('coasters built from the new track elements', () => {
  const base = tested(BASE);

  it.each([
    ['corkscrew', CORKSCREW],
    ['S-bends', S_BENDS],
    ['banked helix', HELIX],
    ['banked drop', BANKED_DROP],
    ['bank change on a slope', BANK_ON_SLOPE],
  ])('closes, tests and rates a circuit with %s', (_name, layout) => {
    const result = tested(layout);
    expect(result.ok).toBe(true);
    expect(result.measured!.maxSpeed).toBeGreaterThan(0);
    expect(result.excitement).toBeGreaterThan(0);
  });

  it('counts a corkscrew as an inversion and rates the ride more nauseating', () => {
    const corkscrew = tested(CORKSCREW);
    const base = tested(CORKSCREW_BASE);
    expect(base.measured!.inversionCount).toBe(0);
    expect(corkscrew.measured!.inversionCount).toBe(1);
    expect(corkscrew.nausea).toBeGreaterThan(base.nausea);
  });

  it('feels a banked helix as sustained sideways and downward load', () => {
    const helix = tested(HELIX);
    expect(helix.measured!.maxLateralG).toBeGreaterThan(0);
    expect(helix.measured!.maxPositiveG).toBeGreaterThan(256);
    expect([helix.excitement, helix.intensity, helix.nausea]).not.toEqual([
      base.excitement,
      base.intensity,
      base.nausea,
    ]);
  });

  it('produces identical worlds for identical seeds', () => {
    for (const layout of [CORKSCREW, HELIX, S_BENDS]) {
      expect(hashWorld(tested(layout, 7).sim.world)).toBe(hashWorld(tested(layout, 7).sim.world));
    }
  });
});

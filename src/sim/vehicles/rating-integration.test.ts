import { describe, expect, it } from 'vitest';
import { ElementType, OWNED } from '../map/tile-map';
import { PieceMode } from '../track/track-types';
import { getTrackPath } from '../track/track-path';
import {
  SMALL_CIRCUIT,
  STATION_X,
  STATION_Y,
  buildCircuit,
  createCoaster,
  flatOwnedSim,
  run,
} from '../rides/coaster-fixtures';
import { RideType } from '../rides/ride-types';
import { measureTrackElements } from './track-elements';

type Layout = ReadonlyArray<readonly [string, PieceMode]>;
const N = PieceMode.Normal;

function ratings(sim: ReturnType<typeof flatOwnedSim>, rideId: number) {
  const slot = sim.world.rides.idToSlot[rideId];
  const r = sim.world.rides.cols;
  return { e: r.excitement[slot], i: r.intensity[slot], n: r.nausea[slot] };
}

function tested(
  layout: Layout,
  rideType = RideType.WoodenCoaster,
  prepare?: (sim: ReturnType<typeof flatOwnedSim>) => void,
) {
  const sim = flatOwnedSim(1);
  prepare?.(sim);
  const rideId = createCoaster(sim, rideType);
  buildCircuit(sim, rideId, layout);
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
  run(sim, 6000);
  return { sim, rideId };
}

describe('track element measurement', () => {
  it('counts turns by size and banking and helices along the centre line', () => {
    const sim = flatOwnedSim(1);
    const rideId = createCoaster(sim);
    buildCircuit(sim, rideId, [
      ['station', N],
      ['smallRight', N],
      ['mediumLeft', N],
      ['largeRight', N],
      ['largeLeft', N],
      ['flatToRightBank', N],
      ['smallHelixRightUp', N],
    ]);
    const stats = measureTrackElements(sim.world, getTrackPath(sim.world, rideId)!);
    expect(stats.flatTurns).toEqual([1, 1, 2]);
    expect(stats.bankedTurns).toEqual([0, 0, 0]);
    expect(stats.helices).toBe(1);
    expect(stats.shelteredLength).toBe(0);
    expect(stats.shelteredSections).toBe(0);
  });

  it('counts banked turns separately from flat turns', () => {
    const sim = flatOwnedSim(1);
    const rideId = createCoaster(sim);
    buildCircuit(sim, rideId, [
      ['station', N],
      ['flatToRightBank', N],
      ['mediumRightBanked', N],
    ]);
    const stats = measureTrackElements(sim.world, getTrackPath(sim.world, rideId)!);
    expect(stats.bankedTurns).toEqual([0, 1, 0]);
    expect(stats.flatTurns).toEqual([0, 0, 0]);
  });

  it('measures track that runs below the terrain as one sheltered section', () => {
    const sim = flatOwnedSim(1);
    const rideId = createCoaster(sim);
    buildCircuit(sim, rideId, [
      ['station', N],
      ['flat', N],
      ['flat', N],
    ]);
    sim.world.map.fillFlat(10);
    const stats = measureTrackElements(sim.world, getTrackPath(sim.world, rideId)!);
    expect(stats.shelteredSections).toBe(1);
    expect(stats.shelteredLength).toBeGreaterThan(0);
  });
});

describe('ratings written by a test run', () => {
  it('rates the starter coaster as before within a few hundredths', () => {
    const { sim, rideId } = tested(SMALL_CIRCUIT);
    const r = ratings(sim, rideId);
    expect(r.e).toBeGreaterThan(440);
    expect(r.e).toBeLessThan(500);
    expect(r.i).toBeGreaterThan(440);
    expect(r.i).toBeLessThan(500);
    expect(r.n).toBeGreaterThan(140);
    expect(r.n).toBeLessThan(190);
  });

  it('adds scenery near the station to excitement only', () => {
    const plain = tested(SMALL_CIRCUIT);
    const scenic = tested(SMALL_CIRCUIT, RideType.WoodenCoaster, (sim) => {
      for (let i = 0; i < 10; i++) {
        const tile = sim.world.map.index(STATION_X + (i % 5), STATION_Y + 3 + Math.trunc(i / 5));
        sim.world.map.addElement(tile, ElementType.SmallScenery, 2, 3, 0, 0);
      }
      sim.world.map.ownership.fill(OWNED);
    });
    const a = ratings(plain.sim, plain.rideId);
    const b = ratings(scenic.sim, scenic.rideId);
    expect(b.e - a.e).toBe(50);
    expect(b.i).toBe(a.i);
    expect(b.n).toBe(a.n);
  });

  it('divides the ratings of a coaster that has no drop', () => {
    const flatLayout: Layout = SMALL_CIRCUIT.map(([name, mode]) =>
      ['flatToUp25', 'up25', 'up25ToFlat', 'flatToDown25', 'down25', 'down25ToFlat'].includes(name)
        ? (['flat', PieceMode.ChainLift] as const)
        : ([name, mode] as const),
    );
    const dropless = tested(flatLayout);
    const starter = tested(SMALL_CIRCUIT);
    expect(ratings(dropless.sim, dropless.rideId).e).toBeGreaterThan(0);
    expect(ratings(dropless.sim, dropless.rideId).e).toBeLessThan(
      ratings(starter.sim, starter.rideId).e / 2,
    );
  });
});

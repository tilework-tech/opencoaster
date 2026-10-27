import { describe, expect, it } from 'vitest';
import { TRACK_Z_STEP, Z_STEP } from '../sim/core/constants';
import {
  SMALL_CIRCUIT,
  buildCircuit,
  connectStation,
  createCoaster,
  flatOwnedSim,
  run,
} from '../sim/rides/coaster-fixtures';
import { Simulation } from '../sim/core/simulation';
import { RideState } from '../sim/rides/ride-store';
import { PIECES, pieceByName } from '../sim/track/catalog';
import { circuitStatus, getConstructionCursor } from '../sim/track/construction';
import { getTrackPath } from '../sim/track/track-path';
import type { World } from '../sim/core/world';
import { deserialize, serialize } from './save';
import { serializeAsLegacyRideSchema } from './legacy-save-test-utils';

/**
 * Rewrites stored piece heights in whole land levels, as version 25 saves held them, laying the
 * chain forward from its station.
 */
function storeOldHeights(world: World, rideId: number, oldDz: (name: string) => number): void {
  const t = world.track;
  const c = t.pieces.cols;
  let id = t.head[rideId];
  while (PIECES[c.pieceType[t.pieces.idToSlot[id]]].name !== 'station')
    id = c.next[t.pieces.idToSlot[id]];
  const station = id;
  let level = (c.z[t.pieces.idToSlot[id]] * TRACK_Z_STEP) / Z_STEP;
  do {
    const slot = t.pieces.idToSlot[id];
    c.z[slot] = level;
    level += oldDz(PIECES[c.pieceType[slot]].name);
    id = c.next[slot];
  } while (id >= 0 && id !== station);
}

/** Moves the head of a closed circuit to the top of its climb, as removing a piece can. */
function moveHeadToCrest(world: World, rideId: number): void {
  const t = world.track;
  const c = t.pieces.cols;
  for (let step = 0; step < 3; step++) {
    t.tail[rideId] = t.head[rideId];
    t.head[rideId] = c.next[t.pieces.idToSlot[t.head[rideId]]];
  }
}

/** Whole-level rises of the version 25 catalog, for the pieces these tests use. */
const V25_DZ: Record<string, number> = {
  station: 0,
  flat: 0,
  smallRight: 0,
  flatToUp25: 1,
  up25: 2,
  up25ToFlat: 1,
  flatToDown25: -1,
  down25: -2,
  down25ToFlat: -1,
};

describe('loading saves with whole-level track', () => {
  it('keeps the station height and reconnects every piece on the half-level grid', () => {
    const sim = flatOwnedSim(1);
    const rideId = createCoaster(sim);
    buildCircuit(sim, rideId, SMALL_CIRCUIT);
    const stationZ = getTrackPath(sim.world, rideId)!.z[0];
    moveHeadToCrest(sim.world, rideId);
    storeOldHeights(sim.world, rideId, (name) => V25_DZ[name]);

    const loaded = deserialize(serializeAsLegacyRideSchema(sim.world, serialize(sim.world), 25));

    const c = loaded.track.pieces.cols;
    let station = loaded.track.head[rideId];
    while (c.pieceType[loaded.track.pieces.idToSlot[station]] !== pieceByName('station')!.id)
      station = c.next[loaded.track.pieces.idToSlot[station]];
    expect(c.z[loaded.track.pieces.idToSlot[station]] * TRACK_Z_STEP).toBe(stationZ);
    const path = getTrackPath(loaded, rideId)!;
    expect(circuitStatus(loaded, rideId).closed).toBe(true);
    let top = 0;
    for (let i = 0; i < path.count; i++) top = Math.max(top, path.z[i]);
    expect(Math.min(...path.z.subarray(0, path.count))).toBe(stationZ);
    expect(top - stationZ).toBe(2 * Z_STEP);
    for (let i = 1; i < path.count; i++) {
      expect(Math.abs(path.z[i] - path.z[i - 1])).toBeLessThan(Z_STEP);
    }
    expect(loaded.track.length[rideId]).toBe(path.length);
  });

  it('closes a reshaped ride and asks for a new test before it can reopen', () => {
    const sim = flatOwnedSim(1);
    const rideId = createCoaster(sim);
    buildCircuit(sim, rideId, SMALL_CIRCUIT);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    run(sim, 6000);
    connectStation(sim, rideId);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    run(sim, 200);
    const slot = sim.world.rides.idToSlot[rideId];
    expect(sim.world.rides.cols.state[slot]).toBe(RideState.Open);
    storeOldHeights(sim.world, rideId, (name) => V25_DZ[name]);

    const loaded = deserialize(serializeAsLegacyRideSchema(sim.world, serialize(sim.world), 25));

    const loadedSlot = loaded.rides.idToSlot[rideId];
    expect(loaded.rides.cols.state[loadedSlot]).toBe(RideState.Closed);
    expect(loaded.rides.cols.tested[loadedSlot]).toBe(0);
    let trains = 0;
    for (let v = 0; v < loaded.vehicles.count; v++)
      if (loaded.vehicles.cols.rideId[v] === rideId) trains++;
    expect(trains).toBe(0);
    const reopen = new Simulation(loaded);
    reopen.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    reopen.step();
    expect(reopen.world.rides.cols.state[loadedSlot]).toBe(RideState.Closed);
  });

  it('reopens and closes a stored circuit whose pieces no longer meet end to end', () => {
    const sim = flatOwnedSim(1);
    const rideId = createCoaster(sim);
    buildCircuit(sim, rideId, SMALL_CIRCUIT);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    sim.step();
    const t = sim.world.track;
    const c = t.pieces.cols;
    const second = c.next[t.pieces.idToSlot[t.head[rideId]]];
    const up = t.pieces.idToSlot[c.next[t.pieces.idToSlot[second]]];
    c.pieceType[up] = pieceByName('up60')!.id;
    storeOldHeights(sim.world, rideId, (name) => (name === 'up60' ? 2 : V25_DZ[name]));

    const loaded = deserialize(serializeAsLegacyRideSchema(sim.world, serialize(sim.world), 25));

    expect(circuitStatus(loaded, rideId).closed).toBe(false);
    expect(getConstructionCursor(loaded, rideId).hasTrack).toBe(true);
    expect(loaded.rides.cols.state[loaded.rides.idToSlot[rideId]]).toBe(RideState.Closed);
  });
  it('keeps a circuit closed when the new piece rises leave it short, by ramping level track', () => {
    const sim = flatOwnedSim(1);
    const rideId = createCoaster(sim);
    buildCircuit(sim, rideId, SMALL_CIRCUIT);
    const t = sim.world.track;
    const c = t.pieces.cols;
    const slots: number[] = [];
    for (let id = t.head[rideId]; id >= 0 && slots.length < 14; id = c.next[t.pieces.idToSlot[id]])
      slots.push(t.pieces.idToSlot[id]);
    const flat = pieceByName('flat')!.id;
    c.pieceType[slots[7]] = flat;
    c.pieceType[slots[9]] = flat;
    storeOldHeights(sim.world, rideId, (name) => V25_DZ[name]);

    const loaded = deserialize(serializeAsLegacyRideSchema(sim.world, serialize(sim.world), 25));

    expect(circuitStatus(loaded, rideId).closed).toBe(true);
    const lt = loaded.track;
    const lc = lt.pieces.cols;
    let rise = 0;
    for (let id = lt.head[rideId], n = 0; n < lt.count[rideId]; n++) {
      const slot = lt.pieces.idToSlot[id];
      rise += PIECES[lc.pieceType[slot]].dz;
      id = lc.next[slot];
    }
    expect(rise).toBe(0);
  });
});

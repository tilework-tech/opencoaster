import { describe, expect, it } from 'vitest';
import { TRACK_Z_STEP, Z_STEP } from '../sim/core/constants';
import {
  SMALL_CIRCUIT,
  buildCircuit,
  createCoaster,
  flatOwnedSim,
} from '../sim/rides/coaster-fixtures';
import { RideState } from '../sim/rides/ride-store';
import { PIECES, pieceByName } from '../sim/track/catalog';
import { circuitStatus, getConstructionCursor } from '../sim/track/construction';
import { getTrackPath } from '../sim/track/track-path';
import type { World } from '../sim/core/world';
import { SAVE_VERSION, deserialize, serialize } from './save';

/** Re-labels a current save as a version 25 file, the last version that stored whole-level track. */
function asVersion25(bytes: Uint8Array): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = dv.getUint32(4, true);
  const json = new TextDecoder().decode(bytes.subarray(8, 8 + headerLen));
  const patched = new TextEncoder().encode(
    json.replace(`"version":${SAVE_VERSION}`, '"version":25'),
  );
  expect(patched.length).toBe(headerLen);
  const out = bytes.slice();
  out.set(patched, 8);
  return out;
}

/** Rewrites stored piece heights in whole land levels, as version 25 saves held them. */
function storeOldHeights(world: World, rideId: number, oldDz: (name: string) => number): void {
  const t = world.track;
  const c = t.pieces.cols;
  let id = t.head[rideId];
  let level = (c.z[t.pieces.idToSlot[id]] * TRACK_Z_STEP) / Z_STEP;
  do {
    const slot = t.pieces.idToSlot[id];
    c.z[slot] = level;
    level += oldDz(PIECES[c.pieceType[slot]].name);
    id = c.next[slot];
  } while (id >= 0 && id !== t.head[rideId]);
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
    storeOldHeights(sim.world, rideId, (name) => V25_DZ[name]);

    const loaded = deserialize(asVersion25(serialize(sim.world)));

    const path = getTrackPath(loaded, rideId)!;
    expect(path.z[0]).toBe(stationZ);
    expect(circuitStatus(loaded, rideId).closed).toBe(true);
    let top = 0;
    for (let i = 0; i < path.count; i++) top = Math.max(top, path.z[i]);
    expect(top - stationZ).toBe(2 * Z_STEP);
    for (let i = 1; i < path.count; i++) {
      expect(Math.abs(path.z[i] - path.z[i - 1])).toBeLessThan(Z_STEP);
    }
    expect(loaded.track.length[rideId]).toBe(path.length);
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

    const loaded = deserialize(asVersion25(serialize(sim.world)));

    expect(circuitStatus(loaded, rideId).closed).toBe(false);
    expect(getConstructionCursor(loaded, rideId).hasTrack).toBe(true);
    expect(loaded.rides.cols.state[loaded.rides.idToSlot[rideId]]).toBe(RideState.Closed);
  });
});

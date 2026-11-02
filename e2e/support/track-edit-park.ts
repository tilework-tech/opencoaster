import { TRACK_STEPS_PER_LEVEL } from '../../src/sim/core/constants';
import type { Simulation } from '../../src/sim/core/simulation';
import { RideType } from '../../src/sim/rides/ride-types';
import {
  GROUND,
  buildCircuit,
  connectStation,
  createCoaster,
  flatOwnedSim,
  run,
} from '../../src/sim/rides/coaster-fixtures';
import { pieceByName } from '../../src/sim/track/catalog';
import { getConstructionCursor } from '../../src/sim/track/construction';
import { PieceMode } from '../../src/sim/track/track-types';
import { serialize } from '../../src/save/save';

/** Unfinished coaster: station then straights running +x from this tile at ground level. */
export const UNFINISHED_START = { x: 8, y: 36 };
export const UNFINISHED_PIECES = ['station', 'flat', 'flat', 'flat', 'flat', 'flat', 'flat'];
/** Overpass: straights running +y across the unfinished coaster's fourth piece, four levels up. */
export const OVERPASS_START = { x: 11, y: 33 };
export const OVERPASS_LEVELS = 4;

function line(
  sim: Simulation,
  rideId: number,
  names: readonly string[],
  start: { x: number; y: number },
  level: number,
  dir: number,
): void {
  for (const name of names) {
    const cursor = getConstructionCursor(sim.world, rideId);
    sim.enqueue({
      type: 'placeTrack',
      rideId,
      pieceType: pieceByName(name)!.id,
      x: cursor.hasTrack ? cursor.x : start.x,
      y: cursor.hasTrack ? cursor.y : start.y,
      z: cursor.hasTrack ? cursor.z : level * TRACK_STEPS_PER_LEVEL,
      dir: cursor.hasTrack ? cursor.dir : dir,
      mode: PieceMode.Normal,
    });
    sim.step();
  }
}

/**
 * A paused-friendly park for track editing: a tested, closed coaster with its entrance and exit
 * (ride 1), an unfinished coaster (ride 2), and a second unfinished coaster passing over ride 2's
 * track four levels up (ride 3).
 */
export function trackEditPark(): Uint8Array {
  const sim = flatOwnedSim(1);
  const circuit = createCoaster(sim, RideType.WoodenCoaster);
  buildCircuit(sim, circuit);
  connectStation(sim, circuit);
  sim.enqueue({ type: 'setRideStatus', rideId: circuit, status: 'test' });
  run(sim, 8000);
  const unfinished = createCoaster(sim, RideType.WoodenCoaster, 4, 40);
  line(sim, unfinished, UNFINISHED_PIECES, UNFINISHED_START, GROUND, 0);
  const overpass = createCoaster(sim, RideType.WoodenCoaster, 4, 44);
  line(
    sim,
    overpass,
    ['flat', 'flat', 'flat', 'flat', 'flat', 'flat'],
    OVERPASS_START,
    GROUND + OVERPASS_LEVELS,
    1,
  );
  run(sim, 10);
  return serialize(sim.world);
}

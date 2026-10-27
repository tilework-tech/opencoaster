import type { World } from '../core/world';
import { createVehicleTrackFromPath, VehicleTrackRegistry } from '../vehicles/vehicle-track';
import type { VehicleTrack } from '../vehicles/vehicle-track';
import { stepVehicles } from '../vehicles/vehicle-system';
import { spawnRideTrain } from '../vehicles/ride-trains';
import { VehicleState } from '../vehicles/vehicle-store';
import { TEST_TIMEOUT_TICKS as PROBE_TICKS } from '../rides/coaster-system';
import { PIECES } from './catalog';
import { relinkRide } from './construction';
import { getTrackPath } from './track-path';
import type { TrackPath } from './track-path';
import { PieceFlag, PieceMode } from './track-types';

/** Ticks at a standstill after which a train counts as stalled. */
const STANDSTILL_TICKS = 200;
/** Most lifts added per ride. */
const MAX_LIFTS = 24;
/** Level pieces behind a stall that are searched for one a lift fits on. */
const LEVEL_LOOKBEHIND = 8;

function segmentAt(track: VehicleTrack, positionQ8: number): number {
  const cumulative = track.cumulativeLengthsQ8;
  let segment = 0;
  while (segment + 1 < track.segmentLengths.length && cumulative[segment + 1] <= positionQ8)
    segment++;
  return segment;
}

/**
 * Runs one empty test train round the ride on its own. Returns the id of the piece the
 * train stopped on, or -1 when it completed the lap.
 */
function probeLap(world: World, rideId: number, path: TrackPath): number {
  const track = createVehicleTrackFromPath(world, path);
  const tracks = new VehicleTrackRegistry();
  tracks.set(track);
  const capacity = world.rides.cols.capacity[world.rides.idToSlot[rideId]];
  const train = spawnRideTrain(world, rideId, VehicleState.Testing, capacity);
  if (train < 0) return -1;
  const tick = world.tick;
  const cols = world.vehicles.cols;
  let stoppedAt = -1;
  let standstill = 0;
  for (let i = 0; i < PROBE_TICKS && stoppedAt < 0; i++) {
    world.tick++;
    stepVehicles(world, tracks);
    const state = cols.state[train];
    if (state === VehicleState.TestComplete) break;
    standstill = cols.speed[train] === 0 ? standstill + 1 : 0;
    if (state !== VehicleState.Testing || standstill >= STANDSTILL_TICKS || i === PROBE_TICKS - 1)
      stoppedAt = segmentAt(track, cols.trackPos[train]);
  }
  world.vehicles.despawnSlot(train);
  world.tick = tick;
  return stoppedAt < 0 ? -1 : path.piece[stoppedAt];
}

/**
 * Puts a chain lift where a train died: on the whole climb it stalled on, or, when it ran out of
 * speed on level track, on the level run that reaches it (a brake there is replaced) and on to the
 * next slope. Returns false when nothing there can take a lift.
 */
function liftAt(world: World, rideId: number, stalledPiece: number): boolean {
  const t = world.track;
  const c = t.pieces.cols;
  const slotOf = (id: number) => t.pieces.idToSlot[id];
  const dz = (id: number) => PIECES[c.pieceType[slotOf(id)]].dz;
  const climbing = dz(stalledPiece) > 0;
  const fits = (id: number) => {
    const slot = slotOf(id);
    const mode = c.mode[slot];
    return (
      (mode === PieceMode.Normal || (!climbing && mode === PieceMode.Brake)) &&
      (PIECES[c.pieceType[slot]].flags & PieceFlag.LiftOk) !== 0
    );
  };
  const level = (id: number) => (climbing ? dz(id) > 0 : dz(id) === 0);
  let first = stalledPiece;
  for (let n = 0; n < (climbing ? t.count[rideId] : LEVEL_LOOKBEHIND); n++) {
    const before = c.prev[slotOf(first)];
    if (before < 0 || !level(before) || before === stalledPiece) break;
    first = before;
  }
  let lifted = false;
  for (let id = first; id >= 0 && level(id); id = c.next[slotOf(id)]) {
    if (!fits(id)) continue;
    c.mode[slotOf(id)] = PieceMode.ChainLift;
    lifted = true;
  }
  return lifted;
}

/**
 * Chain-lifts the climbs and level runs of a closed circuit until an empty train completes a lap on its own, so a
 * ride that lost momentum to a layout change keeps running without being rebuilt. Stops at the
 * first stall no lift can fix.
 */
export function liftStalledClimbs(world: World, rideId: number): void {
  for (let lifts = 0; lifts < MAX_LIFTS; lifts++) {
    const path = getTrackPath(world, rideId);
    if (!path) return;
    const stalledPiece = probeLap(world, rideId, path);
    if (stalledPiece < 0 || !liftAt(world, rideId, stalledPiece)) return;
    relinkRide(world, rideId);
  }
}

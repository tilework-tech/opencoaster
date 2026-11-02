import { describe, expect, it } from 'vitest';
import { TRACK_STEPS_PER_LEVEL } from '../core/constants';
import { FeedbackDomain } from '../core/feedback';
import type { Simulation } from '../core/simulation';
import type { Command } from '../core/commands';
import { pieceByName } from '../track/catalog';
import { circuitStatus, getConstructionCursor } from '../track/construction';
import { TrackNotice, TrackResult } from '../track/track-types';
import { VehicleState } from '../vehicles/vehicle-store';
import {
  GROUND,
  SMALL_CIRCUIT,
  STATION_X,
  STATION_Y,
  connectStation,
  createCoaster,
  flatOwnedSim,
  queueGuests,
  run,
} from './coaster-fixtures';
import { isRideTested } from './ride-operations';
import { RideResult } from './ride-results';
import { RidePhase, RideState } from './ride-store';

const TEST_RUN_TICKS = 6000;

type PlaceTrack = Extract<Command, { type: 'placeTrack' }>;

/** Builds SMALL_CIRCUIT one piece per tick and returns each piece's id and placement command. */
function buildRecorded(
  sim: Simulation,
  rideId: number,
): Array<{ id: number; command: PlaceTrack }> {
  const built: Array<{ id: number; command: PlaceTrack }> = [];
  for (const [name, mode] of SMALL_CIRCUIT) {
    const cursor = getConstructionCursor(sim.world, rideId);
    const command: PlaceTrack = {
      type: 'placeTrack',
      rideId,
      pieceType: pieceByName(name)!.id,
      x: cursor.hasTrack ? cursor.x : STATION_X,
      y: cursor.hasTrack ? cursor.y : STATION_Y,
      z: cursor.hasTrack ? cursor.z : GROUND * TRACK_STEPS_PER_LEVEL,
      dir: cursor.hasTrack ? cursor.dir : 0,
      mode,
    };
    sim.enqueue(command);
    sim.step();
    built.push({ id: sim.world.track.lastPiece, command });
  }
  return built;
}

function testedCoaster() {
  const sim = flatOwnedSim(1);
  const rideId = createCoaster(sim);
  const built = buildRecorded(sim, rideId);
  connectStation(sim, rideId);
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
  run(sim, TEST_RUN_TICKS);
  expect(isRideTested(sim.world, rideId)).toBe(true);
  return { sim, rideId, built, slot: sim.world.rides.idToSlot[rideId] };
}

function command(sim: Simulation, c: Command): void {
  sim.enqueue(c);
  sim.step();
}

function trackFeedback(sim: Simulation): number {
  expect(sim.world.feedback.domain).toBe(FeedbackDomain.Track);
  return sim.world.feedback.code;
}

describe('editing a built coaster from a chosen piece', () => {
  it('rebuilds a removed middle piece, passes a new test and opens with riders', () => {
    const { sim, rideId, built, slot } = testedCoaster();
    const turn = built[6];

    command(sim, { type: 'removeTrack', rideId, pieceId: turn.id });
    expect(trackFeedback(sim)).toBe(TrackNotice.Removed);
    expect(circuitStatus(sim.world, rideId)).toMatchObject({ closed: false, pieces: 13 });
    expect(isRideTested(sim.world, rideId)).toBe(false);
    for (const piece of built) {
      if (piece !== turn) expect(sim.world.track.pieces.isAlive(piece.id)).toBe(true);
    }

    command(sim, { type: 'setRideStatus', rideId, status: 'test' });
    expect(sim.world.feedback.code).toBe(RideResult.TrackIncomplete);

    command(sim, turn.command);
    expect(trackFeedback(sim)).toBe(TrackResult.Ok);
    expect(circuitStatus(sim.world, rideId).complete).toBe(true);

    command(sim, { type: 'setRideStatus', rideId, status: 'test' });
    run(sim, TEST_RUN_TICKS);
    expect(isRideTested(sim.world, rideId)).toBe(true);
    command(sim, { type: 'setRideStatus', rideId, status: 'open' });
    expect(sim.world.feedback.code).toBe(RideResult.Ok);
    queueGuests(sim, rideId, 8);
    run(sim, 3000);
    expect(sim.world.rides.cols.guestsServed[slot]).toBeGreaterThan(0);
  });

  it('refuses to change the track of an open ride and leaves it running', () => {
    const { sim, rideId, built, slot } = testedCoaster();
    command(sim, { type: 'setRideStatus', rideId, status: 'open' });

    command(sim, { type: 'removeTrack', rideId, pieceId: built[6].id });
    expect(trackFeedback(sim)).toBe(TrackResult.RideBusy);
    command(sim, { type: 'removeTrack', rideId, pieceId: -1 });
    expect(trackFeedback(sim)).toBe(TrackResult.RideBusy);

    expect(sim.world.track.pieces.isAlive(built[6].id)).toBe(true);
    expect(circuitStatus(sim.world, rideId).complete).toBe(true);
    expect(sim.world.rides.cols.state[slot]).toBe(RideState.Open);
    expect(isRideTested(sim.world, rideId)).toBe(true);
  });

  it('refuses edits while a closed ride still has a loaded train out, then allows them once it is back', () => {
    const { sim, rideId, built, slot } = testedCoaster();
    command(sim, { type: 'setRideStatus', rideId, status: 'open' });
    queueGuests(sim, rideId, 12);
    for (let i = 0; i < 2000 && sim.world.vehicles.cols.state[0] !== VehicleState.Running; i++)
      sim.step();
    expect(sim.world.vehicles.cols.state[0]).toBe(VehicleState.Running);
    command(sim, { type: 'setRideStatus', rideId, status: 'close' });
    const riders = sim.world.vehicles.cols.passengers[0];
    const servedBefore = sim.world.rides.cols.guestsServed[slot];
    expect(riders).toBeGreaterThan(0);

    command(sim, { type: 'removeTrack', rideId, pieceId: built[6].id });
    expect(trackFeedback(sim)).toBe(TrackResult.RideBusy);
    expect(sim.world.vehicles.cols.passengers[0]).toBe(riders);

    for (let i = 0; i < 4000 && sim.world.rides.cols.phase[slot] !== RidePhase.Closed; i++)
      sim.step();
    expect(sim.world.rides.cols.phase[slot]).toBe(RidePhase.Closed);
    command(sim, { type: 'removeTrack', rideId, pieceId: built[6].id });
    expect(trackFeedback(sim)).toBe(TrackNotice.Removed);
    expect(sim.world.rides.cols.guestsServed[slot]).toBe(servedBefore + riders);
  });

  it('refuses edits during a test run', () => {
    const { sim, rideId, built } = testedCoaster();
    command(sim, { type: 'removeTrack', rideId, pieceId: built[6].id });
    command(sim, built[6].command);
    command(sim, { type: 'setRideStatus', rideId, status: 'test' });
    command(sim, { type: 'removeTrack', rideId, pieceId: built[6].id });
    expect(trackFeedback(sim)).toBe(TrackResult.RideBusy);
    expect(circuitStatus(sim.world, rideId).complete).toBe(true);
  });

  it('takes the entrance off the ride when the station beside it is removed', () => {
    const { sim, rideId, built } = testedCoaster();
    const station = built[0];

    command(sim, { type: 'removeTrack', rideId, pieceId: station.id });
    command(sim, station.command);
    expect(circuitStatus(sim.world, rideId).complete).toBe(true);
    command(sim, { type: 'setRideStatus', rideId, status: 'test' });
    run(sim, TEST_RUN_TICKS);
    expect(isRideTested(sim.world, rideId)).toBe(true);
    command(sim, { type: 'setRideStatus', rideId, status: 'open' });
    expect(sim.world.feedback.code).toBe(RideResult.NoEntrance);

    connectStation(sim, rideId);
    command(sim, { type: 'setRideStatus', rideId, status: 'open' });
    expect(sim.world.feedback.code).toBe(RideResult.Ok);
  });
});

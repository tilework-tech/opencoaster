import { describe, expect, it } from 'vitest';
import { hashWorld } from '../core/hash';
import { FeedbackDomain } from '../core/feedback';
import { Simulation } from '../core/simulation';
import { deserialize, serialize } from '../../save/save';
import { PieceId, pieceByName } from '../track/catalog';
import { circuitStatus } from '../track/construction';
import { GuestState } from '../guests/guest-store';
import { PieceMode, TrackResult } from '../track/track-types';
import { VehicleState } from '../vehicles/vehicle-store';
import {
  GROUND,
  STATION_X,
  STATION_Y,
  buildCircuit,
  connectStation,
  createCoaster,
  flatOwnedSim,
  queueGuests,
  run,
} from './coaster-fixtures';
import { getRideTestMeasurements, isRideTested } from './ride-operations';
import { RideResult } from './ride-results';
import { RIDE_CATALOG, RideType } from './ride-types';
import { RidePhase, RideState } from './ride-store';

const TEST_RUN_TICKS = 6000;

function testedCoaster(seed = 1, rideType: RideType = RideType.WoodenCoaster) {
  const sim = flatOwnedSim(seed);
  const rideId = createCoaster(sim, rideType);
  buildCircuit(sim, rideId);
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
  run(sim, TEST_RUN_TICKS);
  return { sim, rideId };
}

function ratings(sim: Simulation, rideId: number) {
  const slot = sim.world.rides.idToSlot[rideId];
  const r = sim.world.rides.cols;
  return [r.excitement[slot], r.intensity[slot], r.nausea[slot]];
}

describe('coaster catalog', () => {
  it('offers wooden and steel looping coasters that use track', () => {
    expect(RIDE_CATALOG[RideType.WoodenCoaster].usesTrack).toBe(true);
    expect(RIDE_CATALOG[RideType.SteelLoopingCoaster].usesTrack).toBe(true);
    expect(RIDE_CATALOG[RideType.WoodenCoaster].category).toBe('coaster');
  });
});

describe('coaster test run', () => {
  it('builds a closed chain-lift circuit, tests it and produces deterministic ratings', () => {
    const a = testedCoaster(1);
    const b = testedCoaster(1);
    expect(circuitStatus(a.sim.world, a.rideId).complete).toBe(true);

    const slot = a.sim.world.rides.idToSlot[a.rideId];
    expect(a.sim.world.rides.cols.state[slot]).toBe(RideState.Closed);
    expect(isRideTested(a.sim.world, a.rideId)).toBe(true);
    const [excitement, intensity] = ratings(a.sim, a.rideId);
    expect(excitement).toBeGreaterThan(0);
    expect(intensity).toBeGreaterThan(0);
    expect(getRideTestMeasurements(a.sim.world, a.rideId)!.maxSpeed).toBeGreaterThan(0);

    expect(ratings(b.sim, b.rideId)).toEqual(ratings(a.sim, a.rideId));
    expect(hashWorld(b.sim.world)).toBe(hashWorld(a.sim.world));
  });

  it('gives the steel coaster a different rating from the wooden one on the same layout', () => {
    const wooden = testedCoaster(1, RideType.WoodenCoaster);
    const steel = testedCoaster(1, RideType.SteelLoopingCoaster);
    expect(ratings(steel.sim, steel.rideId)).not.toEqual(ratings(wooden.sim, wooden.rideId));
  });

  it('reports an incomplete circuit as the command result and does not start a test', () => {
    const sim = flatOwnedSim();
    const rideId = createCoaster(sim);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    sim.step();
    expect(sim.world.feedback.domain).toBe(FeedbackDomain.Ride);
    expect(sim.world.feedback.code).toBe(RideResult.TrackIncomplete);
    expect(sim.world.vehicles.count).toBe(0);
  });

  it('fails a test run whose train cannot finish the lap', () => {
    const sim = flatOwnedSim();
    const rideId = createCoaster(sim);
    buildCircuit(sim, rideId, [
      ['station', PieceMode.Normal],
      ['flatToUp25', PieceMode.Normal],
      ['up25', PieceMode.Normal],
      ['up25ToFlat', PieceMode.Normal],
      ['smallRight', PieceMode.Normal],
      ['flat', PieceMode.Normal],
      ['smallRight', PieceMode.Normal],
      ['flatToDown25', PieceMode.Normal],
      ['down25', PieceMode.Normal],
      ['down25ToFlat', PieceMode.Normal],
      ['flat', PieceMode.Normal],
      ['smallRight', PieceMode.Normal],
      ['flat', PieceMode.Normal],
      ['smallRight', PieceMode.Normal],
    ]);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    run(sim, TEST_RUN_TICKS * 2);
    const slot = sim.world.rides.idToSlot[rideId];
    expect(sim.world.rides.cols.state[slot]).toBe(RideState.Closed);
    expect(isRideTested(sim.world, rideId)).toBe(false);
    expect(sim.world.feedback.code).toBe(RideResult.TestFailed);
  });
});

describe('launched coaster', () => {
  it('reaches a higher top speed than the same hills climbed on a chain lift', () => {
    const launched: Array<readonly [string, PieceMode]> = [
      ['station', PieceMode.Normal],
      ['flat', PieceMode.Launch],
      ['flat', PieceMode.Launch],
      ['flatToUp25', PieceMode.Normal],
      ['up25', PieceMode.Normal],
      ['up25ToFlat', PieceMode.Normal],
      ['smallRight', PieceMode.Normal],
      ['smallRight', PieceMode.Normal],
      ['flatToDown25', PieceMode.Normal],
      ['down25', PieceMode.Normal],
      ['down25ToFlat', PieceMode.Normal],
      ['flat', PieceMode.Normal],
      ['flat', PieceMode.Normal],
      ['flat', PieceMode.Normal],
      ['smallRight', PieceMode.Normal],
      ['smallRight', PieceMode.Normal],
    ];
    const sim = flatOwnedSim();
    const rideId = createCoaster(sim, RideType.SteelLoopingCoaster);
    buildCircuit(sim, rideId, launched);
    expect(circuitStatus(sim.world, rideId).complete).toBe(true);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    run(sim, TEST_RUN_TICKS);
    const chain = testedCoaster(1, RideType.SteelLoopingCoaster);
    expect(isRideTested(sim.world, rideId)).toBe(true);
    expect(getRideTestMeasurements(sim.world, rideId)!.maxSpeed).toBeGreaterThan(
      getRideTestMeasurements(chain.sim.world, chain.rideId)!.maxSpeed,
    );
  });
});

describe('opening a coaster', () => {
  it('refuses to open before a test run, then before entrance and exit are placed', () => {
    const sim = flatOwnedSim();
    const rideId = createCoaster(sim);
    buildCircuit(sim, rideId);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    sim.step();
    expect(sim.world.feedback.code).toBe(RideResult.NotTested);

    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    run(sim, TEST_RUN_TICKS);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    sim.step();
    expect(sim.world.feedback.code).toBe(RideResult.NoEntrance);
  });

  it('rejects an entrance that is not next to the station', () => {
    const sim = flatOwnedSim();
    const rideId = createCoaster(sim);
    buildCircuit(sim, rideId);
    sim.enqueue({ type: 'placeRideEntrance', rideId, x: STATION_X + 8, y: STATION_Y - 8 });
    sim.step();
    expect(sim.world.feedback.code).toBe(RideResult.NotAdjacentToStation);
    const slot = sim.world.rides.idToSlot[rideId];
    expect(sim.world.rides.cols.entrancePlaced[slot]).toBe(0);
  });

  it('dispatches trains and loads guests from the queue once open', () => {
    const { sim, rideId } = testedCoaster();
    connectStation(sim, rideId);
    const slot = sim.world.rides.idToSlot[rideId];
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    sim.step();
    expect(sim.world.feedback.code).toBe(RideResult.Ok);
    expect(sim.world.rides.cols.state[slot]).toBe(RideState.Open);

    queueGuests(sim, rideId, 40);
    const states = new Set<number>();
    let maxRiding = 0;
    for (let i = 0; i < 6000; i++) {
      sim.step();
      for (let v = 0; v < sim.world.vehicles.count; v++)
        states.add(sim.world.vehicles.cols.state[v]);
      let riding = 0;
      for (let g = 0; g < sim.world.guests.count; g++) {
        if (sim.world.guests.cols.state[g] === GuestState.Riding) riding++;
      }
      maxRiding = Math.max(maxRiding, riding);
    }
    expect(states.has(VehicleState.Running)).toBe(true);
    expect(maxRiding).toBe(RIDE_CATALOG[RideType.WoodenCoaster].capacity);
    expect(sim.world.rides.cols.guestsServed[slot]).toBeGreaterThan(0);
    expect(sim.world.rides.cols.queueLength[slot]).toBeLessThan(40);
    expect(sim.world.rides.cols.cyclesCompleted[slot]).toBeGreaterThan(0);
  });

  it('never sends out a train without passengers', () => {
    const { sim, rideId } = testedCoaster();
    connectStation(sim, rideId);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    queueGuests(sim, rideId, 20);
    const v = sim.world.vehicles.cols;
    let dispatched = 0;
    for (let i = 0; i < 6000; i++) {
      sim.step();
      for (let t = 0; t < sim.world.vehicles.count; t++) {
        if (v.state[t] === VehicleState.Running) {
          dispatched++;
          expect(v.passengers[t]).toBeGreaterThan(0);
        }
      }
    }
    expect(dispatched).toBeGreaterThan(0);
  });

  it('invalidates the test and closes the ride when the track is edited', () => {
    const { sim, rideId } = testedCoaster();
    connectStation(sim, rideId);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    sim.step();
    sim.enqueue({ type: 'removeTrack', rideId, pieceId: -1 });
    sim.step();
    const slot = sim.world.rides.idToSlot[rideId];
    expect(sim.world.rides.cols.state[slot]).toBe(RideState.Closed);
    expect(isRideTested(sim.world, rideId)).toBe(false);
  });

  it('round-trips a running coaster through save and load without diverging', () => {
    const { sim, rideId } = testedCoaster();
    connectStation(sim, rideId);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    sim.step();
    queueGuests(sim, rideId, 30);
    run(sim, 700);
    const copy = new Simulation({ seed: 1, width: 48, height: 48, maxGuests: 64 });
    Object.assign(copy, { world: deserialize(serialize(sim.world)) });
    expect(hashWorld(copy.world)).toBe(hashWorld(sim.world));
    run(sim, 1500);
    run(copy, 1500);
    expect(hashWorld(copy.world)).toBe(hashWorld(sim.world));
  });
});

describe('coaster failure handling', () => {
  function openWithRiders() {
    const { sim, rideId } = testedCoaster();
    connectStation(sim, rideId);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    sim.step();
    queueGuests(sim, rideId, 12);
    return { sim, rideId, slot: sim.world.rides.idToSlot[rideId] };
  }

  function runUntilTrainIsOut(sim: Simulation): void {
    for (let i = 0; i < 2000 && sim.world.vehicles.cols.state[0] !== VehicleState.Running; i++) {
      sim.step();
    }
    expect(sim.world.vehicles.cols.state[0]).toBe(VehicleState.Running);
  }

  it('lets riders off and closes the ride when its track is edited mid-ride', () => {
    const { sim, rideId, slot } = openWithRiders();
    runUntilTrainIsOut(sim);
    run(sim, 5);
    const riding = () => {
      let n = 0;
      for (let g = 0; g < sim.world.guests.count; g++) {
        if (sim.world.guests.cols.state[g] === GuestState.Riding) n++;
      }
      return n;
    };
    expect(riding()).toBe(12);
    sim.enqueue({ type: 'removeTrack', rideId, pieceId: -1 });
    run(sim, 10);
    expect(riding()).toBe(0);
    expect(sim.world.vehicles.count).toBe(0);
    expect(sim.world.rides.cols.phase[slot]).toBe(RidePhase.Closed);
    expect(sim.world.rides.cols.state[slot]).toBe(RideState.Closed);
  });

  it('keeps a ride that is closed right after dispatch consistent and reopenable', () => {
    const { sim, rideId, slot } = openWithRiders();
    runUntilTrainIsOut(sim);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'close' });
    run(sim, 3000);
    expect(sim.world.rides.cols.state[slot]).toBe(RideState.Closed);
    expect(sim.world.rides.cols.phase[slot]).toBe(RidePhase.Closed);
    expect(sim.world.rides.cols.guestsServed[slot]).toBe(12);
    expect(sim.world.vehicles.count).toBe(0);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    sim.step();
    expect(sim.world.feedback.code).toBe(RideResult.Ok);
  });

  it('takes a ride out of service when its train never returns, and keeps its test until a mechanic repairs it', () => {
    const { sim, rideId, slot } = openWithRiders();
    runUntilTrainIsOut(sim);
    sim.world.vehicles.cols.state[0] = VehicleState.Crashed;
    run(sim, 3);
    expect(sim.world.rides.cols.state[slot]).toBe(RideState.Broken);
    expect(sim.world.vehicles.count).toBe(0);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    sim.step();
    expect(sim.world.feedback.code).toBe(RideResult.Broken);

    sim.enqueue({ type: 'setRideStatus', rideId, status: 'close' });
    sim.step();
    expect(sim.world.rides.cols.state[slot]).toBe(RideState.Broken);
    expect(isRideTested(sim.world, rideId)).toBe(true);
  });

  it('refuses a second station on a coaster', () => {
    const sim = flatOwnedSim();
    const rideId = createCoaster(sim);
    buildCircuit(sim, rideId, [
      ['station', PieceMode.Normal],
      ['flat', PieceMode.Normal],
    ]);
    buildCircuit(sim, rideId, [['station', PieceMode.Normal]]);
    expect(sim.world.feedback.code).toBe(TrackResult.PieceNotAllowed);
    expect(sim.world.track.count[rideId]).toBe(2);
  });
});

describe('park guests on a coaster', () => {
  it('walk in from the park gate, queue on the entrance path, board and finish rides', () => {
    const { sim, rideId } = testedCoaster();
    for (let y = 10; y <= 17; y++) sim.enqueue({ type: 'placePath', x: STATION_X, y });
    sim.enqueue({ type: 'setParkEntrance', x: STATION_X, y: 10 });
    connectStation(sim, rideId);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    run(sim, 24000);
    const slot = sim.world.rides.idToSlot[rideId];
    expect(sim.world.rides.cols.state[slot]).toBe(RideState.Open);
    expect(sim.world.rides.cols.guestsServed[slot]).toBeGreaterThan(0);
    expect(sim.world.rides.cols.cyclesCompleted[slot]).toBeGreaterThan(0);
  });
});

describe('track commands', () => {
  const placeStation = (sim: Simulation, rideId: number, x = STATION_X, y = STATION_Y) =>
    sim.enqueue({
      type: 'placeTrack',
      rideId,
      pieceType: PieceId.Station,
      x,
      y,
      z: GROUND,
      dir: 0,
      mode: PieceMode.Normal,
    });

  it('refuses track on land the player does not own and reports why', () => {
    const sim = flatOwnedSim();
    const rideId = createCoaster(sim);
    sim.world.map.ownership[sim.world.map.index(STATION_X, STATION_Y)] = 0;
    const cash = sim.world.economy.cash;
    placeStation(sim, rideId);
    sim.step();
    expect(sim.world.track.pieces.count).toBe(0);
    expect(sim.world.economy.cash).toBe(cash);
    expect(sim.world.feedback.domain).toBe(FeedbackDomain.Track);
    expect(sim.world.feedback.code).toBe(TrackResult.NotOwned);
  });

  it('accepts track on land with only construction rights', () => {
    const sim = flatOwnedSim();
    const rideId = createCoaster(sim);
    sim.world.map.ownership[sim.world.map.index(STATION_X, STATION_Y)] = 2;
    placeStation(sim, rideId);
    sim.step();
    expect(sim.world.track.pieces.count).toBe(1);
    expect(sim.world.feedback.code).toBe(TrackResult.Ok);
  });

  it('reports insufficient funds and leaves the layout untouched', () => {
    const sim = flatOwnedSim();
    const rideId = createCoaster(sim);
    sim.world.economy.cash = 10;
    placeStation(sim, rideId);
    sim.step();
    expect(sim.world.track.pieces.count).toBe(0);
    expect(sim.world.feedback.code).toBe(TrackResult.InsufficientFunds);
  });

  it('keeps inversions and steep slopes off the wooden coaster but allows them on steel', () => {
    const attempt = (rideType: RideType) => {
      const sim = flatOwnedSim();
      const rideId = createCoaster(sim, rideType);
      sim.enqueue({
        type: 'placeTrack',
        rideId,
        pieceType: pieceByName('verticalLoopRight')!.id,
        x: STATION_X,
        y: STATION_Y,
        z: GROUND,
        dir: 0,
        mode: PieceMode.Normal,
      });
      sim.step();
      return sim.world.feedback.code;
    };
    expect(attempt(RideType.WoodenCoaster)).toBe(TrackResult.PieceNotAllowed);
    expect(attempt(RideType.SteelLoopingCoaster)).toBe(TrackResult.Ok);
  });

  it('accepts a launch piece on the steel coaster only', () => {
    const attempt = (rideType: RideType) => {
      const sim = flatOwnedSim();
      const rideId = createCoaster(sim, rideType);
      sim.enqueue({
        type: 'placeTrack',
        rideId,
        pieceType: PieceId.Flat,
        x: STATION_X,
        y: STATION_Y,
        z: GROUND,
        dir: 0,
        mode: PieceMode.Launch,
      });
      sim.step();
      return sim.world.feedback.code;
    };
    expect(attempt(RideType.SteelLoopingCoaster)).toBe(TrackResult.Ok);
    expect(attempt(RideType.WoodenCoaster)).toBe(TrackResult.PieceNotAllowed);
  });
});

import { describe, expect, it } from 'vitest';
import { hashWorld } from '../core/hash';
import { Simulation } from '../core/simulation';
import { GuestState } from '../guests/guest-store';
import { deserialize, serialize } from '../../save/save';
import { PieceMode } from '../track/track-types';
import { CAR_MASS } from '../vehicles/ride-trains';
import { CAR_LENGTH_Q8 } from '../vehicles/vehicle-system';
import { VehicleState } from '../vehicles/vehicle-store';
import {
  SMALL_CIRCUIT,
  buildCircuit,
  connectStation,
  createCoaster,
  flatOwnedSim,
  queueGuests,
  run,
} from './coaster-fixtures';
import { RideType } from './ride-types';

/** SMALL_CIRCUIT with block brakes on two of its flat pieces: three block zones, two trains. */
const TWO_BLOCK_LAYOUT = SMALL_CIRCUIT.map(
  ([name, mode], i) => [name, i === 5 || i === 10 ? PieceMode.BlockBrake : mode] as const,
);

function openedCoaster(
  layout: ReadonlyArray<readonly [string, PieceMode]> = TWO_BLOCK_LAYOUT,
  seed = 1,
) {
  const sim = flatOwnedSim(seed);
  const rideId = createCoaster(sim, RideType.WoodenCoaster);
  buildCircuit(sim, rideId, layout);
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
  run(sim, 8000);
  connectStation(sim, rideId);
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
  sim.step();
  return { sim, rideId, slot: sim.world.rides.idToSlot[rideId] };
}

function ridingGuests(sim: Simulation): number {
  let n = 0;
  for (let g = 0; g < sim.world.guests.count; g++) {
    if (sim.world.guests.cols.state[g] === GuestState.Riding) n++;
  }
  return n;
}

function onTrain(sim: Simulation): number {
  const v = sim.world.vehicles.cols;
  let n = 0;
  for (let t = 0; t < sim.world.vehicles.count; t++) n += v.passengers[t];
  return n;
}

describe('multi-train coaster', () => {
  it('runs one train per block-section boundary beyond the first, up to the zone limit', () => {
    const two = openedCoaster();
    queueGuests(two.sim, two.rideId, 40);
    run(two.sim, 1500);
    expect(two.sim.world.vehicles.count).toBe(2);

    const single = openedCoaster(SMALL_CIRCUIT);
    queueGuests(single.sim, single.rideId, 40);
    run(single.sim, 1500);
    expect(single.sim.world.vehicles.count).toBe(1);
  });

  it('never lets two trains overlap and keeps every rider aboard until their own train unloads', () => {
    const { sim, rideId, slot } = openedCoaster();
    const v = sim.world.vehicles.cols;
    const track = () => sim.world.vehicleTracks!.get(rideId)!;
    let maxOut = 0;
    for (let i = 0; i < 14000; i++) {
      if (i % 120 === 0) queueGuests(sim, rideId, 6);
      sim.step();
      const total = track().totalLengthQ8;
      const out = [];
      for (let t = 0; t < sim.world.vehicles.count; t++) {
        const front = v.trackPos[t];
        const length = v.carCount[t] * CAR_LENGTH_Q8;
        out.push({ front, rear: front - length });
        if (v.state[t] === VehicleState.Running || v.state[t] === VehicleState.Arriving) maxOut++;
      }
      for (let a = 0; a < out.length; a++) {
        for (let b = a + 1; b < out.length; b++) {
          const la = out[a].front - out[a].rear;
          const lb = out[b].front - out[b].rear;
          const aAhead = (((out[b].rear - out[a].rear) % total) + total) % total;
          const bAhead = (((out[a].rear - out[b].rear) % total) + total) % total;
          expect(aAhead < la || bAhead < lb, `trains overlap at tick ${i}`).toBe(false);
        }
      }
      // Guests re-check on a stride, so they may linger briefly, but never leave early.
      expect(ridingGuests(sim)).toBeGreaterThanOrEqual(onTrain(sim));
    }
    expect(maxOut).toBeGreaterThan(0);
    expect(sim.world.rides.cols.guestsServed[slot]).toBeGreaterThanOrEqual(36);
    expect(sim.world.rides.cols.cyclesCompleted[slot]).toBeGreaterThanOrEqual(3);
  });

  it('keeps all trains out of the station zone until the platform train has left', () => {
    const { sim, rideId } = openedCoaster();
    const v = sim.world.vehicles.cols;
    let overlapped = false;
    for (let i = 0; i < 12000; i++) {
      if (i % 120 === 0) queueGuests(sim, rideId, 6);
      sim.step();
      let inStation = 0;
      const track = sim.world.vehicleTracks!.get(rideId)!;
      for (let t = 0; t < sim.world.vehicles.count; t++) {
        const state = v.state[t];
        if (state === VehicleState.Unloading || state === VehicleState.Arriving) inStation++;
        else if (state === VehicleState.Waiting && v.trackPos[t] === track.stationEndQ8) {
          inStation++;
        }
      }
      if (inStation > 1) overlapped = true;
    }
    expect(overlapped).toBe(false);
  });

  it('is deterministic and continues identically after a save and load mid-run', () => {
    const a = openedCoaster();
    const b = openedCoaster();
    for (const { sim, rideId } of [a, b]) queueGuests(sim, rideId, 30);
    run(a.sim, 2500);
    run(b.sim, 2500);
    expect(hashWorld(a.sim.world)).toBe(hashWorld(b.sim.world));

    const restored = new Simulation({ seed: 1, width: 48, height: 48, maxGuests: 64 });
    Object.assign(restored, { world: deserialize(serialize(b.sim.world)) });
    run(a.sim, 2500);
    run(restored, 2500);
    expect(hashWorld(restored.world)).toBe(hashWorld(a.sim.world));
  });

  it('brakes smoothly into the station and unloads for unloadTicks before releasing riders', () => {
    const { sim, rideId, slot } = openedCoaster(SMALL_CIRCUIT);
    queueGuests(sim, rideId, 12);
    const v = sim.world.vehicles.cols;
    const unloadTicks = sim.world.rides.cols.unloadTicks[slot];
    const track = () => sim.world.vehicleTracks!.get(rideId)!;
    let arrivingTicks = 0;
    let entrySpeed = -1;
    let previousSpeed = Infinity;
    let unloading = 0;
    let ridingWhileUnloading = true;
    let servedBefore = -1;
    for (let i = 0; i < 4000 && servedBefore < 0; i++) {
      sim.step();
      if (v.state[0] === VehicleState.Arriving) {
        arrivingTicks++;
        if (entrySpeed < 0) entrySpeed = v.speed[0];
        expect(v.speed[0], 'speed never rises while braking').toBeLessThanOrEqual(
          Math.max(previousSpeed, 128),
        );
        previousSpeed = v.speed[0];
        expect(v.trackPos[0]).toBeLessThanOrEqual(track().stationEndQ8);
      }
      if (v.state[0] === VehicleState.Unloading) {
        unloading++;
        expect(v.trackPos[0]).toBe(track().stationEndQ8);
        expect(v.speed[0]).toBe(0);
        ridingWhileUnloading &&= sim.world.rides.cols.guestsServed[slot] === 0;
      }
      if (unloading > 0 && v.state[0] === VehicleState.Waiting) servedBefore = i;
    }
    expect(entrySpeed).toBeGreaterThan(0);
    expect(arrivingTicks).toBeGreaterThan(3);
    expect(unloading).toBeGreaterThanOrEqual(unloadTicks - 1);
    expect(unloading).toBeLessThanOrEqual(unloadTicks);
    expect(ridingWhileUnloading).toBe(true);
    expect(sim.world.rides.cols.guestsServed[slot]).toBe(12);
  });

  it('builds trains from cars sized to capacity and no longer fakes weight', () => {
    const { sim, rideId } = openedCoaster(SMALL_CIRCUIT);
    queueGuests(sim, rideId, 12);
    run(sim, 300);
    const v = sim.world.vehicles.cols;
    expect(v.carCount[0]).toBe(3);
    expect(v.mass[0]).toBe(3 * CAR_MASS);
  });
});

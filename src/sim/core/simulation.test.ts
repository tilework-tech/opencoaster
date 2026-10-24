import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { hashWorld } from './hash';
import { RIDE_CATALOG, RideType } from '../rides/ride-types';
import { SALE_LAND } from '../map/tile-map';
import { PIECES, PieceId } from '../track/catalog';

function run(seed: number, ticks: number): number {
  const sim = new Simulation({ seed, width: 64, height: 64, maxGuests: 2000 });
  sim.enqueue({ type: 'spawnGuests', count: 500 });
  sim.enqueue({ type: 'spawnStaff', count: 10, kind: 1 });
  for (let i = 0; i < ticks; i++) sim.step();
  return hashWorld(sim.world);
}

describe('Simulation', () => {
  it('produces identical state for identical seed and commands', () => {
    expect(run(7, 200)).toBe(run(7, 200));
  });

  it('diverges for different seeds', () => {
    expect(run(7, 50)).not.toBe(run(8, 50));
  });

  it('advances the tick counter once per step', () => {
    const sim = new Simulation({ seed: 1, width: 16, height: 16 });
    sim.step();
    sim.step();
    expect(sim.world.tick).toBe(2);
  });

  it('applies commands at the next tick boundary', () => {
    const sim = new Simulation({ seed: 1, width: 16, height: 16, maxGuests: 100 });
    sim.enqueue({ type: 'spawnGuests', count: 5 });
    expect(sim.world.guests.count).toBe(0);
    sim.step();
    expect(sim.world.guests.count).toBe(5);
  });

  it('creates a ride from a command at the requested tile', () => {
    const sim = new Simulation({ seed: 1, width: 16, height: 16 });
    const cash = sim.world.economy.cash;
    sim.enqueue({ type: 'createRide', rideType: RideType.MerryGoRound, x: 5, y: 6 });

    expect(sim.world.rides.count).toBe(0);
    sim.step();

    expect(sim.world.rides.count).toBe(1);
    expect(sim.world.rides.cols.typeId[0]).toBe(RideType.MerryGoRound);
    expect(sim.world.rides.cols.rideX[0]).toBe(5);
    expect(sim.world.rides.cols.rideY[0]).toBe(6);
    expect(sim.world.economy.cash).toBe(cash - RIDE_CATALOG[RideType.MerryGoRound].cost);
  });

  it('sets an operating ride ticket price through a simulation command', () => {
    const sim = new Simulation({ seed: 1, width: 16, height: 16 });
    const id = sim.world.rides.slotToId[sim.world.rides.spawn()];
    sim.enqueue({ type: 'setRidePrice', rideId: id, priceCents: 275 });

    sim.step();

    expect(sim.world.rides.cols.price[sim.world.rides.idToSlot[id]]).toBe(275);
  });

  it('opens a stall after placing its service entrance without requiring an exit', () => {
    const sim = new Simulation({ seed: 1, width: 16, height: 16 });
    const slot = sim.world.rides.spawn();
    const id = sim.world.rides.slotToId[slot];
    sim.world.rides.cols.typeId[slot] = RideType.FoodStall;
    sim.world.rides.cols.rideX[slot] = 5;
    sim.world.rides.cols.rideY[slot] = 6;
    sim.enqueue({ type: 'placeRideEntrance', rideId: id, x: 5, y: 7 });
    sim.step();
    sim.enqueue({ type: 'setRideStatus', rideId: id, status: 'open' });

    sim.step();

    expect(sim.world.rides.cols.state[sim.world.rides.idToSlot[id]]).toBe(1);
  });

  it('does not create or charge for a ride on land the park cannot build on', () => {
    const sim = new Simulation({ seed: 1, width: 16, height: 16 });
    const tile = sim.world.map.index(2, 2);
    sim.world.map.ownership[tile] = SALE_LAND;
    const cash = sim.world.economy.cash;
    sim.enqueue({ type: 'createRide', rideType: RideType.MerryGoRound, x: 2, y: 2 });

    sim.step();

    expect(sim.world.rides.count).toBe(0);
    expect(sim.world.economy.cash).toBe(cash);
  });

  it('does not create or charge for a ride that the park cannot afford', () => {
    const sim = new Simulation({ seed: 1, width: 16, height: 16 });
    sim.world.economy.cash = 0;
    sim.enqueue({ type: 'createRide', rideType: RideType.MerryGoRound, x: 5, y: 6 });

    sim.step();

    expect(sim.world.rides.count).toBe(0);
    expect(sim.world.economy.cash).toBe(0);
  });

  it('charges the catalog cost when a track piece is placed', () => {
    const sim = new Simulation({ seed: 1, width: 16, height: 16 });
    const rideId = sim.world.rides.slotToId[sim.world.rides.spawn()];
    const piece = PIECES[PieceId.Station];
    const z = sim.world.map.heights[sim.world.map.index(5, 6)];
    const cash = sim.world.economy.cash;
    sim.enqueue({
      type: 'placeTrack',
      rideId,
      pieceType: piece.id,
      x: 5,
      y: 6,
      z,
      dir: 0,
      mode: 0,
    });

    sim.step();

    expect(sim.world.track.pieces.count).toBe(1);
    expect(sim.world.economy.cash).toBe(cash - piece.cost);
  });

  it('does not place a track piece the park cannot afford', () => {
    const sim = new Simulation({ seed: 1, width: 16, height: 16 });
    const rideId = sim.world.rides.slotToId[sim.world.rides.spawn()];
    sim.world.economy.cash = 1000;
    sim.enqueue({
      type: 'placeTrack',
      rideId,
      pieceType: PieceId.Station,
      x: 5,
      y: 6,
      z: sim.world.map.heights[sim.world.map.index(5, 6)],
      dir: 0,
      mode: 0,
    });

    sim.step();

    expect(sim.world.track.pieces.count).toBe(0);
    expect(sim.world.economy.cash).toBe(1000);
  });

  it('does not charge when a track placement is rejected', () => {
    const sim = new Simulation({ seed: 1, width: 16, height: 16 });
    const rideId = sim.world.rides.slotToId[sim.world.rides.spawn()];
    const cash = sim.world.economy.cash;
    sim.enqueue({
      type: 'placeTrack',
      rideId,
      pieceType: PieceId.Station,
      x: -1,
      y: 6,
      z: 2,
      dir: 0,
      mode: 0,
    });

    sim.step();

    expect(sim.world.track.pieces.count).toBe(0);
    expect(sim.world.economy.cash).toBe(cash);
  });

  it('keeps guests inside the map', () => {
    const sim = new Simulation({ seed: 3, width: 16, height: 16, maxGuests: 100 });
    sim.enqueue({ type: 'spawnGuests', count: 50 });
    for (let i = 0; i < 300; i++) sim.step();
    const { x, y } = sim.world.guests.cols;
    for (let i = 0; i < sim.world.guests.count; i++) {
      expect(x[i]).toBeGreaterThanOrEqual(0);
      expect(x[i]).toBeLessThan(16 * 256);
      expect(y[i]).toBeGreaterThanOrEqual(0);
      expect(y[i]).toBeLessThan(16 * 256);
    }
  });
});

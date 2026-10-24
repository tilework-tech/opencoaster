import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/core/simulation';
import { World } from '../sim/core/world';
import { OWNED, RIGHTS_OWNED, SALE_RIGHTS } from '../sim/map/tile-map';
import { createSnapshot, snapshotBuffers, writeSnapshot } from './snapshot';

describe('render snapshot', () => {
  it('publishes finance values to the render snapshot', () => {
    const world = new World({ seed: 9, width: 8, height: 8 });
    world.economy.cash = 345678;
    world.economy.loan = 23000;
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);

    expect(snapshot.park.cash).toBe(345678);
    expect(snapshot.park.loan).toBe(23000);
    expect(snapshot.park.rides).toBe(world.rides.count);
  });

  it('publishes whether each tile allows construction', () => {
    const world = new World({ seed: 9, width: 8, height: 8 });
    const owned = world.map.index(2, 2);
    const rights = world.map.index(3, 2);
    const forSale = world.map.index(4, 2);
    world.map.ownership[owned] = OWNED;
    world.map.ownership[rights] = RIGHTS_OWNED | SALE_RIGHTS;
    world.map.ownership[forSale] = SALE_RIGHTS;
    const snapshot = createSnapshot({
      guests: 0,
      staff: 0,
      vehicles: 0,
      litter: 0,
      mapTiles: world.map.ownership.length,
    });

    writeSnapshot(world, snapshot);

    expect(snapshot.buildable[owned]).toBe(1);
    expect(snapshot.buildable[rights]).toBe(1);
    expect(snapshot.buildable[forSale]).toBe(0);
    expect(snapshotBuffers(snapshot)).toContain(snapshot.buildable.buffer);
  });

  it('publishes track piece position, type, and ride identity to renderers', () => {
    const world = new World({ seed: 11, width: 8, height: 8 });
    const firstRide = world.rides.spawn();
    const secondRide = world.rides.spawn();
    const slot = world.track.pieces.spawn();
    world.track.pieces.cols.x[slot] = 3;
    world.track.pieces.cols.y[slot] = 5;
    world.track.pieces.cols.z[slot] = 2;
    world.track.pieces.cols.pieceType[slot] = 42;
    world.track.pieces.cols.dir[slot] = 1;
    world.track.pieces.cols.rideId[slot] = world.rides.slotToId[secondRide];
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);

    expect(snapshot.tracks.count).toBe(1);
    expect(snapshot.rides.data[firstRide * 4 + 3]).toBe(world.rides.slotToId[firstRide]);
    expect(snapshot.rides.data[secondRide * 4 + 3]).toBe(world.rides.slotToId[secondRide]);
    expect(Array.from(snapshot.tracks.data.slice(0, 4))).toEqual([
      896,
      1408,
      128,
      (world.rides.slotToId[secondRide] << 16) | 298,
    ]);
  });

  it('produces identical render snapshots for the same seed and command sequence', () => {
    const capture = () => {
      const sim = new Simulation({ seed: 21, width: 8, height: 8, maxGuests: 32 });
      sim.enqueue({ type: 'spawnGuests', count: 12 });
      for (let i = 0; i < 20; i++) sim.step();
      const snapshot = createSnapshot({ guests: 32, staff: 0, vehicles: 0, litter: 0 });
      writeSnapshot(sim.world, snapshot);
      return {
        tick: snapshot.tick,
        guests: snapshot.guests.data.slice(0, snapshot.guests.count * 4),
        staff: snapshot.staff.data.slice(0, snapshot.staff.count * 4),
        vehicles: snapshot.vehicles.data.slice(0, snapshot.vehicles.count * 4),
        litter: snapshot.litter.data.slice(0, snapshot.litter.count * 4),
        rides: snapshot.rides.data.slice(0, snapshot.rides.count * 4),
        tracks: snapshot.tracks.data.slice(0, snapshot.tracks.count * 4),
        park: snapshot.park,
      };
    };

    expect(capture()).toEqual(capture());
  });
});

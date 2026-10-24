import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/core/simulation';
import { World } from '../sim/core/world';
import { createSnapshot, writeSnapshot } from './snapshot';

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

  it('publishes track piece position and type to renderers', () => {
    const world = new World({ seed: 11, width: 8, height: 8 });
    const slot = world.track.pieces.spawn();
    world.track.pieces.cols.x[slot] = 3;
    world.track.pieces.cols.y[slot] = 5;
    world.track.pieces.cols.z[slot] = 2;
    world.track.pieces.cols.pieceType[slot] = 42;
    world.track.pieces.cols.dir[slot] = 1;
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);

    expect(snapshot.tracks.count).toBe(1);
    expect(Array.from(snapshot.tracks.data.slice(0, 4))).toEqual([896, 1408, 128, 298]);
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

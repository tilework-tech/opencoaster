import { describe, expect, it } from 'vitest';
import { TILE_UNITS } from '../core/constants';
import { World } from '../core/world';
import { placePath } from '../map/paths';
import { Surface } from '../map/tile-map';
import { prepareFlat, openRide } from '../integration/fixtures';
import { guestSystem } from './guest-system';
import { GuestState, spawnGuest } from './guest-store';
import { setParkEntrance } from './park';
import { rideQueueSystem } from '../rides/queue-system';
import { rideSystem } from '../rides/ride-system';
import { rideQueueCapacity } from '../rides/ride-operations';
import { RideType } from '../rides/ride-types';
import { isReachable } from '../pathfinding';

function crowdedPark() {
  const world = new World({ seed: 417, width: 32, height: 32, maxGuests: 1000 });
  prepareFlat(world);
  for (let y = 2; y <= 16; y++) {
    for (let x = 2; x <= 6; x++) placePath(world.map, { x, y });
  }
  placePath(world.map, { x: 21, y: 15 });
  placePath(world.map, { x: 7, y: 16, queue: true });
  for (let x = 7; x <= 20; x++) placePath(world.map, { x, y: 16, queue: true });
  const ride = openRide(
    world,
    RideType.MerryGoRound,
    [20, 15],
    [20, 16],
    [21, 15],
    Array.from({ length: 13 }, (_, i) => [19 - i, 16] as [number, number]),
  );
  setParkEntrance(world, 2, 2);
  const g = world.guests.cols;
  for (let i = 0; i < 1000; i++) {
    if (!spawnGuest(world)) throw new Error('spawnGuest');
    const x = 2 + (i % 5);
    const y = 2 + (Math.floor(i / 5) % 15);
    g.x[i] = x * TILE_UNITS + TILE_UNITS / 2;
    g.y[i] = y * TILE_UNITS + TILE_UNITS / 2;
    g.z[i] = world.map.heightAt(g.x[i]!, g.y[i]!);
    g.happiness[i] = 200;
    g.energy[i] = 240;
    g.hunger[i] = 255;
    g.thirst[i] = 255;
    g.toilet[i] = 0;
    g.nausea[i] = 0;
    g.cash[i] = 9000;
  }
  guestSystem.update(world);
  world.tick++;
  return { world, ride, joinTile: world.queues.joinTile[ride] };
}

function tick(world: World, count: number, sample: (tick: number) => void): void {
  for (let i = 0; i < count; i++) {
    rideSystem.update(world);
    rideQueueSystem.update(world);
    guestSystem.update(world);
    world.tick++;
    sample(world.tick);
  }
}

function nearbyPathGuests(world: World, joinTile: number): number {
  const gx = joinTile % world.map.width;
  const gy = Math.floor(joinTile / world.map.width);
  let count = 0;
  for (let slot = 0; slot < world.guests.count; slot++) {
    if (world.guests.cols.state[slot] !== GuestState.Wandering) continue;
    const x = world.guests.cols.x[slot]! >> 8;
    const y = world.guests.cols.y[slot]! >> 8;
    if (Math.max(Math.abs(x - gx), Math.abs(y - gy)) > 1) continue;
    if (world.map.surface[world.map.index(x, y)] === Surface.Path) count++;
  }
  return count;
}

describe('guest ride demand under crowd pressure', () => {
  it('fills a popular gentle ride queue without leaving a crowd parked beside its entrance', () => {
    const { world, ride, joinTile } = crowdedPark();
    const capacity = rideQueueCapacity(world, ride);
    console.info(JSON.stringify({
      ride,
      rideState: world.rides.cols.state[ride],
      rideRatings: [world.rides.cols.excitement[ride], world.rides.cols.intensity[ride], world.rides.cols.nausea[ride]],
      joinTile,
      joinSurface: world.map.surface[joinTile],
      fromEntrance: isReachable(world, world.map.index(2, 2), joinTile),
      queueTiles: world.queues.tiles[ride],
      targetable: Array.from(world.guests.cols.targetRide).filter((id) => id >= 0).length,
      firstNeeds: [world.guests.cols.hunger[0], world.guests.cols.thirst[0], world.guests.cols.toilet[0], world.guests.cols.activityTicks[0]],
    }));
    const previous = new Map<number, { position: number; stillSamples: number }>();
    const samples: Array<{ tick: number; queued: number; approaching: number; nearby: number }> = [];
    let maxStationary = 0;
    tick(world, 8000, (at) => {
      if (at % 100 !== 0) return;
      let stationary = 0;
      for (let slot = 0; slot < world.guests.count; slot++) {
        if (world.guests.cols.state[slot] !== GuestState.Wandering) continue;
        const x = world.guests.cols.x[slot]!;
        const y = world.guests.cols.y[slot]!;
        const tileX = x >> 8;
        const tileY = y >> 8;
        if (Math.max(Math.abs(tileX - (joinTile % world.map.width)), Math.abs(tileY - Math.floor(joinTile / world.map.width))) > 1) continue;
        if (world.map.surface[world.map.index(tileX, tileY)] !== Surface.Path) continue;
        const id = world.guests.slotToId[slot]!;
        const position = (x << 16) ^ y;
        const last = previous.get(id);
        const stillSamples = last?.position === position ? last.stillSamples + 1 : 0;
        previous.set(id, { position, stillSamples });
        if (stillSamples >= 3) stationary++;
      }
      maxStationary = Math.max(maxStationary, stationary);
      if (at % 500 !== 0) return;
      samples.push({
        tick: at,
        queued: world.rideLines.queued[ride]!,
        approaching: world.rideLines.approaching[ride]!,
        nearby: nearbyPathGuests(world, joinTile),
      });
    });
    console.info(JSON.stringify({ capacity, samples, maxStationary }));
    expect(samples.at(-1)!.queued).toBeGreaterThanOrEqual(40);
    expect(maxStationary).toBeLessThanOrEqual(12);
  });
});

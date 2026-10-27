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
import { ticketPriceCents } from '../rides/queue-system';
import { refreshQueueIndex } from '../rides/queue-lines';
import { RideType } from '../rides/ride-types';
import { isReachable } from '../pathfinding';
import { exceedsNauseaLimit, intensityCeilingOf } from './preferences';

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
  refreshQueueIndex(world);
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
    const x = world.guests.cols.x[slot]! >> 8;
    const y = world.guests.cols.y[slot]! >> 8;
    if (Math.max(Math.abs(x - gx), Math.abs(y - gy)) > 1) continue;
    const tile = world.map.index(x, y);
    if (world.map.surface[tile] === Surface.Path && !world.map.isQueue(tile)) count++;
  }
  return count;
}

describe('guest ride demand under crowd pressure', () => {
  it('fills a popular gentle ride queue without leaving a crowd parked beside its entrance', () => {
    const { world, ride, joinTile } = crowdedPark();
    const capacity = rideQueueCapacity(world, ride);
    expect(world.rides.cols.state[ride]).toBe(1);
    expect(joinTile).toBeGreaterThanOrEqual(0);
    expect(isReachable(world, world.map.index(2, 2), joinTile)).toBe(true);
    expect(ticketPriceCents(world, ride)).toBe(0);
    expect(capacity).toBe(56);
    const rideId = world.rides.slotToId[ride]!;
    const start = world.guests.cols;
    const initialGuestCount = world.guests.count;
    let initiallyAffordable = 0;
    let initiallyIntensityEligible = 0;
    let initiallyNauseaEligible = 0;
    let initiallyQueueEligible = 0;
    let initialLastRideMemory = 0;
    let initialRecentRideMemory = 0;
    let minIntensityCeiling = Infinity;
    for (let slot = 0; slot < world.guests.count; slot++) {
      const preference = start.preferredIntensity[slot]!;
      if (start.cash[slot]! >= ticketPriceCents(world, ride)) initiallyAffordable++;
      const ceiling = intensityCeilingOf(preference, start.happiness[slot]!);
      minIntensityCeiling = Math.min(minIntensityCeiling, ceiling);
      if (world.rides.cols.intensity[ride]! <= ceiling) initiallyIntensityEligible++;
      if (
        !exceedsNauseaLimit(
          world.rides.cols.nausea[ride]!,
          start.nausea[slot]!,
          start.nauseaTolerance[slot]!,
        )
      )
        initiallyNauseaEligible++;
      if (world.rideLines.queued[ride]! + world.rideLines.approaching[ride]! < capacity)
        initiallyQueueEligible++;
      if (start.lastRide[slot] === rideId) initialLastRideMemory++;
      const validHistory = Math.min(4, start.ridesTaken[slot]!);
      if (
        [
          start.rideHistory0[slot],
          start.rideHistory1[slot],
          start.rideHistory2[slot],
          start.rideHistory3[slot],
        ]
          .slice(0, validHistory)
          .includes(rideId)
      )
        initialRecentRideMemory++;
    }
    const previous = new Map<number, { position: number; stillSamples: number }>();
    const samples: Array<{
      tick: number;
      queued: number;
      approaching: number;
      nearbyPath: number;
      lineCommitted: number;
      targetRide: number;
      riding: number;
    }> = [];
    let maxStationary = 0;
    tick(world, 8000, (at) => {
      if (at % 100 !== 0) return;
      let stationary = 0;
      const seen = new Set<number>();
      for (let slot = 0; slot < world.guests.count; slot++) {
        const x = world.guests.cols.x[slot]!;
        const y = world.guests.cols.y[slot]!;
        const tileX = x >> 8;
        const tileY = y >> 8;
        if (
          Math.max(
            Math.abs(tileX - (joinTile % world.map.width)),
            Math.abs(tileY - Math.floor(joinTile / world.map.width)),
          ) > 1
        )
          continue;
        const tile = world.map.index(tileX, tileY);
        if (world.map.surface[tile] !== Surface.Path || world.map.isQueue(tile)) continue;
        const id = world.guests.slotToId[slot]!;
        seen.add(id);
        const position = (x << 16) ^ y;
        const last = previous.get(id);
        const stillSamples = last?.position === position ? last.stillSamples + 1 : 0;
        previous.set(id, { position, stillSamples });
        if (stillSamples >= 3) stationary++;
      }
      for (const id of previous.keys()) if (!seen.has(id)) previous.delete(id);
      maxStationary = Math.max(maxStationary, stationary);
      if (at % 500 !== 0) return;
      let targetRide = 0;
      let riding = 0;
      for (let slot = 0; slot < world.guests.count; slot++) {
        if (world.guests.cols.targetRide[slot] === rideId) targetRide++;
        if (world.guests.cols.state[slot] === GuestState.Riding) riding++;
      }
      samples.push({
        tick: at,
        queued: world.rideLines.queued[ride]!,
        approaching: world.rideLines.approaching[ride]!,
        nearbyPath: nearbyPathGuests(world, joinTile),
        lineCommitted: world.rideLines.queued[ride]! + world.rideLines.approaching[ride]!,
        targetRide,
        riding,
      });
    });
    const guests = world.guests.cols;
    let headingForRide = 0;
    let canPay = 0;
    let alreadyRode = 0;
    let recentRideMemory = 0;
    let preferenceLow = 0;
    let preferenceMid = 0;
    let preferenceHigh = 0;
    let intensityEligible = 0;
    let nauseaToleranceLow = 0;
    let nauseaToleranceMid = 0;
    let nauseaToleranceHigh = 0;
    let minHappiness = 255;
    let minEnergy = 255;
    let maxNausea = 0;
    for (let slot = 0; slot < world.guests.count; slot++) {
      if (guests.targetRide[slot] === world.rides.slotToId[ride]) headingForRide++;
      if (guests.cash[slot]! >= ticketPriceCents(world, ride)) canPay++;
      if (guests.lastRide[slot] === world.rides.slotToId[ride]) alreadyRode++;
      const validHistory = Math.min(
        4,
        guests.ridesTaken[slot]! + (guests.state[slot] === GuestState.Riding ? 1 : 0),
      );
      if (
        [
          guests.rideHistory0[slot],
          guests.rideHistory1[slot],
          guests.rideHistory2[slot],
          guests.rideHistory3[slot],
        ]
          .slice(0, validHistory)
          .includes(rideId)
      )
        recentRideMemory++;
      const preference = guests.preferredIntensity[slot]!;
      if (preference < 85) preferenceLow++;
      else if (preference < 170) preferenceMid++;
      else preferenceHigh++;
      if (
        world.rides.cols.intensity[ride]! <= intensityCeilingOf(preference, guests.happiness[slot]!)
      )
        intensityEligible++;
      if (guests.nauseaTolerance[slot]! < 1) nauseaToleranceLow++;
      else if (guests.nauseaTolerance[slot]! < 3) nauseaToleranceMid++;
      else nauseaToleranceHigh++;
      minHappiness = Math.min(minHappiness, guests.happiness[slot]!);
      minEnergy = Math.min(minEnergy, guests.energy[slot]!);
      maxNausea = Math.max(maxNausea, guests.nausea[slot]!);
    }
    const openTile = world.queues.openTile[ride]!;
    expect(world.map.isQueue(openTile)).toBe(true);
    const diagnostics = {
      initialCandidateGates: {
        guests: initialGuestCount,
        affordable: initiallyAffordable,
        intensityEligible: initiallyIntensityEligible,
        nauseaEligible: initiallyNauseaEligible,
        queueHasRoom: initiallyQueueEligible,
        minIntensityCeiling,
        lastRideMemory: initialLastRideMemory,
        recentRideMemory: initialRecentRideMemory,
        entrancePathReachable: isReachable(world, world.map.index(2, 2), joinTile),
        queueOpenEndIsQueueTile: world.map.isQueue(openTile),
      },
      headingForRide,
      canPay,
      alreadyRode,
      recentRideMemory,
      preferenceBuckets: { low: preferenceLow, mid: preferenceMid, high: preferenceHigh },
      intensityEligible,
      nauseaToleranceBuckets: {
        low: nauseaToleranceLow,
        mid: nauseaToleranceMid,
        high: nauseaToleranceHigh,
      },
      minHappiness,
      minEnergy,
      maxNausea,
      entranceReachable: isReachable(world, world.map.index(2, 2), joinTile),
      queueOpenEndIsQueueTile: world.map.isQueue(openTile),
      maxStationaryOnAdjacentPaths: maxStationary,
      capacity,
      samples,
    };
    console.info('ride-demand diagnostics', JSON.stringify(diagnostics));
    expect(maxStationary, JSON.stringify(samples)).toBeLessThanOrEqual(12);
    expect(Math.max(...samples.map((sample) => sample.queued))).toBeGreaterThanOrEqual(20);
    expect(Math.max(...samples.map((sample) => sample.lineCommitted))).toBeGreaterThanOrEqual(40);
  });
});

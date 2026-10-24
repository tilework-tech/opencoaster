import type { System } from '../core/system';
import { TILE_UNITS, Z_STEP } from '../core/constants';
import type { Pathfinder } from '../pathfinding/pathfinder';
import { nullPathfinder } from '../pathfinding/pathfinder';
import { RideState } from '../rides/ride-store';
import { GuestState, GuestThought, recordThought, spawnGuest } from './guest-store';
import type { World } from '../core/world';

const UPDATE_STRIDE = 4;
const GUEST_SPEED = 12;
const QUEUE_PATIENCE = 600;
const RIDE_DURATION = 120;
const STAT_DECAY = 1;
const HUNGER_THOUGHT = 160;
const THIRST_THOUGHT = 160;
const LEAVE_HAPPINESS = 16;
const LEAVE_ENERGY = 12;
const ARRIVAL_INTERVAL = 400;
const BASE_GUEST_CAP = 200;

export interface GuestAdmission {
  parkRating: number;
  entranceFee: number;
}

export type GuestAdmissionProvider = (world: World) => GuestAdmission;

function admissionFromEconomy(world: World): GuestAdmission {
  const economy = world.economy as typeof world.economy & Partial<GuestAdmission>;
  return {
    parkRating: economy.parkRating ?? 500,
    entranceFee: economy.entranceFee ?? 0,
  };
}

function scoreRide(world: World, slot: number, ride: number): number {
  const r = world.rides.cols;
  const g = world.guests.cols;
  const price = r.price[ride];
  if (r.state[ride] !== RideState.Open || price > g.cash[slot]) return -1;
  const intensityGap = Math.abs(r.intensity[ride] - g.preferredIntensity[slot]);
  if (r.intensity[ride] > g.nauseaTolerance[slot] * 2) return -1;
  const excitement = r.excitement[ride];
  const nauseaCost = r.nausea[ride] + g.nausea[slot];
  const queueCost = r.queueLength[ride] * 20;
  return excitement * 4 - intensityGap * 2 - nauseaCost * 3 - price - queueCost;
}

function chooseRide(world: World, slot: number): number {
  let selected = -1;
  let bestScore = 0;
  for (let ride = 0; ride < world.rides.count; ride++) {
    const score = scoreRide(world, slot, ride);
    if (score > bestScore) {
      bestScore = score;
      selected = ride;
    }
  }
  return selected;
}

function moveTowardTarget(
  world: World,
  slot: number,
  pathfinder: Pathfinder,
  pathBuffer: Int32Array,
): void {
  const g = world.guests.cols;
  const map = world.map;
  const tx = g.targetX[slot];
  const ty = g.targetY[slot];
  const fromX = (g.x[slot] / TILE_UNITS) | 0;
  const fromY = (g.y[slot] / TILE_UNITS) | 0;
  const from = map.index(fromX, fromY);
  const to = map.index(tx, ty);
  const pathLength = pathfinder.findPath(map, from, to, pathBuffer);
  const destination = pathLength > 0 ? pathBuffer[0] : to;
  const goalX = (destination % map.width) * TILE_UNITS + (TILE_UNITS >> 1);
  const goalY = ((destination / map.width) | 0) * TILE_UNITS + (TILE_UNITS >> 1);
  const dx = goalX - g.x[slot];
  const dy = goalY - g.y[slot];
  g.x[slot] += dx > GUEST_SPEED ? GUEST_SPEED : dx < -GUEST_SPEED ? -GUEST_SPEED : dx;
  g.y[slot] += dy > GUEST_SPEED ? GUEST_SPEED : dy < -GUEST_SPEED ? -GUEST_SPEED : dy;
  const x = Math.max(0, Math.min(map.width - 1, (g.x[slot] / TILE_UNITS) | 0));
  const y = Math.max(0, Math.min(map.height - 1, (g.y[slot] / TILE_UNITS) | 0));
  g.z[slot] = map.heights[map.index(x, y)] * Z_STEP;
}

function updateGuest(
  world: World,
  slot: number,
  pathfinder: Pathfinder,
  pathBuffer: Int32Array,
): boolean {
  const g = world.guests.cols;
  const state = g.state[slot];
  g.hunger[slot] = Math.min(255, g.hunger[slot] + STAT_DECAY);
  g.thirst[slot] = Math.min(255, g.thirst[slot] + STAT_DECAY);
  g.toilet[slot] = Math.min(255, g.toilet[slot] + (g.thirst[slot] > 180 ? 2 : 1));
  if (state === GuestState.Wandering) g.energy[slot] = Math.max(0, g.energy[slot] - 1);
  g.nausea[slot] = Math.max(0, g.nausea[slot] - 1);
  g.happiness[slot] = Math.max(
    0,
    g.happiness[slot] - (g.hunger[slot] > 220 || g.thirst[slot] > 220 ? 1 : 0),
  );
  if (g.hunger[slot] >= HUNGER_THOUGHT) recordThought(world, slot, GuestThought.Hungry);
  else if (g.thirst[slot] >= THIRST_THOUGHT) recordThought(world, slot, GuestThought.Thirsty);

  if (state === GuestState.Riding) {
    g.activityTicks[slot]++;
    if (g.activityTicks[slot] >= RIDE_DURATION) {
      const targetId = g.targetRide[slot];
      const rideSlot = world.rides.idToSlot[targetId];
      if (rideSlot >= 0) {
        g.cash[slot] = Math.max(0, g.cash[slot] - world.rides.cols.price[rideSlot]);
        g.nausea[slot] = Math.min(255, g.nausea[slot] + (world.rides.cols.nausea[rideSlot] >> 4));
        g.happiness[slot] = Math.min(255, g.happiness[slot] + 8);
        g.energy[slot] = Math.min(255, g.energy[slot] + 32);
      }
      recordThought(world, slot, GuestThought.RideEnjoyed);
      g.targetRide[slot] = -1;
      g.activityTicks[slot] = 0;
      g.state[slot] = GuestState.Wandering;
    }
    return false;
  }

  if (state === GuestState.Queuing) {
    g.patience[slot] = Math.max(0, g.patience[slot] - UPDATE_STRIDE);
    g.activityTicks[slot]++;
    if (g.patience[slot] === 0) {
      const rideSlot = world.rides.idToSlot[g.targetRide[slot]];
      if (rideSlot >= 0 && world.rides.cols.queueLength[rideSlot] > 0)
        world.rides.cols.queueLength[rideSlot]--;
      recordThought(world, slot, GuestThought.QueueTooLong);
      g.state[slot] = GuestState.Wandering;
      g.targetRide[slot] = -1;
    } else if (g.activityTicks[slot] >= RIDE_DURATION) {
      const rideSlot = world.rides.idToSlot[g.targetRide[slot]];
      if (rideSlot >= 0 && world.rides.cols.queueLength[rideSlot] > 0)
        world.rides.cols.queueLength[rideSlot]--;
      g.state[slot] = GuestState.Riding;
      g.activityTicks[slot] = 0;
    }
    return false;
  }

  if (state === GuestState.Leaving) {
    moveTowardTarget(world, slot, pathfinder, pathBuffer);
    return (
      ((g.x[slot] / TILE_UNITS) | 0) === g.targetX[slot] &&
      ((g.y[slot] / TILE_UNITS) | 0) === g.targetY[slot]
    );
  }

  if (g.happiness[slot] <= LEAVE_HAPPINESS || g.energy[slot] <= LEAVE_ENERGY || g.cash[slot] <= 0) {
    g.state[slot] = GuestState.Leaving;
    g.targetX[slot] = g.x[slot] < (world.map.width * TILE_UNITS) / 2 ? 0 : world.map.width - 1;
    g.targetY[slot] = g.y[slot] < (world.map.height * TILE_UNITS) / 2 ? 0 : world.map.height - 1;
    recordThought(world, slot, GuestThought.Leaving);
    return false;
  }

  const ride = chooseRide(world, slot);
  if (ride >= 0) {
    const targetX = world.rides.cols.entranceX[ride];
    const targetY = world.rides.cols.entranceY[ride];
    const id = world.rides.slotToId[ride];
    if (g.targetRide[slot] !== id) {
      g.targetRide[slot] = id;
      g.targetX[slot] = targetX;
      g.targetY[slot] = targetY;
      g.patience[slot] = QUEUE_PATIENCE;
    }
    moveTowardTarget(world, slot, pathfinder, pathBuffer);
    if (((g.x[slot] / TILE_UNITS) | 0) === targetX && ((g.y[slot] / TILE_UNITS) | 0) === targetY) {
      g.state[slot] = GuestState.Queuing;
      world.rides.cols.queueLength[ride]++;
    }
    return false;
  }

  if (g.targetRide[slot] >= 0) g.targetRide[slot] = -1;
  if ((world.tick + world.guests.slotToId[slot]) % 80 === 0) {
    g.targetX[slot] = world.rng.int(world.map.width);
    g.targetY[slot] = world.rng.int(world.map.height);
  }
  moveTowardTarget(world, slot, pathfinder, pathBuffer);
  return false;
}

export function createGuestSystem(
  pathfinder: Pathfinder = nullPathfinder,
  admissionProvider: GuestAdmissionProvider = admissionFromEconomy,
): System {
  let pathBuffer = new Int32Array(0);
  return {
    name: 'guests',
    update(world) {
      if (pathBuffer.length < world.map.width * world.map.height)
        pathBuffer = new Int32Array(world.map.width * world.map.height);
      if (world.tick % ARRIVAL_INTERVAL === 0) {
        const admission = admissionProvider(world);
        const rideCapacity = world.rides.count * 50;
        const capacity = Math.min(world.guests.capacity, BASE_GUEST_CAP + rideCapacity);
        const feePenalty = Math.max(
          0,
          admission.entranceFee - Math.max(100, admission.parkRating * 2),
        );
        const arrivalChance = Math.max(0, Math.min(1000, admission.parkRating - feePenalty));
        if (world.guests.count < capacity && world.rng.int(1000) < arrivalChance) spawnGuest(world);
      }
      for (let slot = 0; slot < world.guests.count;) {
        if ((world.tick + world.guests.slotToId[slot]) % UPDATE_STRIDE === 0) {
          if (updateGuest(world, slot, pathfinder, pathBuffer)) {
            world.guests.despawnSlot(slot);
            continue;
          }
        }
        slot++;
      }
    },
  };
}

export const guestSystem = createGuestSystem();

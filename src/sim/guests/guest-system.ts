import type { System } from '../core/system';
import type { World } from '../core/world';
import { TILE_UNITS } from '../core/constants';
import { charge, earn, gateAdmissionCents, marketingAttraction } from '../economy/api';
import { BASIS_POINTS, LedgerCategory } from '../economy/ledger';
import {
  DEFAULT_GUEST_OPTS,
  DIR_DX,
  DIR_DY,
  DIR_NONE,
  isReachable,
  nextDirection,
} from '../pathfinding';
import type { NavOptions } from '../pathfinding';
import { addRideIncome, isShopCategory, rideQueueCapacity } from '../rides/ride-operations';
import { RideState } from '../rides/ride-store';
import { ticketPriceCents } from '../rides/queue-system';
import { RIDE_CATALOG, RideType } from '../rides/ride-types';
import { GuestState, GuestThought, HEADING_NONE, recordThought, spawnGuest } from './guest-store';
import { hasParkEntrance, parkEntranceTile } from './park';
import { exceedsNauseaLimit, intensityCeilingOf, preferredIntensityOf } from './preferences';
import { recountRideLines } from './ride-lines';
import { WeatherKind } from '../weather/weather';
import { PathFlag } from '../map/tile-map';

const UPDATE_STRIDE = 4;
const GUEST_SPEED = 12;
const TILE_CENTRE = TILE_UNITS >> 1;
/** Needs change once per this many guest updates. */
const NEED_DECAY_UPDATES = 8;
/** Happiness a ride gives: a flat part plus 1 per this many hundredths of excitement. */
const RIDE_HAPPINESS = 8;
const EXCITEMENT_PER_HAPPINESS = 40;
const APPROACH_PATIENCE = 2400;
const QUEUE_PATIENCE = 3200;
const RIDE_COOLDOWN = 640;
const HUNGER_THOUGHT = 160;
const THIRST_THOUGHT = 160;
const TOILET_THOUGHT = 160;
const HUNGER_SEEK = 128;
const THIRST_SEEK = 128;
const TOILET_SEEK = 128;
/** How far (Chebyshev tiles) a guest notices a stall or toilets. */
const SIGHT_TILES = 10;
const MEAL_RELIEF = 176;
const MEAL_THIRST = 32;
const SHOP_HAPPINESS = 8;
const STOCK_COST_PERCENT = 40;
const LEAVE_HAPPINESS = 16;
const LEAVE_ENERGY = 12;
const ARRIVAL_INTERVAL = 40;
/** Guests the park comfortably holds before arrivals taper off: a base plus what its rides add. */
const COMFORTABLE_BASE = 30;
const COMFORTABLE_PER_ATTRACTION = 40;
const COMFORTABLE_PER_STALL = 8;
/** Longest line, in guests, a stall or facility tolerates before newcomers look elsewhere. */
const STALL_LINE_LIMIT = 8;
/** Score cost of each guest already in a ride's line, in the same units as excitement x 4. */
const LINE_COST = 100;
/** Score cost of walking to a thrill ride in the rain without an umbrella. */
const RAIN_PENALTY = 1200;
/** Largest deterministic per-guest, per-ride preference swing, in score units. */
const TASTE_RANGE = 400;
/** The swing changes every 2^TASTE_EPOCH_SHIFT ticks, so a guest does not always want the same ride. */
const TASTE_EPOCH_SHIFT = 11;
/** Unsheltered guests outdoors in rain lose this much happiness once per `RAIN_LOSS_PERIOD` × 16 ticks. */
const RAIN_HAPPINESS_LOSS = 2;
const RAIN_LOSS_PERIOD = 8;
/** Tiles (self and four neighbours) a rain shelter covers. */
const SHELTER_REACH: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export interface GuestAdmission {
  parkRating: number;
  entranceFee: number;
  /** Arrival multiplier in basis points; 10000 (the default) means no campaign. */
  attractionBps?: number;
}

export type GuestAdmissionProvider = (world: World) => GuestAdmission;

/**
 * A guest holds the number of trips that must finish before theirs does; trips on one ride end in
 * the order they left, so theirs is done once the completed count has moved past it.
 */
function tripFinished(completed: number, tag: number): boolean {
  const passed = ((completed & 0xffff) - tag) & 0xffff;
  return passed >= 1 && passed < 0x8000;
}

function admissionFromEconomy(world: World): GuestAdmission {
  return {
    parkRating: world.economy.parkRating,
    entranceFee: gateAdmissionCents(world),
    attractionBps: marketingAttraction(world),
  };
}

function rideCategory(world: World, ride: number): string {
  return RIDE_CATALOG[world.rides.cols.typeId[ride] as RideType]?.category ?? 'facility';
}

function isThrillCategory(category: string): boolean {
  return !isShopCategory(category);
}

/** Slot of the guest's destination ride, or -1 when it has none or the ride is gone. */
function targetRideSlot(world: World, slot: number): number {
  const id = world.guests.cols.targetRide[slot];
  return id < 0 ? -1 : world.rides.idToSlot[id];
}

function tileDistance(world: World, a: number, b: number): number {
  const w = world.map.width;
  const dx = Math.abs((a % w) - (b % w));
  const dy = Math.abs(((a / w) | 0) - ((b / w) | 0));
  return dx > dy ? dx : dy;
}

function entranceTile(world: World, ride: number): number {
  return world.map.index(world.rides.cols.entranceX[ride], world.rides.cols.entranceY[ride]);
}

const NOT_OFFERED = -1;
const TOO_INTENSE = -2;
const TOO_NAUSEOUS = -3;
const LINE_FULL = -4;

/** Stable pseudo-random swing so guests with equal needs do not all pick the same ride. */
function taste(world: World, slot: number, ride: number): number {
  const mix =
    Math.imul(world.guests.slotToId[slot] + 1, 0x9e3779b1) ^
    Math.imul(world.rides.slotToId[ride] + 1, 0x85ebca6b) ^
    Math.imul((world.tick >> TASTE_EPOCH_SHIFT) + 1, 0xc2b2ae35);
  return (
    ((Math.imul(mix ^ (mix >>> 15), 0x2c1b3c6d) >>> 8) % (TASTE_RANGE + 1)) - (TASTE_RANGE >> 1)
  );
}

/** Positive when the guest wants the ride; a negative code says why it does not. */
function scoreRide(world: World, slot: number, ride: number): number {
  const r = world.rides.cols;
  const g = world.guests.cols;
  const price = ticketPriceCents(world, ride);
  if (r.state[ride] !== RideState.Open || r.entrancePlaced[ride] === 0 || price > g.cash[slot]) {
    return NOT_OFFERED;
  }
  const category = rideCategory(world, ride);
  if (!isThrillCategory(category)) return NOT_OFFERED;
  if (r.intensity[ride] > intensityCeilingOf(g.preferredIntensity[slot])) return TOO_INTENSE;
  if (exceedsNauseaLimit(r.nausea[ride], g.nausea[slot], g.nauseaTolerance[slot])) {
    return TOO_NAUSEOUS;
  }
  const lines = world.rideLines;
  const line = lines.queued[ride] + lines.approaching[ride];
  if (line >= rideQueueCapacity(world, ride)) return LINE_FULL;
  const intensityGap = Math.abs(
    r.intensity[ride] - preferredIntensityOf(g.preferredIntensity[slot]),
  );
  const nauseaCost = r.nausea[ride] + g.nausea[slot] * 4;
  const rainPenalty =
    world.weather.kind >= WeatherKind.Rain &&
    world.umbrellas[world.guests.slotToId[slot]] === 0 &&
    (category === 'thrill' || category === 'coaster')
      ? RAIN_PENALTY
      : 0;
  const score =
    r.excitement[ride] * 4 -
    intensityGap * 2 -
    nauseaCost * 3 -
    price -
    line * LINE_COST -
    rainPenalty +
    taste(world, slot, ride);
  return score > 0 ? score : NOT_OFFERED;
}

function chooseRide(world: World, slot: number, tile: number): number {
  let selected = -1;
  let bestScore = 0;
  let tooIntense = false;
  let tooNauseous = false;
  let full = false;
  for (let ride = 0; ride < world.rides.count; ride++) {
    const score = scoreRide(world, slot, ride);
    if (score === TOO_INTENSE) tooIntense = true;
    else if (score === TOO_NAUSEOUS) tooNauseous = true;
    else if (score === LINE_FULL) full = true;
    if (score <= bestScore) continue;
    if (!isReachable(world, tile, entranceTile(world, ride))) continue;
    bestScore = score;
    selected = ride;
  }
  if (selected < 0) {
    if (tooIntense) recordThought(world, slot, GuestThought.TooIntense);
    else if (tooNauseous) recordThought(world, slot, GuestThought.TooNauseous);
    else if (full) recordThought(world, slot, GuestThought.QueueTooLong);
  }
  return selected;
}

/** Nearest open, affordable, visible and reachable service of `type`, or -1. */
function nearestService(world: World, slot: number, tile: number, type: RideType): number {
  const r = world.rides.cols;
  const cash = world.guests.cols.cash[slot];
  let selected = -1;
  let best = SIGHT_TILES + 1;
  for (let ride = 0; ride < world.rides.count; ride++) {
    if (r.typeId[ride] !== type || r.state[ride] !== RideState.Open) continue;
    if (r.entrancePlaced[ride] === 0 || r.price[ride] > cash) continue;
    if (world.rideLines.queued[ride] + world.rideLines.approaching[ride] >= STALL_LINE_LIMIT) {
      continue;
    }
    const entrance = entranceTile(world, ride);
    const distance = tileDistance(world, tile, entrance);
    if (distance >= best || !isReachable(world, tile, entrance)) continue;
    best = distance;
    selected = ride;
  }
  return selected;
}

/** Picks what a wandering guest heads for next: a need first, then a ride. */
function chooseDestination(world: World, slot: number, tile: number): number {
  const g = world.guests.cols;
  if (g.toilet[slot] >= TOILET_SEEK) {
    const toilets = nearestService(world, slot, tile, RideType.Toilets);
    if (toilets >= 0) return toilets;
  }
  if (
    world.weather.kind >= WeatherKind.Rain &&
    world.umbrellas[world.guests.slotToId[slot]] === 0
  ) {
    const kiosk = nearestService(world, slot, tile, RideType.InformationKiosk);
    if (kiosk >= 0) return kiosk;
  }
  const hungry = g.hunger[slot] >= HUNGER_SEEK;
  const thirsty = g.thirst[slot] >= THIRST_SEEK;
  if (hungry || thirsty) {
    const foodFirst = hungry && (!thirsty || g.hunger[slot] >= g.thirst[slot]);
    const first = foodFirst ? RideType.FoodStall : RideType.DrinkStall;
    const second = foodFirst ? RideType.DrinkStall : RideType.FoodStall;
    const stall = nearestService(world, slot, tile, first);
    if (stall >= 0) return stall;
    if (hungry && thirsty) {
      const other = nearestService(world, slot, tile, second);
      if (other >= 0) return other;
    }
  }
  if (g.activityTicks[slot] === 0) return chooseRide(world, slot, tile);
  return -1;
}

function setDestination(world: World, slot: number, ride: number): void {
  const g = world.guests.cols;
  g.targetRide[slot] = world.rides.slotToId[ride];
  g.targetX[slot] = world.rides.cols.entranceX[ride];
  g.targetY[slot] = world.rides.cols.entranceY[ride];
  g.patience[slot] = APPROACH_PATIENCE;
  world.rideLines.approaching[ride]++;
}

function clearDestination(world: World, slot: number): void {
  const g = world.guests.cols;
  g.targetRide[slot] = -1;
  if (g.state[slot] === GuestState.Queuing) g.state[slot] = GuestState.Wandering;
}

function moveAlongHeading(world: World, slot: number): void {
  const g = world.guests.cols;
  const heading = g.heading[slot];
  if (heading > 3) {
    if (!atTileCentre(world, slot)) snapToTileCentre(world, slot);
    return;
  }
  const horizontal = heading === 0 || heading === 2;
  const position = horizontal ? g.x[slot] : g.y[slot];
  const centre = (((position - TILE_CENTRE) >> 8) << 8) + TILE_CENTRE;
  const forward = (horizontal ? DIR_DX[heading] : DIR_DY[heading]) > 0;
  const destination = forward
    ? centre + TILE_UNITS
    : position === centre
      ? centre - TILE_UNITS
      : centre;
  const remaining = destination - position;
  const reach =
    remaining > GUEST_SPEED ? GUEST_SPEED : remaining < -GUEST_SPEED ? -GUEST_SPEED : remaining;
  if (horizontal) g.x[slot] += reach;
  else g.y[slot] += reach;
  g.z[slot] = world.map.heightAt(g.x[slot], g.y[slot]);
}

/** A guest with no heading that is not on a tile centre (e.g. from an old save) re-centres. */
function snapToTileCentre(world: World, slot: number): void {
  const g = world.guests.cols;
  placeOnTile(world, slot, g.x[slot] >> 8, g.y[slot] >> 8);
}

function atTileCentre(world: World, slot: number): boolean {
  const g = world.guests.cols;
  return (
    (g.x[slot] & (TILE_UNITS - 1)) === TILE_CENTRE && (g.y[slot] & (TILE_UNITS - 1)) === TILE_CENTRE
  );
}

function placeOnTile(world: World, slot: number, tx: number, ty: number): void {
  const g = world.guests.cols;
  g.x[slot] = tx * TILE_UNITS + TILE_CENTRE;
  g.y[slot] = ty * TILE_UNITS + TILE_CENTRE;
  g.z[slot] = world.map.heightAt(g.x[slot], g.y[slot]);
  g.heading[slot] = HEADING_NONE;
}

/** Leaves the ride through its exit; falls back to the entrance when the exit is off the paths. */
function stepOffRide(world: World, slot: number, ride: number): void {
  const r = world.rides.cols;
  const map = world.map;
  const exitUsable =
    r.exitPlaced[ride] === 1 && map.isWalkable(map.index(r.exitX[ride], r.exitY[ride]));
  if (exitUsable) placeOnTile(world, slot, r.exitX[ride], r.exitY[ride]);
  else placeOnTile(world, slot, r.entranceX[ride], r.entranceY[ride]);
}

function finishRide(world: World, slot: number, ride: number): void {
  const g = world.guests.cols;
  if (ride >= 0) {
    const r = world.rides.cols;
    g.nausea[slot] = Math.min(255, g.nausea[slot] + (r.nausea[ride] >> 4));
    g.happiness[slot] = Math.min(
      255,
      g.happiness[slot] +
        RIDE_HAPPINESS +
        Math.floor(r.excitement[ride] / EXCITEMENT_PER_HAPPINESS),
    );
    g.energy[slot] = Math.min(255, g.energy[slot] + 32);
    stepOffRide(world, slot, ride);
  } else if (hasParkEntrance(world)) {
    placeOnTile(world, slot, world.park.entranceX, world.park.entranceY);
  } else {
    g.state[slot] = GuestState.Leaving;
    g.targetRide[slot] = -1;
    return;
  }
  recordThought(world, slot, GuestThought.RideEnjoyed);
  g.targetRide[slot] = -1;
  g.activityTicks[slot] = RIDE_COOLDOWN;
  g.state[slot] = GuestState.Wandering;
}

function finishShopping(world: World, slot: number, ride: number): void {
  const g = world.guests.cols;
  g.targetRide[slot] = -1;
  g.activityTicks[slot] = 0;
  g.state[slot] = GuestState.Wandering;
  if (ride < 0) return;
  const r = world.rides.cols;
  const type = r.typeId[ride] as RideType;
  const price = Math.min(r.price[ride], g.cash[slot]);
  g.cash[slot] -= price;
  if (type === RideType.Toilets) {
    g.toilet[slot] = 0;
    if (price > 0) {
      earn(world, LedgerCategory.ShopSales, price);
      addRideIncome(world, ride, price);
    }
  } else if (type === RideType.InformationKiosk) {
    world.umbrellas[world.guests.slotToId[slot]] = 1;
    if (price > 0) {
      earn(world, LedgerCategory.ShopSales, price);
      addRideIncome(world, ride, price);
    }
  } else {
    if (type === RideType.FoodStall) {
      g.hunger[slot] = Math.max(0, g.hunger[slot] - MEAL_RELIEF);
      g.thirst[slot] = Math.min(255, g.thirst[slot] + MEAL_THIRST);
    } else {
      g.thirst[slot] = Math.max(0, g.thirst[slot] - MEAL_RELIEF);
    }
    earn(world, LedgerCategory.FoodDrinkSales, price);
    addRideIncome(world, ride, price);
    charge(world, LedgerCategory.FoodDrinkStock, Math.floor((price * STOCK_COST_PERCENT) / 100));
  }
  g.happiness[slot] = Math.min(255, g.happiness[slot] + SHOP_HAPPINESS);
  r.guestsServed[ride]++;
}

/** Starts using a stall or facility at its entrance tile. */
function beginShopping(world: World, slot: number, ride: number): void {
  const g = world.guests.cols;
  g.state[slot] = GuestState.Shopping;
  g.activityTicks[slot] = 0;
  world.rideLines.serving[ride]++;
}

function serviceCapacity(world: World, ride: number): number {
  return RIDE_CATALOG[world.rides.cols.typeId[ride] as RideType].capacity;
}

/** Reaches the entrance tile of the guest's destination: join its queue or start using it. */
function arriveAtDestination(world: World, slot: number, ride: number): void {
  const g = world.guests.cols;
  const r = world.rides.cols;
  const category = rideCategory(world, ride);
  const price = isThrillCategory(category) ? ticketPriceCents(world, ride) : r.price[ride];
  const lines = world.rideLines;
  const unwanted =
    world.umbrellas[world.guests.slotToId[slot]] === 1 &&
    r.typeId[ride] === RideType.InformationKiosk;
  if (r.state[ride] !== RideState.Open || price > g.cash[slot] || unwanted) {
    clearDestination(world, slot);
    return;
  }
  if (isThrillCategory(category)) {
    if (lines.queued[ride] + lines.approaching[ride] > rideQueueCapacity(world, ride)) {
      recordThought(world, slot, GuestThought.QueueTooLong);
      clearDestination(world, slot);
      return;
    }
    g.state[slot] = GuestState.Waiting;
    g.patience[slot] = QUEUE_PATIENCE;
    r.queueLength[ride]++;
  } else if (lines.serving[ride] < serviceCapacity(world, ride)) {
    beginShopping(world, slot, ride);
  } else if (lines.queued[ride] + lines.approaching[ride] > STALL_LINE_LIMIT) {
    recordThought(world, slot, GuestThought.QueueTooLong);
    clearDestination(world, slot);
  } else {
    g.state[slot] = GuestState.Waiting;
    g.patience[slot] = QUEUE_PATIENCE;
  }
}

/** Drops out of a line; the guest only complains when it ran out of patience. */
function leaveQueue(world: World, slot: number, gaveUp: boolean): void {
  const g = world.guests.cols;
  const ride = targetRideSlot(world, slot);
  if (
    ride >= 0 &&
    isThrillCategory(rideCategory(world, ride)) &&
    world.rides.cols.queueLength[ride] > 0
  ) {
    world.rides.cols.queueLength[ride]--;
  }
  if (gaveUp) recordThought(world, slot, GuestThought.QueueTooLong);
  g.targetRide[slot] = -1;
  g.state[slot] = GuestState.Wandering;
}

function nearRainShelter(world: World, tileX: number, tileY: number): boolean {
  const map = world.map;
  for (const [dx, dy] of SHELTER_REACH) {
    if (!map.inBounds(tileX + dx, tileY + dy)) continue;
    const element = map.pathElement(map.index(tileX + dx, tileY + dy), -1);
    if (element >= 0 && (map.elFlags[element] & PathFlag.Shelter) !== 0) return true;
  }
  return false;
}

function exposedToRain(world: World, slot: number): boolean {
  const g = world.guests.cols;
  if (world.weather.kind < WeatherKind.Rain) return false;
  if (world.umbrellas[world.guests.slotToId[slot]] !== 0) return false;
  const state = g.state[slot];
  if (
    state !== GuestState.Wandering &&
    state !== GuestState.Queuing &&
    state !== GuestState.Waiting
  )
    return false;
  return !nearRainShelter(world, g.x[slot] >> 8, g.y[slot] >> 8);
}

function ageNeeds(world: World, slot: number): void {
  const g = world.guests.cols;
  const state = g.state[slot];
  if (
    exposedToRain(world, slot) &&
    ((world.tick + world.guests.slotToId[slot]) >> 4) % RAIN_LOSS_PERIOD === 0
  ) {
    g.happiness[slot] = Math.max(0, g.happiness[slot] - RAIN_HAPPINESS_LOSS);
  }
  g.hunger[slot] = Math.min(255, g.hunger[slot] + 1);
  g.thirst[slot] = Math.min(255, g.thirst[slot] + 1);
  g.toilet[slot] = Math.min(255, g.toilet[slot] + (g.thirst[slot] > 180 ? 2 : 1));
  if (state === GuestState.Wandering || state === GuestState.Queuing) {
    g.energy[slot] = Math.max(0, g.energy[slot] - 1);
  }
  g.nausea[slot] = Math.max(0, g.nausea[slot] - 1);
  g.happiness[slot] = Math.max(
    0,
    g.happiness[slot] - (g.hunger[slot] > 220 || g.thirst[slot] > 220 ? 1 : 0),
  );
  if (g.hunger[slot] >= HUNGER_THOUGHT) recordThought(world, slot, GuestThought.Hungry);
  else if (g.thirst[slot] >= THIRST_THOUGHT) recordThought(world, slot, GuestThought.Thirsty);
  else if (g.toilet[slot] >= TOILET_THOUGHT) recordThought(world, slot, GuestThought.NeedsToilet);
}

/** Walks one step toward `target` (or wanders when negative). Returns false if no step exists. */
function stepToward(
  world: World,
  slot: number,
  tile: number,
  target: number,
  nav: NavOptions,
): boolean {
  const g = world.guests.cols;
  nav.fromDir = g.heading[slot] > 3 ? DIR_NONE : g.heading[slot];
  const dir = nextDirection(world, tile, target, world.rng, nav);
  if (dir === DIR_NONE) return false;
  g.heading[slot] = dir;
  moveAlongHeading(world, slot);
  return true;
}

/** Returns true when the guest has left the park and should be despawned. */
function updateGuest(world: World, slot: number, nav: NavOptions): boolean {
  const g = world.guests.cols;
  if (((world.tick + world.guests.slotToId[slot]) >> 2) % NEED_DECAY_UPDATES === 0) {
    ageNeeds(world, slot);
  }
  const state = g.state[slot];
  if (
    world.weather.kind >= WeatherKind.Rain &&
    world.umbrellas[world.guests.slotToId[slot]] === 0 &&
    state === GuestState.Wandering
  ) {
    const guestX = g.x[slot] >> 8;
    const guestY = g.y[slot] >> 8;
    for (let ride = 0; ride < world.rides.count; ride++) {
      if (
        world.rides.cols.typeId[ride] !== RideType.InformationKiosk ||
        world.rides.cols.state[ride] !== RideState.Open ||
        world.rides.cols.entrancePlaced[ride] === 0 ||
        Math.abs(world.rides.cols.entranceX[ride] - guestX) > 1 ||
        Math.abs(world.rides.cols.entranceY[ride] - guestY) > 1
      )
        continue;
      const price = world.rides.cols.price[ride];
      if (price <= g.cash[slot]) {
        world.umbrellas[world.guests.slotToId[slot]] = 1;
        g.cash[slot] -= price;
        earn(world, LedgerCategory.ShopSales, price);
        addRideIncome(world, ride, price);
        break;
      }
    }
  }
  if (state === GuestState.Riding) {
    const ride = targetRideSlot(world, slot);
    if (ride < 0 || tripFinished(world.rides.cols.cyclesCompleted[ride], g.activityTicks[slot])) {
      finishRide(world, slot, ride);
    }
    return false;
  }

  if (state === GuestState.Shopping) {
    const ride = targetRideSlot(world, slot);
    g.activityTicks[slot] += UPDATE_STRIDE;
    const duration =
      ride < 0 ? 0 : RIDE_CATALOG[world.rides.cols.typeId[ride] as RideType].runTicks;
    if (g.activityTicks[slot] >= duration) finishShopping(world, slot, ride);
    return false;
  }

  if (state === GuestState.Waiting) {
    const ride = targetRideSlot(world, slot);
    g.patience[slot] = Math.max(0, g.patience[slot] - UPDATE_STRIDE);
    if (ride < 0 || world.rides.cols.state[ride] !== RideState.Open || g.patience[slot] === 0) {
      leaveQueue(world, slot, g.patience[slot] === 0);
    } else if (
      !isThrillCategory(rideCategory(world, ride)) &&
      world.rideLines.serving[ride] < serviceCapacity(world, ride)
    ) {
      beginShopping(world, slot, ride);
    }
    return false;
  }

  const map = world.map;
  const tile = map.index(g.x[slot] >> 8, g.y[slot] >> 8);

  if (state === GuestState.Leaving) {
    if (!atTileCentre(world, slot)) {
      moveAlongHeading(world, slot);
      return false;
    }
    // No gate or no footpath route to it: the guest finds its own way out and leaves the park.
    const gate = parkEntranceTile(world);
    return gate < 0 || tile === gate || !stepToward(world, slot, tile, gate, nav);
  }

  if (g.targetRide[slot] >= 0) {
    g.patience[slot] = Math.max(0, g.patience[slot] - UPDATE_STRIDE);
    if (g.patience[slot] === 0) clearDestination(world, slot);
  }
  if (g.activityTicks[slot] > 0)
    g.activityTicks[slot] = Math.max(0, g.activityTicks[slot] - UPDATE_STRIDE);

  if (!atTileCentre(world, slot)) {
    moveAlongHeading(world, slot);
    return false;
  }

  if (g.happiness[slot] <= LEAVE_HAPPINESS || g.energy[slot] <= LEAVE_ENERGY || g.cash[slot] <= 0) {
    g.state[slot] = GuestState.Leaving;
    g.targetRide[slot] = -1;
    recordThought(world, slot, GuestThought.Leaving);
    return false;
  }

  let ride = targetRideSlot(world, slot);
  if (g.targetRide[slot] >= 0 && (ride < 0 || world.rides.cols.state[ride] !== RideState.Open)) {
    clearDestination(world, slot);
    ride = -1;
  }
  if (ride < 0) {
    ride = chooseDestination(world, slot, tile);
    if (ride >= 0) setDestination(world, slot, ride);
  }

  if (ride >= 0) {
    if (tile === entranceTile(world, ride)) {
      arriveAtDestination(world, slot, ride);
      return false;
    }
    if (
      g.state[slot] === GuestState.Wandering &&
      isThrillCategory(rideCategory(world, ride)) &&
      map.isQueue(tile)
    ) {
      g.state[slot] = GuestState.Queuing;
      g.patience[slot] = QUEUE_PATIENCE;
    }
    if (stepToward(world, slot, tile, entranceTile(world, ride), nav)) return false;
    clearDestination(world, slot);
  }
  stepToward(world, slot, tile, -1, nav);
  return false;
}

/** Guests the park holds comfortably: what its open rides, stalls and facilities can serve. */
function comfortableGuests(world: World): number {
  const r = world.rides.cols;
  let total = COMFORTABLE_BASE;
  for (let ride = 0; ride < world.rides.count; ride++) {
    if (r.state[ride] !== RideState.Open) continue;
    total += isThrillCategory(rideCategory(world, ride))
      ? COMFORTABLE_PER_ATTRACTION
      : COMFORTABLE_PER_STALL;
  }
  return total;
}

function spawnArrival(world: World, admission: GuestAdmission): void {
  const feePenalty = Math.max(0, admission.entranceFee - Math.max(100, admission.parkRating * 2));
  const base = Math.max(0, Math.min(1000, admission.parkRating - feePenalty));
  const campaign = Math.floor((base * (admission.attractionBps ?? BASIS_POINTS)) / BASIS_POINTS);
  const comfortable = comfortableGuests(world);
  const guests = world.guests.count;
  if (guests >= world.guests.capacity || guests >= comfortable) return;
  const chance = Math.floor((campaign * (comfortable - guests)) / comfortable);
  if (world.rng.int(1000) >= chance) return;
  if (!spawnGuest(world)) return;
  const slot = world.guests.count - 1;
  const fee = Math.min(admission.entranceFee, world.guests.cols.cash[slot]);
  if (fee > 0) {
    world.guests.cols.cash[slot] -= fee;
    earn(world, LedgerCategory.Admission, fee);
  }
}

export function createGuestSystem(
  admissionProvider: GuestAdmissionProvider = admissionFromEconomy,
): System {
  const nav: NavOptions = { ...DEFAULT_GUEST_OPTS };
  return {
    name: 'guests',
    update(world) {
      recountRideLines(world);
      if (world.tick % ARRIVAL_INTERVAL === 0 && hasParkEntrance(world)) {
        spawnArrival(world, admissionProvider(world));
      }
      for (let slot = 0; slot < world.guests.count;) {
        if ((world.tick + world.guests.slotToId[slot]) % UPDATE_STRIDE === 0) {
          if (updateGuest(world, slot, nav)) {
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

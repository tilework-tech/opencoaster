import type { System } from '../core/system';
import type { World } from '../core/world';
import { TILE_UNITS } from '../core/constants';
import {
  arrivalVoucher,
  earn,
  gateAdmissionCents,
  marketingAttraction,
  marketingTargetRide,
} from '../economy/api';
import { BASIS_POINTS, LedgerCategory, PriceMode } from '../economy/ledger';
import { gateFeeAfterVoucher, isEntryVoucher, VoucherKind } from '../economy/vouchers';
import {
  DEFAULT_GUEST_OPTS,
  DIR_DX,
  DIR_DY,
  DIR_NONE,
  isReachable,
  nextDirection,
} from '../pathfinding';
import type { NavOptions } from '../pathfinding';
import {
  addRideIncome,
  getRideValueCents,
  isServingGuests,
  isShopCategory,
  rideQueueCapacity,
} from '../rides/ride-operations';
import { stallServiceNode } from '../rides/stall-front';
import { RideState } from '../rides/ride-store';
import {
  directionBetween,
  updateQueueLines,
  noteQueueJoin,
  queueEntryBlocked,
  queueLineCoord,
  queueLinePoint,
  queueSegmentHeading,
  QUEUE_SPACING,
  refreshQueueIndex,
} from '../rides/queue-lines';
import {
  acceptsItemPrice,
  ITEM_TOLERANCE_ROLLS,
  itemValueCents,
  maxItemPriceCents,
  maxRidePriceCents,
  priceIsAcceptable,
} from './willingness';
import { ticketPriceCents } from '../rides/queue-system';
import { RIDE_CATALOG, RideType } from '../rides/ride-types';
import {
  GUEST_UPDATE_STRIDE,
  GuestState,
  GuestThought,
  HEADING_NONE,
  recordThought,
  spawnGuest,
} from './guest-store';
import { benchHasFreeSeat, nearestFreeBench } from './benches';
import {
  beginSitting,
  BENCH_RETRY_TICKS,
  BENCH_SEEK_RADIUS,
  updateSitting,
  wantsRest,
} from './resting';
import { Container, ShopItem, shopItemDef } from '../rides/shop-items';
import {
  DRINK_THIRST_LIMIT,
  FOOD_HUNGER_LIMIT,
  SOUVENIR_MIN_RIDES,
  SOUVENIR_ROLLS,
  chooseStallItem,
  completeSale,
  ignoresPrice,
  itemPriceCents,
  passesSouvenirRoll,
  wantedItemIndex,
} from './shopping';
import { useBin } from './litter-store';
import { useBin } from './litter-store';
import { noteTileSights } from './path-sights';
import { useBin } from './litter-store';
import { carriesVoucherFor, guestPriceCents, spendVoucher } from './vouchers';
import {
  applyGuestBudget,
  EXIT_HAPPINESS_LOSS,
  EXIT_PENALTY_TICKS,
  isLost,
  noteNavigation,
  noteStranded,
  tickLost,
} from './navigation';
import { hasParkEntrance, parkEntranceTile } from './park';
import { exceedsNauseaLimit, intensityCeilingOf, preferredIntensityOf } from './preferences';
import { recountRideLines } from './ride-lines';
import { WeatherKind } from '../weather/weather';
import { awardAttractionBps } from '../economy/awards';
import { updateGuestSurroundings } from './surroundings';

const UPDATE_STRIDE = GUEST_UPDATE_STRIDE;
const GUEST_SPEED = 12;
const TILE_CENTRE = TILE_UNITS >> 1;
/** Needs change once every 128 world ticks. */
const NEED_DECAY_TICKS = 128;
/** Idle happiness motives update once every four need updates. */
const IDLE_MOTIVE_TICKS = 512;
/** RCT2 checks guests without a ride destination after five 2,048-tick periods. */
const LEAVE_CHECK_TICKS = 10_240;
/** Need thoughts are raised once per 1,024 ticks. */
const THOUGHT_TICKS = 1024;
const ENERGY_MIN = 32;
const ENERGY_MAX = 128;
/** Energy, happiness and cash a guest needs to be sure of staying; below any of them it may leave. */
const STAY_ENERGY = 55;
const STAY_HAPPINESS = 45;
const STAY_CASH = 500;
/** Chance in 65,536 that an unsettled guest leaves at an idle check (about 5%). */
const LEAVE_CHANCE = 3277;
const TIRED_ENERGY = 70;
const TIRED_HAPPINESS_CEILING = 128;
/** Happiness a ride gives: a flat part plus 1 per this many hundredths of excitement. */
const RIDE_HAPPINESS = 8;
const EXCITEMENT_PER_HAPPINESS = 40;
const APPROACH_PATIENCE = 2400;
const QUEUE_PATIENCE = 3200;
const QUEUE_BALK_TICKS = 4300;
/** A guest in a built queue waits this long plus 24 ticks per point of happiness before leaving. */
const QUEUE_PATIENCE_BASE = 2400;
const QUEUE_PATIENCE_PER_HAPPINESS = 24;
/** Waiting this long in a line earns the "queuing for ages" thought and costs happiness. */
const QUEUE_GRUMBLE_TICKS = 2400;
const RIDE_COOLDOWN = 640;
const HUNGER_THOUGHT = 10;
const THIRST_THOUGHT = 25;
const TOILET_THOUGHT = 160;
const HUNGER_SEEK = FOOD_HUNGER_LIMIT;
const THIRST_SEEK = DRINK_THIRST_LIMIT;
/** A wandering guest at a tile centre considers a souvenir stall at about one in this many steps. */
const SOUVENIR_URGE_ONE_IN = 64;
const TOILET_SEEK = 128;
/** How far (Chebyshev tiles) a guest notices a stall or toilets. */
const SIGHT_TILES = 10;
const SHOP_HAPPINESS = 8;
const ARRIVAL_RANDOM_RANGE = 65_536;
const ARRIVAL_INPUT_REFRESH_TICKS = 512;
const rideValueByWorld = new WeakMap<
  World,
  { tick: number; rides: Array<{ id: number; type: number; state: number; valueCents: number }> }
>();
/** Guests the park comfortably holds before arrivals taper off: a base plus what its rides add. */
/** Longest line, in guests, a stall or facility tolerates before newcomers look elsewhere. */
const STALL_LINE_LIMIT = 8;
/** Score cost of each guest already in a ride's line, in the same units as excitement x 4. */
/** Score cost of walking to a thrill ride in the rain without an umbrella. */
const RAIN_PENALTY = 1200;
/** Largest deterministic per-guest, per-ride preference swing, in score units. */
const TASTE_RANGE = 400;
/** The swing changes every 2^TASTE_EPOCH_SHIFT ticks, so a guest does not always want the same ride. */
const TASTE_EPOCH_SHIFT = 11;

export interface GuestAdmission {
  parkRating: number;
  entranceFee: number;
  /** Current combined ride value guests consider when judging the park entrance fee. */
  totalRideValueForMoneyCents?: number;
  /** Arrival multiplier in basis points; 10000 (the default) means no campaign. */
  attractionBps?: number;
  /** Active ride campaign target, or -1 when arrivals have no promoted ride. */
  targetRide?: number;
  /** Natural guest-generation multiplier from active park awards. */
  awardBps?: number;
  /** Voucher each arriving guest receives, and the ride or stall it names. */
  voucher?: { kind: VoucherKind; target: number };
}

const NO_VOUCHER = { kind: VoucherKind.None, target: -1 };

export type GuestAdmissionProvider = (world: World) => GuestAdmission;

/**
 * A guest holds the number of trips that must finish before theirs does; trips on one ride end in
 * the order they left, so theirs is done once the completed count has moved past it.
 */
function tripFinished(completed: number, tag: number): boolean {
  const passed = ((completed & 0xffff) - tag) & 0xffff;
  return passed >= 1 && passed < 0x8000;
}

function totalRideValueForMoneyCents(world: World): number {
  const cached = rideValueByWorld.get(world);
  const rides = world.rides.cols;
  const refreshValues =
    !cached ||
    world.tick < cached.tick ||
    world.tick % ARRIVAL_INPUT_REFRESH_TICKS === 0 ||
    cached.rides.length !== world.rides.count ||
    cached.rides.some(
      (ride, slot) =>
        ride.id !== world.rides.slotToId[slot] ||
        ride.type !== rides.typeId[slot] ||
        ride.state !== rides.state[slot],
    );
  const values = refreshValues
    ? Array.from({ length: world.rides.count }, (_, slot) => ({
        id: world.rides.slotToId[slot],
        type: rides.typeId[slot],
        state: rides.state[slot],
        valueCents: getRideValueCents(world, world.rides.slotToId[slot]),
      }))
    : cached.rides;
  if (refreshValues) rideValueByWorld.set(world, { tick: world.tick, rides: values });

  let totalCents = 0;
  for (let slot = 0; slot < world.rides.count; slot++) {
    if (!isServingGuests(world, slot)) continue;
    const rideValue = values[slot].valueCents;
    const ridePrice = world.economy.priceMode === PriceMode.PerRide ? rides.price[slot] : 0;
    totalCents += Math.max(0, rideValue - ridePrice) * 2;
  }
  return totalCents;
}

function admissionFromEconomy(world: World): GuestAdmission {
  return {
    parkRating: world.economy.parkRating,
    entranceFee: gateAdmissionCents(world),
    totalRideValueForMoneyCents: totalRideValueForMoneyCents(world),
    attractionBps: marketingAttraction(world),
    targetRide: marketingTargetRide(world),
    awardBps: awardAttractionBps(world.economy.activeAwards, world.tick),
    voucher: arrivalVoucher(world),
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

/** True when the ride is entered through a built queue line rather than straight from a path. */
function hasQueueLine(world: World, ride: number): boolean {
  return world.queues.hasQueue[ride] === 1;
}

/**
 * Walk node a guest walks to for the ride: the ordinary path tile where the queue's open end joins
 * the main path, the footpath piece in front of a stall's window, or -1 when the ride has no way in.
 */
function approachTile(world: World, ride: number): number {
  if (isShopCategory(rideCategory(world, ride))) return stallServiceNode(world, ride);
  return world.queues.joinTile[ride];
}

/** Map tile of a walk node: the node itself on the lowest layer, or the tile under a raised one. */
function nodeTile(world: World, node: number): number {
  return node % (world.map.width * world.map.height);
}

const NOT_OFFERED = -1;
const TOO_INTENSE = -2;
const TOO_NAUSEOUS = -3;
const LINE_FULL = -4;
const TOO_EXPENSIVE = -5;

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
  const price = guestPriceCents(
    world,
    slot,
    world.rides.slotToId[ride],
    ticketPriceCents(world, ride),
    VoucherKind.FreeRide,
  );
  if (r.state[ride] !== RideState.Open || r.entrancePlaced[ride] === 0 || price > g.cash[slot]) {
    return NOT_OFFERED;
  }
  const category = rideCategory(world, ride);
  if (!isThrillCategory(category)) return NOT_OFFERED;
  if (!priceIsAcceptable(price, maxRidePriceCents(world, ride))) return TOO_EXPENSIVE;
  if (g.lastRide[slot] === world.rides.slotToId[ride] && !allowsRepeatRide(world, slot, ride))
    return NOT_OFFERED;
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
    (line * 100) / rideQueueCapacity(world, ride) -
    rainPenalty +
    taste(world, slot, ride);
  return score > 0 ? score : NOT_OFFERED;
}

/** The guest's 0-7 price tolerance at a stall, a stable hash so it does not draw from the shared PRNG. */
function toleranceRoll(world: World, slot: number, ride: number): number {
  const mix =
    Math.imul(world.guests.slotToId[slot] + 1, 0x9e3779b1) ^
    Math.imul(world.rides.slotToId[ride] + 1, 0x27d4eb2f) ^
    Math.imul((world.tick >> TASTE_EPOCH_SHIFT) + 1, 0x165667b1);
  return (Math.imul(mix ^ (mix >>> 15), 0x2c1b3c6d) >>> 8) % ITEM_TOLERANCE_ROLLS;
}

/** The guest's 0-127 draw for the souvenir mood check, a stable hash like the price tolerance. */
function souvenirRoll(world: World, slot: number, ride: number): number {
  const mix =
    Math.imul(world.guests.slotToId[slot] + 1, 0x85ebca6b) ^
    Math.imul(world.rides.slotToId[ride] + 1, 0xc2b2ae35) ^
    Math.imul((world.tick >> TASTE_EPOCH_SHIFT) + 1, 0x27d4eb2f);
  return (Math.imul(mix ^ (mix >>> 15), 0x2c1b3c6d) >>> 8) % SOUVENIR_ROLLS;
}

function allowsRepeatRide(world: World, slot: number, ride: number): boolean {
  const g = world.guests.cols;
  const r = world.rides.cols;
  if (
    r.excitement[ride] <= 0 ||
    r.intensity[ride] > 1000 ||
    g.happiness[slot] < 180 ||
    g.energy[slot] < 100 ||
    g.nausea[slot] > 160 ||
    g.hunger[slot] < 30 ||
    g.thirst[slot] < 20 ||
    g.toilet[slot] > 170
  )
    return false;
  const roll = world.rng.int(10_000);
  return roll < 4960 || (roll < 7500 && g.ridesTaken[slot] <= 7);
}

/** The walk node the guest stands on: its tile, on the layer whose path is nearest its height. */
function guestNode(world: World, slot: number, tile: number): number {
  return world.map.walkNode(tile, world.guests.cols.z[slot]);
}

function chooseRide(world: World, slot: number, tile: number): number {
  let selected = -1;
  let bestScore = 0;
  let tooIntense = false;
  let tooNauseous = false;
  let full = false;
  let tooExpensive = false;
  for (let ride = 0; ride < world.rides.count; ride++) {
    const score = scoreRide(world, slot, ride);
    if (score === TOO_EXPENSIVE) tooExpensive = true;
    else if (score === TOO_INTENSE) tooIntense = true;
    else if (score === TOO_NAUSEOUS) tooNauseous = true;
    else if (score === LINE_FULL) full = true;
    if (score <= bestScore) continue;
    const approach = approachTile(world, ride);
    if (approach < 0 || !isReachable(world, guestNode(world, slot, tile), approach)) continue;
    bestScore = score;
    selected = ride;
  }
  if (selected < 0) {
    if (tooIntense) recordThought(world, slot, GuestThought.TooIntense);
    else if (tooNauseous) recordThought(world, slot, GuestThought.TooNauseous);
    else if (full) recordThought(world, slot, GuestThought.QueueTooLong);
    else if (tooExpensive) recordThought(world, slot, GuestThought.BadValue);
  }
  return selected;
}

/**
 * Nearest open, affordable, visible and reachable stall that is either of type `want` or, for
 * `'food'`, `'drink'` and `'souvenir'`, sells something of that kind the guest wants (for `item`,
 * that item only); -1 when there is none.
 */
function nearestStall(
  world: World,
  slot: number,
  tile: number,
  want: RideType | 'food' | 'drink' | 'souvenir',
  item?: ShopItem,
): number {
  const r = world.rides.cols;
  const cash = world.guests.cols.cash[slot];
  let selected = -1;
  let best = SIGHT_TILES + 1;
  let overpriced = false;
  for (let ride = 0; ride < world.rides.count; ride++) {
    const type = r.typeId[ride] as RideType;
    const def = RIDE_CATALOG[type];
    if (r.state[ride] !== RideState.Open || r.entrancePlaced[ride] === 0) continue;
    let index = 0;
    if (typeof want === 'number') {
      if (type !== want) continue;
      if (def.items) index = wantedItemIndex(world, slot, ride, undefined, item);
    } else {
      if (!def.items) continue;
      index = wantedItemIndex(world, slot, ride, want, item);
    }
    if (index < 0) continue;
    if (
      want === 'souvenir' &&
      !passesSouvenirRoll(world, slot, def.items![index], souvenirRoll(world, slot, ride))
    )
      continue;
    const fare = guestPriceCents(
      world,
      slot,
      world.rides.slotToId[ride],
      def.items ? itemPriceCents(world, ride, index) : r.price[ride],
      VoucherKind.FreeFoodOrDrink,
    );
    if (fare > cash) continue;
    const bought = def.items?.[index];
    if (
      !(bought !== undefined && ignoresPrice(world, slot, bought)) &&
      !priceIsAcceptable(
        fare,
        maxItemPriceCents(world, ride, world.guests.cols.happiness[slot], index),
      )
    ) {
      overpriced = true;
      continue;
    }
    if (world.rideLines.queued[ride] + world.rideLines.approaching[ride] >= STALL_LINE_LIMIT) {
      continue;
    }
    const service = stallServiceNode(world, ride);
    if (service < 0) continue;
    const distance = tileDistance(world, tile, nodeTile(world, service));
    if (distance >= best || !isReachable(world, guestNode(world, slot, tile), service)) continue;
    best = distance;
    selected = ride;
  }
  if (selected < 0 && overpriced) recordThought(world, slot, GuestThought.BadValue);
  return selected;
}

/** Whether a guest with a few rides behind them fancies a souvenir at this step; a stable hash, not the shared PRNG. */
function feelsLikeSouvenir(world: World, slot: number): boolean {
  if (world.guests.cols.ridesTaken[slot] < SOUVENIR_MIN_RIDES) return false;
  const mix =
    Math.imul(world.guests.slotToId[slot] + 1, 0x7feb352d) ^ Math.imul(world.tick + 1, 0x846ca68b);
  return (Math.imul(mix ^ (mix >>> 16), 0x45d9f3b) >>> 8) % SOUVENIR_URGE_ONE_IN === 0;
}

/** Picks what a wandering guest heads for next: a need first, then a ride. */
function chooseDestination(world: World, slot: number, tile: number): number {
  const g = world.guests.cols;
  if (isLost(world, slot)) {
    return g.hasMap[slot] === 0
      ? nearestStall(world, slot, tile, RideType.InformationKiosk, ShopItem.Map)
      : -1;
  }
  if (g.toilet[slot] >= TOILET_SEEK) {
    const toilets = nearestStall(world, slot, tile, RideType.Toilets);
    if (toilets >= 0) return toilets;
  }
  if (
    world.weather.kind >= WeatherKind.Rain &&
    world.umbrellas[world.guests.slotToId[slot]] === 0
  ) {
    const kiosk = nearestStall(world, slot, tile, RideType.InformationKiosk, ShopItem.Umbrella);
    if (kiosk >= 0) return kiosk;
  }
  const hungry = g.hunger[slot] <= HUNGER_SEEK;
  const thirsty = g.thirst[slot] <= THIRST_SEEK;
  if (hungry || thirsty) {
    const foodFirst = hungry && (!thirsty || g.hunger[slot] <= g.thirst[slot]);
    const first = foodFirst ? 'food' : 'drink';
    const second = foodFirst ? 'drink' : 'food';
    const stall = nearestStall(world, slot, tile, first);
    if (stall >= 0) return stall;
    if (hungry && thirsty) {
      const other = nearestStall(world, slot, tile, second);
      if (other >= 0) return other;
    }
  }
  if (g.restCooldown[slot] === 0 && wantsRest(world, slot) && seekBench(world, slot, tile))
    return -1;
  if (g.activityTicks[slot] === 0) {
    if (feelsLikeSouvenir(world, slot)) {
      const stall = nearestStall(world, slot, tile, 'souvenir');
      if (stall >= 0) return stall;
    }
    return chooseRide(world, slot, tile);
  }
  return -1;
}

/** Sets a tired or nauseous guest walking to the nearest reachable bench with a free seat. */
function seekBench(world: World, slot: number, tile: number): boolean {
  const g = world.guests.cols;
  const bench = nearestFreeBench(world, tile, BENCH_SEEK_RADIUS, guestNode(world, slot, tile));
  if (bench < 0) {
    g.restCooldown[slot] = BENCH_RETRY_TICKS;
    return false;
  }
  g.benchGoal[slot] = bench + 1;
  g.patience[slot] = APPROACH_PATIENCE;
  return true;
}

function abandonBench(world: World, slot: number): void {
  const g = world.guests.cols;
  g.benchGoal[slot] = 0;
  g.restCooldown[slot] = BENCH_RETRY_TICKS;
}

/**
 * One step of a guest's walk to the bench it chose. The walk ends in a seat, or is dropped when the
 * guest no longer needs rest, the bench fills up or goes away, the way is lost or time runs out.
 */
function walkToBench(world: World, slot: number, tile: number, nav: NavOptions): void {
  const g = world.guests.cols;
  const goal = g.benchGoal[slot] - 1;
  g.patience[slot] = Math.max(0, g.patience[slot] - UPDATE_STRIDE);
  if (!wantsRest(world, slot) || g.patience[slot] === 0 || !benchHasFreeSeat(world, goal))
    return abandonBench(world, slot);
  if (tile === goal && guestNode(world, slot, tile) === tile) {
    if (!beginSitting(world, slot, tile)) abandonBench(world, slot);
    return;
  }
  if (!stepToward(world, slot, tile, goal, nav)) abandonBench(world, slot);
}

function setDestination(world: World, slot: number, ride: number): void {
  const g = world.guests.cols;
  g.targetRide[slot] = world.rides.slotToId[ride];
  g.targetX[slot] = world.rides.cols.entranceX[ride];
  g.targetY[slot] = world.rides.cols.entranceY[ride];
  g.patience[slot] = APPROACH_PATIENCE;
  g.approachGap[slot] = 0xffff;
  g.navGoal[slot] = 0;
  world.rideLines.approaching[ride]++;
}

/** A guest still getting closer to its destination is making progress, not lost. */
function noteApproachProgress(world: World, slot: number, tile: number): void {
  const g = world.guests.cols;
  const id = g.targetRide[slot];
  if (!world.rides.isAlive(id)) return;
  const approach = approachTile(world, world.rides.idToSlot[id]);
  if (approach < 0) return;
  const gap = tileDistance(world, tile, nodeTile(world, approach));
  if (gap >= g.approachGap[slot]) return;
  g.approachGap[slot] = gap;
  g.patience[slot] = APPROACH_PATIENCE;
}

function clearDestination(world: World, slot: number): void {
  world.guests.cols.targetRide[slot] = -1;
}

/** Keeps one stable guest at a blocked queue join; later arrivals turn back onto the path. */
function turnAwayFromBlockedQueue(
  world: World,
  slot: number,
  rideId: number,
  joinTile: number,
): void {
  const g = world.guests.cols;
  const guestId = world.guests.slotToId[slot];
  let earlierGuestWaiting = false;
  for (let other = 0; other < world.guests.count; other++) {
    if (
      other === slot ||
      g.state[other] !== GuestState.Wandering ||
      g.targetRide[other] !== rideId ||
      world.guests.slotToId[other]! >= guestId
    )
      continue;
    const otherTile = world.map.index(g.x[other]! >> 8, g.y[other]! >> 8);
    if (otherTile !== joinTile) continue;
    earlierGuestWaiting = true;
    break;
  }
  if (!earlierGuestWaiting) return;
  clearDestination(world, slot);
  g.activityTicks[slot] = Math.max(g.activityTicks[slot]!, 120);
  const heading = g.heading[slot]!;
  const open = world.queues.openTile[world.rides.idToSlot[rideId]!];
  const directionToQueue = directionBetween(world, joinTile, open);
  g.heading[slot] = heading <= 3 ? (heading + 2) & 3 : (directionToQueue + 2) & 3;
  moveAlongHeading(world, slot);
}

/** Prevents an approaching guest from stepping onto an occupied queue join tile. */
function joinTileHasEarlierGuest(world: World, slot: number, tile: number): boolean {
  const g = world.guests.cols;
  const guestId = world.guests.slotToId[slot];
  for (let other = 0; other < world.guests.count; other++) {
    if (
      other === slot ||
      g.state[other] === GuestState.Sitting ||
      world.guests.slotToId[other]! >= guestId
    )
      continue;
    if (world.map.index(g.x[other]! >> 8, g.y[other]! >> 8) === tile) return true;
  }
  return false;
}

/** Steps along the heading; true when the step ends on the next tile centre. */
function moveAlongHeading(world: World, slot: number): boolean {
  const g = world.guests.cols;
  const heading = g.heading[slot];
  if (heading > 3) {
    if (!atTileCentre(world, slot)) snapToTileCentre(world, slot);
    return false;
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
  g.z[slot] = world.map.heightNear(g.x[slot], g.y[slot], g.z[slot]);
  return reach === remaining;
}

/** Walks along the heading; reaching a tile centre lets the guest take in what lies on that tile. */
function walkOn(world: World, slot: number): void {
  const g = world.guests.cols;
  if (moveAlongHeading(world, slot))
    noteTileSights(world, slot, world.map.index(g.x[slot] >> 8, g.y[slot] >> 8));
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
    g.lastRide[slot] = world.rides.slotToId[ride];
    g.ridesTaken[slot] = Math.min(0xffff, g.ridesTaken[slot] + 1);
    g.nausea[slot] = Math.min(255, g.nausea[slot] + (r.nausea[ride] >> 4));
    g.happinessTarget[slot] = Math.min(
      255,
      g.happinessTarget[slot] +
        RIDE_HAPPINESS +
        Math.floor(r.excitement[ride] / EXCITEMENT_PER_HAPPINESS),
    );
    g.energy[slot] = Math.min(ENERGY_MAX, g.energy[slot] + 32);
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
  if (RIDE_CATALOG[r.typeId[ride] as RideType].items) {
    const index = chooseStallItem(world, slot, ride);
    if (index < 0) return;
    const voucherUsed = spendVoucher(
      world,
      slot,
      world.rides.slotToId[ride],
      VoucherKind.FreeFoodOrDrink,
    );
    completeSale(
      world,
      slot,
      ride,
      index,
      voucherUsed ? 0 : itemPriceCents(world, ride, index),
      voucherUsed,
    );
    return;
  }
  const voucherUsed = spendVoucher(
    world,
    slot,
    world.rides.slotToId[ride],
    VoucherKind.FreeFoodOrDrink,
  );
  const price = Math.min(voucherUsed ? 0 : r.price[ride], g.cash[slot]);
  g.cash[slot] -= price;
  g.toilet[slot] = 0;
  if (price > 0) {
    earn(world, LedgerCategory.ShopSales, price);
    addRideIncome(world, ride, price);
  }
  g.happinessTarget[slot] = Math.min(255, g.happinessTarget[slot] + SHOP_HAPPINESS);
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
  const rideId = world.rides.slotToId[ride];
  const items = RIDE_CATALOG[r.typeId[ride] as RideType].items;
  const stallIndex = !items || isThrillCategory(category) ? -1 : chooseStallItem(world, slot, ride);
  const item = stallIndex >= 0 ? items![stallIndex] : undefined;
  const price = isThrillCategory(category)
    ? guestPriceCents(world, slot, rideId, ticketPriceCents(world, ride), VoucherKind.FreeRide)
    : guestPriceCents(
        world,
        slot,
        rideId,
        item === undefined ? r.price[ride] : itemPriceCents(world, ride, stallIndex),
        VoucherKind.FreeFoodOrDrink,
      );
  const lines = world.rideLines;
  if (r.state[ride] !== RideState.Open || price > g.cash[slot] || (items && item === undefined)) {
    clearDestination(world, slot);
    return;
  }
  if (isThrillCategory(category)) {
    if (!priceIsAcceptable(price, maxRidePriceCents(world, ride))) {
      recordThought(world, slot, GuestThought.BadValue);
      clearDestination(world, slot);
      return;
    }
  } else if (price > 0) {
    if (item === undefined || !ignoresPrice(world, slot, item)) {
      const roll = toleranceRoll(world, slot, ride);
      if (
        !acceptsItemPrice(
          price,
          itemValueCents(world, ride, Math.max(0, stallIndex)),
          g.happiness[slot],
          roll,
        )
      ) {
        recordThought(world, slot, GuestThought.BadValue);
        clearDestination(world, slot);
        return;
      }
    }
  }
  if (
    item !== undefined &&
    shopItemDef(item).kind === 'souvenir' &&
    !carriesVoucherFor(world, slot, rideId, VoucherKind.FreeFoodOrDrink) &&
    !passesSouvenirRoll(world, slot, item, souvenirRoll(world, slot, ride))
  ) {
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
    g.patience[slot] = 0;
    g.queueSeq[slot] = ++r.queueSerial[ride];
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

/**
 * Drops out of a line; the guest only complains when it ran out of patience. A guest standing on
 * a queue tile turns around and walks out to the open end.
 */
function leaveQueue(world: World, slot: number, gaveUp: boolean): void {
  const g = world.guests.cols;
  const ride = targetRideSlot(world, slot);
  if (
    ride >= 0 &&
    g.state[slot] === GuestState.Waiting &&
    isThrillCategory(rideCategory(world, ride)) &&
    world.rides.cols.queueLength[ride] > 0
  ) {
    world.rides.cols.queueLength[ride]--;
  }
  if (gaveUp) {
    recordThought(world, slot, GuestThought.QueueTooLong);
    g.activityTicks[slot] = RIDE_COOLDOWN;
  }
  g.targetRide[slot] = -1;
  const tile = world.map.index(g.x[slot] >> 8, g.y[slot] >> 8);
  g.state[slot] = world.map.isQueue(tile) ? GuestState.Queuing : GuestState.Wandering;
}

/** Ticks a guest in a line waits before giving up: happier guests are more patient. */
function queuePatienceLimit(world: World, slot: number): number {
  return QUEUE_PATIENCE_BASE + world.guests.cols.happiness[slot] * QUEUE_PATIENCE_PER_HAPPINESS;
}

/** Counts a waiting guest's patience; returns true once it has run out. */
function tickQueuePatience(world: World, slot: number, guestTick: number): boolean {
  const g = world.guests.cols;
  g.patience[slot] = Math.min(0xffff, g.patience[slot] + UPDATE_STRIDE);
  if (g.patience[slot] < QUEUE_GRUMBLE_TICKS) return false;
  recordThought(world, slot, GuestThought.QueuingForAges);
  if (guestTick > 0 && guestTick % 512 === 0 && g.happiness[slot] > 0) g.happiness[slot]--;
  return g.patience[slot] >= queuePatienceLimit(world, slot);
}

/**
 * Walks a guest standing on a queue tile one step toward the line's open end and out onto the
 * ordinary path. Returns false when no step exists. The guest keeps its state.
 */
function stepOutOfQueue(world: World, slot: number, tile: number): boolean {
  const g = world.guests.cols;
  const q = world.queues;
  const map = world.map;
  const ride = q.owner[tile];
  const edges = map.pathEdges(tile);
  let dir = -1;
  if (ride >= 0 && q.openTile[ride] === tile) {
    dir = directionBetween(world, tile, q.joinTile[ride]);
  } else {
    for (let d = 0; d < 4 && dir < 0; d++) {
      if (!(edges & (1 << d))) continue;
      const next = map.neighbor(tile, d);
      if (next < 0) continue;
      if (
        ride >= 0 ? q.owner[next] === ride && q.dist[next] === q.dist[tile] + 1 : !map.isQueue(next)
      )
        dir = d;
    }
    for (let d = 0; d < 4 && dir < 0; d++) {
      if (!(edges & (1 << d))) continue;
      const next = map.neighbor(tile, d);
      if (next >= 0 && !map.isQueue(next)) dir = d;
    }
  }
  if (dir < 0) return false;
  g.heading[slot] = dir;
  moveAlongHeading(world, slot);
  return true;
}

/** Steps a guest who is leaving a line outward; it is a walker again once clear of the queue. */
function walkOutOfLine(world: World, slot: number, tile: number): void {
  if (!stepOutOfQueue(world, slot, tile)) world.guests.cols.state[slot] = GuestState.Wandering;
}

/** Joins the line at its open end, behind everyone already in it. */
function joinQueueLine(world: World, slot: number, ride: number): void {
  const g = world.guests.cols;
  const r = world.rides.cols;
  const q = world.queues;
  const rideId = world.rides.slotToId[ride];
  const price = guestPriceCents(
    world,
    slot,
    rideId,
    ticketPriceCents(world, ride),
    VoucherKind.FreeRide,
  );
  const lines = world.rideLines;
  if (r.state[ride] !== RideState.Open || price > g.cash[slot]) {
    clearDestination(world, slot);
    return;
  }
  if (!priceIsAcceptable(price, maxRidePriceCents(world, ride))) {
    recordThought(world, slot, GuestThought.BadValue);
    clearDestination(world, slot);
    return;
  }
  if (lines.queued[ride] + lines.approaching[ride] > rideQueueCapacity(world, ride)) {
    recordThought(world, slot, GuestThought.QueueTooLong);
    clearDestination(world, slot);
    return;
  }
  const open = q.openTile[ride];
  if (open < 0) return;
  if (queueEntryBlocked(world, ride)) {
    turnAwayFromBlockedQueue(world, slot, rideId, q.joinTile[ride]);
    return;
  }
  g.state[slot] = GuestState.Queuing;
  g.patience[slot] = 0;
  g.queueSeq[slot] = ++r.queueSerial[ride];
  g.heading[slot] = directionBetween(world, q.joinTile[ride], open);
  lines.approaching[ride]--;
  lines.queued[ride]++;
  g.x[slot] = (q.joinTile[ride] % world.map.width) * TILE_UNITS + TILE_CENTRE;
  g.y[slot] = Math.floor(q.joinTile[ride] / world.map.width) * TILE_UNITS + TILE_CENTRE;
  noteQueueJoin(world, ride, slot, (q.dist[open] + 1) * TILE_UNITS);
  stepAlongQueueLine(world, slot, ride, 0);
}

const linePoint = { x: 0, y: 0 };

/**
 * Walks a guest down its line toward `goal` (a line coordinate), one step at most. Returns true
 * once the guest stands at `goal`.
 */
function stepAlongQueueLine(world: World, slot: number, ride: number, goal: number): boolean {
  const g = world.guests.cols;
  const map = world.map;
  const s = queueLineCoord(world, ride, g.x[slot], g.y[slot]);
  if (s <= goal) return s === goal;
  const to = Math.max(goal, s - GUEST_SPEED);
  g.heading[slot] = queueLinePoint(
    world,
    ride,
    map.index(g.x[slot] >> 8, g.y[slot] >> 8),
    to,
    linePoint,
  );
  g.x[slot] = linePoint.x;
  g.y[slot] = linePoint.y;
  g.z[slot] = map.heightAt(linePoint.x, linePoint.y);
  return to === goal;
}

/** Walks a guest one step toward one spacing behind the guest ahead; true once it stands there. */
function followQueueLine(world: World, slot: number, ride: number): boolean {
  const q = world.queues;
  if (q.lineGuest[slot] !== world.guests.slotToId[slot]) return false;
  const ahead = q.lineAhead[slot];
  return stepAlongQueueLine(world, slot, ride, ahead < 0 ? 0 : ahead + QUEUE_SPACING);
}

/**
 * One update of a guest in a line: walk down the chain until one spacing behind the guest ahead,
 * and join the loading group once at the front.
 */
function updateQueuing(world: World, slot: number, guestTick: number): void {
  const g = world.guests.cols;
  const q = world.queues;
  const map = world.map;
  const inbound = g.targetRide[slot] >= 0;
  const ride = inbound ? targetRideSlot(world, slot) : -1;
  const gaveUp = inbound && ride >= 0 && tickQueuePatience(world, slot, guestTick);
  const tile = map.index(g.x[slot] >> 8, g.y[slot] >> 8);
  const onLine =
    ride >= 0 && (q.owner[tile] === ride || (tile === q.joinTile[ride] && q.hasQueue[ride] === 1));
  if (!onLine || world.rides.cols.state[ride] !== RideState.Open || gaveUp) {
    if (gaveUp) leaveQueue(world, slot, true);
    else g.targetRide[slot] = -1;
    if (!map.isQueue(tile)) {
      g.state[slot] = GuestState.Wandering;
      return;
    }
    if (!atTileCentre(world, slot)) {
      g.heading[slot] = queueSegmentHeading(world, g.x[slot], g.y[slot]);
      moveAlongHeading(world, slot);
      return;
    }
    walkOutOfLine(world, slot, tile);
    return;
  }
  if (!followQueueLine(world, slot, ride)) return;
  const platform = Math.max(1, world.rides.cols.capacity[ride]);
  if (q.lineRank[slot] < platform) {
    g.state[slot] = GuestState.Waiting;
    world.rides.cols.queueLength[ride]++;
  }
}

function ageNeeds(world: World, slot: number): void {
  const g = world.guests.cols;
  g.hunger[slot] = Math.max(0, g.hunger[slot] - 2);
  if (world.weather.temperature >= 21) g.thirst[slot] = Math.max(0, g.thirst[slot] - 1);
  g.toilet[slot] = Math.min(255, g.toilet[slot] + 1);
  g.nausea[slot] = Math.max(0, g.nausea[slot] - 2);
}

/** Picks one of the needs a guest currently feels and records it, as the original game does. */
function thinkAboutNeeds(world: World, slot: number): void {
  const g = world.guests.cols;
  const felt: GuestThought[] = [];
  if (g.energy[slot] <= TIRED_ENERGY && g.happiness[slot] < TIRED_HAPPINESS_CEILING)
    felt.push(GuestThought.Tired);
  if (g.hunger[slot] <= HUNGER_THOUGHT) felt.push(GuestThought.Hungry);
  if (g.thirst[slot] <= THIRST_THOUGHT) felt.push(GuestThought.Thirsty);
  if (g.toilet[slot] >= TOILET_THOUGHT) felt.push(GuestThought.NeedsToilet);
  if (g.cash[slot] < STAY_CASH && g.happiness[slot] >= 105 && g.energy[slot] >= TIRED_ENERGY)
    felt.push(GuestThought.OutOfMoney);
  if (felt.length > 0) recordThought(world, slot, felt[world.rng.int(felt.length)]);
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
  applyGuestBudget(world, slot, nav);
  const dir = nextDirection(world, guestNode(world, slot, tile), target, world.rng, nav);
  if (dir === DIR_NONE) return false;
  if (target >= 0 && !isLost(world, slot) && noteNavigation(world, slot, tile, target))
    return false;
  g.heading[slot] = dir;
  walkOn(world, slot);
  return true;
}

/** A leaving guest that cannot find the exit complains, and gets unhappier the longer it takes. */
function loseWayOut(world: World, slot: number): void {
  const g = world.guests.cols;
  recordThought(world, slot, GuestThought.Lost);
  if ((world.tick + world.guests.slotToId[slot]) % EXIT_PENALTY_TICKS === 0) {
    g.happiness[slot] = Math.max(0, g.happiness[slot] - EXIT_HAPPINESS_LOSS);
    g.happinessTarget[slot] = Math.max(0, g.happinessTarget[slot] - EXIT_HAPPINESS_LOSS);
  }
}

/**
 * Idle check for a wandering guest. One who has waited five periods without riding and has no
 * ride to choose is bored and leaves; otherwise a guest short of energy, happiness or cash leaves
 * on about one check in twenty.
 */
function decideToLeave(world: World, slot: number): boolean {
  const g = world.guests.cols;
  if (g.state[slot] !== GuestState.Wandering) return false;
  if (g.ridesTaken[slot] === 0 && g.visitTicks[slot] >= LEAVE_CHECK_TICKS) {
    const tile = world.map.index(g.x[slot] >> 8, g.y[slot] >> 8);
    const firstRide = g.targetRide[slot] >= 0 ? g.targetRide[slot] : chooseRide(world, slot, tile);
    if (firstRide < 0) {
      g.happinessTarget[slot] = Math.max(0, g.happinessTarget[slot] - 128);
      startLeaving(world, slot);
      return true;
    }
    if (g.targetRide[slot] < 0) setDestination(world, slot, firstRide);
    return false;
  }
  const settled =
    g.energy[slot] >= STAY_ENERGY &&
    g.happiness[slot] >= STAY_HAPPINESS &&
    g.cash[slot] >= STAY_CASH;
  if (settled || world.rng.int(65_536) >= LEAVE_CHANCE) return false;
  startLeaving(world, slot);
  return true;
}

function startLeaving(world: World, slot: number): void {
  const g = world.guests.cols;
  g.state[slot] = GuestState.Leaving;
  g.targetRide[slot] = -1;
  recordThought(world, slot, GuestThought.Leaving);
}

/** Returns true when the guest has left the park and should be despawned. */
function updateGuest(world: World, slot: number, nav: NavOptions): boolean {
  const g = world.guests.cols;
  updateGuestSurroundings(world, slot);
  tickLost(world, slot, UPDATE_STRIDE);
  g.visitTicks[slot] = Math.min(0x7fffffff, g.visitTicks[slot] + UPDATE_STRIDE);
  const guestTick = world.tick + world.guests.slotToId[slot];
  if (guestTick > 0 && guestTick % NEED_DECAY_TICKS === 0) {
    ageNeeds(world, slot);
  }
  if (guestTick > 0 && guestTick % IDLE_MOTIVE_TICKS === 0) {
    g.energy[slot] = Math.max(ENERGY_MIN, g.energy[slot] - 1);
    g.happinessTarget[slot] = Math.max(
      0,
      g.happinessTarget[slot] +
        (g.happinessTarget[slot] < 127 ? 1 : g.happinessTarget[slot] > 127 ? -1 : 0) -
        (g.energy[slot] <= 50 ? 2 : 0) -
        (g.hunger[slot] < 10 ? 1 : 0) -
        (g.thirst[slot] < 10 ? 1 : 0) -
        (g.toilet[slot] >= 195 ? 1 : 0),
    );
    g.happiness[slot] += Math.max(-4, Math.min(4, g.happinessTarget[slot] - g.happiness[slot]));
    if (decideToLeave(world, slot)) return false;
  }
  if (guestTick > 0 && guestTick % THOUGHT_TICKS === 0) thinkAboutNeeds(world, slot);
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
        world.rides.cols.state[ride] !== RideState.Open ||
        world.rides.cols.entrancePlaced[ride] === 0 ||
        Math.abs(world.rides.cols.entranceX[ride] - guestX) > 1 ||
        Math.abs(world.rides.cols.entranceY[ride] - guestY) > 1 ||
        guestNode(world, slot, world.map.index(guestX, guestY)) !== stallServiceNode(world, ride)
      )
        continue;
      const index = wantedItemIndex(world, slot, ride, undefined, ShopItem.Umbrella);
      if (index < 0) continue;
      const price = itemPriceCents(world, ride, index);
      if (price <= g.cash[slot]) {
        completeSale(world, slot, ride, index, price, false);
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

  if (state === GuestState.Sitting) {
    updateSitting(world, slot, guestTick);
    return false;
  }

  if (state === GuestState.Waiting) {
    const ride = targetRideSlot(world, slot);
    if (ride < 0 || world.rides.cols.state[ride] !== RideState.Open) {
      leaveQueue(world, slot, false);
    } else if (hasQueueLine(world, ride)) {
      if (tickQueuePatience(world, slot, guestTick)) leaveQueue(world, slot, true);
      else followQueueLine(world, slot, ride);
    } else if (isThrillCategory(rideCategory(world, ride))) {
      g.patience[slot] = Math.min(0xffff, g.patience[slot] + UPDATE_STRIDE);
      if (
        g.happiness[slot] <= 65 &&
        g.patience[slot] >= QUEUE_BALK_TICKS &&
        guestTick % NEED_DECAY_TICKS === 0 &&
        world.rng.int(10_000) < 330
      ) {
        leaveQueue(world, slot, true);
      }
    } else {
      g.patience[slot] = Math.max(0, g.patience[slot] - UPDATE_STRIDE);
      if (g.patience[slot] === 0) {
        leaveQueue(world, slot, true);
      } else if (world.rideLines.serving[ride] < serviceCapacity(world, ride)) {
        beginShopping(world, slot, ride);
      }
    }
    return false;
  }

  if (state === GuestState.Queuing) {
    updateQueuing(world, slot, guestTick);
    return false;
  }

  const map = world.map;
  const tile = map.index(g.x[slot] >> 8, g.y[slot] >> 8);

  if (state === GuestState.Leaving) {
    if (!atTileCentre(world, slot)) {
      walkOn(world, slot);
      return false;
    }
    const gate = parkEntranceTile(world);
    if (gate < 0 || tile === gate) return true;
    if (
      map.isQueue(tile) &&
      guestNode(world, slot, tile) === tile &&
      stepOutOfQueue(world, slot, tile)
    )
      return false;
    if (isLost(world, slot) || !stepToward(world, slot, tile, gate, nav)) {
      stepToward(world, slot, tile, -1, nav);
      loseWayOut(world, slot);
    }
    return false;
  }

  if (g.targetRide[slot] >= 0) {
    noteApproachProgress(world, slot, tile);
    g.patience[slot] = Math.max(0, g.patience[slot] - UPDATE_STRIDE);
    if (g.patience[slot] === 0) clearDestination(world, slot);
  }
  if (g.activityTicks[slot] > 0)
    g.activityTicks[slot] = Math.max(0, g.activityTicks[slot] - UPDATE_STRIDE);
  if (g.restCooldown[slot] > 0)
    g.restCooldown[slot] = Math.max(0, g.restCooldown[slot] - UPDATE_STRIDE);

  if (!atTileCentre(world, slot)) {
    walkOn(world, slot);
    return false;
  }

  if (g.container[slot] !== Container.None && useBin(world, g.x[slot] >> 8, g.y[slot] >> 8))
    g.container[slot] = Container.None;

  if (
    g.restCooldown[slot] === 0 &&
    wantsRest(world, slot) &&
    guestNode(world, slot, tile) === tile &&
    beginSitting(world, slot, tile)
  ) {
    return false;
  }
  if (g.benchGoal[slot] > 0) {
    walkToBench(world, slot, tile, nav);
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
    else if (g.benchGoal[slot] > 0) {
      walkToBench(world, slot, tile, nav);
      return false;
    }
  }

  if (ride >= 0) {
    const approach = approachTile(world, ride);
    const here = isShopCategory(rideCategory(world, ride)) ? guestNode(world, slot, tile) : tile;
    if (here === approach) {
      if (hasQueueLine(world, ride)) joinQueueLine(world, slot, ride);
      else arriveAtDestination(world, slot, ride);
      return false;
    }
    if (
      hasQueueLine(world, ride) &&
      approach === world.queues.joinTile[ride] &&
      queueEntryBlocked(world, ride) &&
      joinTileHasEarlierGuest(world, slot, approach)
    )
      return false;
    if (approach >= 0 && stepToward(world, slot, tile, approach, nav)) return false;
    clearDestination(world, slot);
  }
  if (
    map.isQueue(tile) &&
    guestNode(world, slot, tile) === tile &&
    stepOutOfQueue(world, slot, tile)
  )
    return false;
  if (noteStranded(world, slot, tile)) return true;
  stepToward(world, slot, tile, -1, nav);
  return false;
}

/** Guests the park holds comfortably: what its open rides, stalls and facilities can serve. */
function comfortableGuests(world: World): number {
  const r = world.rides.cols;
  let total = 0;
  for (let ride = 0; ride < world.rides.count; ride++) {
    if (!isServingGuests(world, ride)) continue;
    const definition = RIDE_CATALOG[r.typeId[ride] as RideType];
    total +=
      definition?.guestGenerationBonus ?? (isThrillCategory(rideCategory(world, ride)) ? 40 : 8);
  }
  return total;
}

function spawnArrival(world: World, admission: GuestAdmission): void {
  const base = 50 + Math.max(0, Math.min(650, admission.parkRating - 200));
  const campaignBps = admission.attractionBps ?? BASIS_POINTS;
  const campaign = Math.floor((base * campaignBps) / BASIS_POINTS);
  let rate =
    campaignBps === BASIS_POINTS
      ? Math.floor((campaign * (admission.awardBps ?? BASIS_POINTS)) / BASIS_POINTS)
      : campaign;
  const comfortable = comfortableGuests(world);
  const guests = world.guests.count;
  if (guests >= world.guests.capacity) return;
  if (guests > comfortable) rate = Math.floor(rate / 4);
  if (admission.entranceFee > (admission.totalRideValueForMoneyCents ?? 0)) {
    rate = Math.floor(rate / 4);
    if (Math.floor(admission.entranceFee / 2) > (admission.totalRideValueForMoneyCents ?? 0)) {
      rate = Math.floor(rate / 4);
    }
  }
  if (world.rng.int(ARRIVAL_RANDOM_RANGE) >= rate) return;
  if (!spawnGuest(world)) return;
  const slot = world.guests.count - 1;
  const guest = world.guests.cols;
  const voucher = admission.voucher ?? NO_VOUCHER;
  const fee = Math.min(gateFeeAfterVoucher(voucher.kind, admission.entranceFee), guest.cash[slot]);
  if (fee > 0) {
    guest.cash[slot] -= fee;
    earn(world, LedgerCategory.Admission, fee);
  }
  if (voucher.kind !== VoucherKind.None && !isEntryVoucher(voucher.kind) && voucher.target >= 0) {
    guest.voucherKind[slot] = voucher.kind;
    guest.voucherTarget[slot] = voucher.target;
  }
  const targetRide = admission.targetRide ?? -1;
  if (targetRide >= 0 && world.rides.isAlive(targetRide)) {
    const targetSlot = world.rides.idToSlot[targetRide];
    if (world.rides.cols.state[targetSlot] === RideState.Open)
      setDestination(world, slot, targetSlot);
  }
}

export function createGuestSystem(
  admissionProvider: GuestAdmissionProvider = admissionFromEconomy,
): System {
  const nav: NavOptions = { ...DEFAULT_GUEST_OPTS };
  return {
    name: 'guests',
    update(world) {
      refreshQueueIndex(world);
      recountRideLines(world);
      updateQueueLines(world);
      if (hasParkEntrance(world)) {
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

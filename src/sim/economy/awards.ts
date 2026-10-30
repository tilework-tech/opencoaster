import type { World } from '../core/world';
import { GuestState } from '../guests/guest-store';
import { isServingGuests } from '../rides/ride-operations';
import { RIDE_CATALOG, RideType } from '../rides/ride-types';
import type { ActiveAward, Ledger } from './ledger';

export interface AwardDefinition {
  id: number;
  name: string;
  positive: boolean;
}

/** RCT2 candidate names from the checked-in compatibility inventory; predicates are local approximations. */
export const AWARDS: readonly AwardDefinition[] = [
  { id: 0, name: 'Best Custom-Designed Rides', positive: true },
  { id: 1, name: 'Best Gentle Rides', positive: true },
  { id: 2, name: 'Best Park Food', positive: true },
  { id: 3, name: 'Best Park Toilets', positive: true },
  { id: 4, name: 'Best Park Value', positive: true },
  { id: 5, name: 'Best Roller Coasters', positive: true },
  { id: 6, name: 'Best Staff', positive: true },
  { id: 7, name: 'Best Water Rides', positive: true },
  { id: 8, name: 'Most Beautiful Park', positive: true },
  { id: 9, name: 'Most Dazzling Ride Color Schemes', positive: true },
  { id: 10, name: 'Safest Park', positive: true },
  { id: 11, name: 'Tidiest Park', positive: true },
  { id: 12, name: 'Most Confusing Park Layout', positive: false },
  { id: 13, name: 'Most Disappointing Park', positive: false },
  { id: 14, name: 'Untidiest Park', positive: false },
  { id: 15, name: 'Worst Park Food', positive: false },
  { id: 16, name: 'Worst Park Value', positive: false },
];

export const MAX_ACTIVE_AWARDS = 4;
/** Five months is reported by the RCT2/RCT1 list; another guide reports four. */
export const AWARD_DURATION_MONTHS = 5;
const MAX_NEWS = 32;
const HUNGER_SATIATION_THRESHOLD = 128;

function openRideCount(world: World, predicate: (type: RideType) => boolean): number {
  let count = 0;
  for (let slot = 0; slot < world.rides.count; slot++) {
    const type = world.rides.cols.typeId[slot] as RideType;
    if (isServingGuests(world, slot) && predicate(type)) count++;
  }
  return count;
}

function eligible(world: World, id: number): boolean {
  const l = world.economy;
  const g = world.guests.cols;
  let hungry = 0;
  let lost = 0;
  for (let slot = 0; slot < world.guests.count; slot++) {
    if (g.hunger[slot] <= HUNGER_SATIATION_THRESHOLD) hungry++;
    if (
      g.state[slot] !== GuestState.Riding &&
      !world.map.isWalkable(world.map.index(g.x[slot] >> 8, g.y[slot] >> 8))
    )
      lost++;
  }
  const food = openRideCount(world, (type) => type === RideType.FoodStall);
  const toilets = openRideCount(world, (type) => type === RideType.Toilets);
  const coasters = openRideCount(world, (type) => RIDE_CATALOG[type]?.category === 'coaster');
  const gentle = openRideCount(world, (type) => RIDE_CATALOG[type]?.category === 'gentle');
  const customRides = openRideCount(world, (type) => RIDE_CATALOG[type]?.usesTrack === true);
  const staffByKind = new Set<number>();
  for (let slot = 0; slot < world.staff.count; slot++) staffByKind.add(world.staff.cols.kind[slot]);
  const averageExcitement =
    l.inputs.openAttractionCount === 0
      ? 0
      : Math.floor(l.inputs.excitementTotal / l.inputs.openAttractionCount);
  switch (id) {
    case 0:
      return customRides >= 3 && averageExcitement >= 600;
    case 1:
      return gentle >= 10;
    case 2:
      return food >= 3 && hungry <= Math.max(2, world.guests.count / 10);
    case 3:
      return toilets >= 2 && world.guests.count <= toilets * 128;
    case 4:
      return l.parkValue >= 1_000_000;
    case 5:
      return coasters >= 6;
    case 6:
      return staffByKind.size >= 4 && world.staff.count >= 20;
    case 7:
      return openRideCount(world, (type) => RIDE_CATALOG[type]?.category === 'water') > 0;
    case 8:
      return averageExcitement >= 500 && l.parkRating >= 700;
    case 9:
      return customRides >= 3 && l.parkRating >= 700;
    case 10:
      return (
        l.inputs.qualifyingRideCount > 0 &&
        l.inputs.fatalRideCrashes === 0 &&
        l.inputs.drowningCasualties === 0 &&
        l.inputs.rideDowntimePercent < 10
      );
    case 11:
      return l.inputs.litter === 0 && lost === 0;
    case 12:
      return world.guests.count > 0 && lost * 4 >= world.guests.count;
    case 13:
      return l.parkRating < 650;
    case 14:
      return l.inputs.litter >= Math.max(10, world.guests.count / 4);
    case 15:
      return hungry > Math.max(2, world.guests.count / 4);
    case 16:
      return l.parkValue < 250_000;
    default:
      return false;
  }
}

export function evaluateMonthlyAward(world: World, tick: number): void {
  const l = world.economy;
  l.activeAwards = l.activeAwards.filter((award) => award.expiresTick > tick);
  if (l.activeAwards.length >= MAX_ACTIVE_AWARDS) return;
  const active = new Set(l.activeAwards.map((award) => award.awardId));
  const award = AWARDS.find(
    (candidate) => !active.has(candidate.id) && eligible(world, candidate.id),
  );
  if (!award) return;
  const duration = AWARD_DURATION_MONTHS * 16_384;
  l.activeAwards.push({ awardId: award.id, expiresTick: tick + duration });
  l.parkNews.push({
    tick,
    awardId: award.id,
    text: `Your park has received the ${award.name} award.`,
    positive: award.positive,
  });
  if (l.parkNews.length > MAX_NEWS) l.parkNews.splice(0, l.parkNews.length - MAX_NEWS);
}

export function awardAttractionBps(awards: readonly ActiveAward[], tick: number): number {
  let bps = 10_000;
  for (const active of awards) {
    if (active.expiresTick <= tick) continue;
    const definition = AWARDS[active.awardId];
    if (definition) bps = Math.floor((bps * (definition.positive ? 12_500 : 7_500)) / 10_000);
  }
  return bps;
}

export function liveAwards(l: Ledger, tick: number): ActiveAward[] {
  return l.activeAwards.filter((award) => award.expiresTick > tick);
}

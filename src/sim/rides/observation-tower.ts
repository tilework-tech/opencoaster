import { RidePhase } from './ride-store';

/** Height levels of towers generated before heights were chosen; these keep their appearance. */
export const DEFAULT_TOWER_HEIGHT = 11;
export const MIN_TOWER_HEIGHT = 8;
export const MAX_TOWER_HEIGHT = 64;
/** Cost of each tower section above or below the default height, in cents. */
export const TOWER_SECTION_COST = 1_800;
/** Share of a section's cost returned when it is removed, in percent. */
export const TOWER_SECTION_REFUND_PERCENT = 70;
/** Ticks the cabin takes per land level in either direction (about 1 level/s at 1x, 40 ticks/s). */
export const TOWER_TRAVEL_TICKS_PER_LEVEL = 39;
/** Ticks the cabin holds at the top so riders can look around. */
export const TOWER_VIEW_TICKS = 160;
/** Boarding and unloading dwell at the station. */
export const TOWER_LOAD_TICKS = 120;
export const TOWER_UNLOAD_TICKS = 120;
/** Values a tower saved before heights existed was created with. */
export const LEGACY_TOWER_LOAD_TICKS = 80;

/** Height of the cabin floor at the station, in levels above the tower base. */
export const TOWER_CABIN_REST_LEVEL = 0.5;
/** Gap between the top of the cabin's travel and the top of the tower, in levels. */
const CABIN_TOP_CLEARANCE = 4;
const MILLI = 1_000;

export const TOWER_CABIN_REST_MILLI = TOWER_CABIN_REST_LEVEL * MILLI;

export type ObservationTowerPart = 'base' | 'shaft' | 'top' | 'cabin';

export function isValidObservationTowerHeight(height: number): boolean {
  return Number.isInteger(height) && height >= MIN_TOWER_HEIGHT && height <= MAX_TOWER_HEIGHT;
}

/** Cash price of a tower of the given height, given the type's price at the default height. */
export function observationTowerCost(baseCost: number, height: number): number {
  return baseCost + (height - DEFAULT_TOWER_HEIGHT) * TOWER_SECTION_COST;
}

function topLevel(height: number): number {
  return height - CABIN_TOP_CLEARANCE;
}

/** Ticks of one-way travel between the station and the top. */
export function observationTowerTravelTicks(height: number): number {
  return Math.max(0, topLevel(height) - TOWER_CABIN_REST_LEVEL) * TOWER_TRAVEL_TICKS_PER_LEVEL;
}

/** Length of the Running phase: up, hold at the top, and back down. */
export function observationTowerRunTicks(height: number): number {
  return Math.round(observationTowerTravelTicks(height) * 2 + TOWER_VIEW_TICKS);
}

/** Cabin level (levels above the base) `elapsed` ticks into the Running phase. */
export function observationTowerCabinLevelAt(height: number, elapsed: number): number {
  const travel = observationTowerTravelTicks(height);
  const top = topLevel(height);
  const span = top - TOWER_CABIN_REST_LEVEL;
  if (travel === 0 || elapsed <= 0) return TOWER_CABIN_REST_LEVEL;
  if (elapsed <= travel) return TOWER_CABIN_REST_LEVEL + span * (elapsed / travel);
  if (elapsed <= travel + TOWER_VIEW_TICKS) return top;
  return Math.max(
    TOWER_CABIN_REST_LEVEL,
    top - span * ((elapsed - travel - TOWER_VIEW_TICKS) / travel),
  );
}

/** Ticks the cabin needs to descend from `milli` thousandths of a level to the station. */
export function observationTowerReturnTicks(milli: number): number {
  return Math.max(
    0,
    Math.ceil(((milli - TOWER_CABIN_REST_MILLI) / MILLI) * TOWER_TRAVEL_TICKS_PER_LEVEL),
  );
}

/**
 * Cabin height in thousandths of a level for a tower's current ride columns. Running derives it
 * from elapsed ticks; Broken keeps the stranded height in `phaseTicks`; the return trip after a
 * repair is an Unloading phase whose `phaseTicks` exceeds `unloadTicks` by the descent still to go.
 */
export function observationTowerCabinMilli(
  height: number,
  phase: number,
  phaseTicks: number,
  runTicks: number,
  unloadTicks: number,
): number {
  if (phase === RidePhase.Running)
    return Math.round(observationTowerCabinLevelAt(height, runTicks - phaseTicks) * MILLI);
  if (phase === RidePhase.Broken) return phaseTicks;
  if (phase === RidePhase.Unloading && phaseTicks > unloadTicks)
    return Math.min(
      Math.round(topLevel(height) * MILLI),
      TOWER_CABIN_REST_MILLI +
        Math.round(((phaseTicks - unloadTicks) / TOWER_TRAVEL_TICKS_PER_LEVEL) * MILLI),
    );
  return TOWER_CABIN_REST_MILLI;
}

/**
 * The reusable pieces of a tower of this height, bottom to top: a base, one shaft per level between
 * it and the top, and the top. The cabin is drawn separately at its own level.
 */
export function observationTowerParts(
  height: number,
): Array<{ part: Exclude<ObservationTowerPart, 'cabin'>; level: number }> {
  const parts: Array<{ part: Exclude<ObservationTowerPart, 'cabin'>; level: number }> = [
    { part: 'base', level: 0 },
  ];
  for (let level = 1; level < height - 3; level++) parts.push({ part: 'shaft', level });
  parts.push({ part: 'top', level: height - 3 });
  return parts;
}

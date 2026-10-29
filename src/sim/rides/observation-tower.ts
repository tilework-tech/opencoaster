import { RidePhase } from './ride-store';

/** Existing towers were generated at 10.8 height levels; this rounds to their saved appearance. */
export const DEFAULT_TOWER_HEIGHT = 11;
export const MIN_TOWER_HEIGHT = 4;
export const MAX_TOWER_HEIGHT = 120;
/** Cost of each tower segment above or below the historical tower height, in cents. */
export const TOWER_SECTION_COST = 1_800;
/** Chosen loaded-cabin travel time, close to 3.5 mph at five feet per land level. */
export const TOWER_TRAVEL_TICKS_PER_LEVEL = 39;
/** Time spent viewing the park at the top, in simulation ticks. */
export const TOWER_VIEW_TICKS = 160;
const CABIN_BOTTOM_LEVEL = 0.5;
const CABIN_TOP_CLEARANCE = 1;
const CABIN_LEVEL_SCALE = 1_000;

export function isValidObservationTowerHeight(height: number): boolean {
  return Number.isInteger(height) && height >= MIN_TOWER_HEIGHT && height <= MAX_TOWER_HEIGHT;
}

export function encodeObservationTowerCabinLevel(level: number): number {
  return Math.round(level * CABIN_LEVEL_SCALE);
}

export function decodeObservationTowerCabinLevel(encoded: number): number {
  return encoded / CABIN_LEVEL_SCALE;
}

export function observationTowerRunTicks(height: number): number {
  const distance = Math.max(0, height - CABIN_BOTTOM_LEVEL - CABIN_TOP_CLEARANCE);
  return distance * TOWER_TRAVEL_TICKS_PER_LEVEL * 2 + TOWER_VIEW_TICKS;
}

/** Cabin level at the current phase progress (0..1000); it rests at the station outside a trip. */
export function observationTowerCabinLevel(
  height: number,
  phase: RidePhase | number,
  phaseProgress: number,
): number {
  if (phase !== RidePhase.Running) return CABIN_BOTTOM_LEVEL;
  const travelTicks = Math.max(0, height - CABIN_BOTTOM_LEVEL - CABIN_TOP_CLEARANCE) *
    TOWER_TRAVEL_TICKS_PER_LEVEL;
  const runTicks = travelTicks * 2 + TOWER_VIEW_TICKS;
  const elapsedTicks = (Math.min(1000, Math.max(0, phaseProgress)) / 1000) * runTicks;
  const top = height - CABIN_TOP_CLEARANCE;
  if (elapsedTicks <= travelTicks)
    return CABIN_BOTTOM_LEVEL + (top - CABIN_BOTTOM_LEVEL) * (elapsedTicks / travelTicks);
  if (elapsedTicks <= travelTicks + TOWER_VIEW_TICKS) return top;
  return top - (top - CABIN_BOTTOM_LEVEL) * ((elapsedTicks - travelTicks - TOWER_VIEW_TICKS) / travelTicks);
}

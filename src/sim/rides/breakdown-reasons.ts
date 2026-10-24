/** Named failure families a ride can suffer. Which ones apply is a per-type table in the catalog. */
export enum BreakdownReason {
  None = 0,
  SafetyCutOut,
  RestraintsStuckClosed,
  RestraintsStuckOpen,
  DoorsStuckClosed,
  DoorsStuckOpen,
  VehicleMalfunction,
  BrakesFailure,
  ControlFailure,
}

export interface BreakdownWeight {
  reason: BreakdownReason;
  weight: number;
}

/** Mechanic work needed to clear a failure of unknown cause (a save from before reasons existed). */
const DEFAULT_REPAIR_TICKS = 240;

/**
 * Ticks a mechanic must stay at the ride to clear each failure. No public source gives repair
 * durations, so the values are OpenCoaster tuning ordered by how much there is to fix
 * (docs/DECISIONS.md).
 */
const REPAIR_TICKS: Readonly<Record<BreakdownReason, number>> = {
  [BreakdownReason.None]: DEFAULT_REPAIR_TICKS,
  [BreakdownReason.SafetyCutOut]: 200,
  [BreakdownReason.RestraintsStuckClosed]: 400,
  [BreakdownReason.RestraintsStuckOpen]: 360,
  [BreakdownReason.DoorsStuckClosed]: 400,
  [BreakdownReason.DoorsStuckOpen]: 360,
  [BreakdownReason.VehicleMalfunction]: 600,
  [BreakdownReason.BrakesFailure]: 600,
  [BreakdownReason.ControlFailure]: 480,
};

export function repairTicksFor(reason: BreakdownReason): number {
  return REPAIR_TICKS[reason] ?? DEFAULT_REPAIR_TICKS;
}

/** Failures that lock riders in their seats until a mechanic clears them. */
export function holdsRidersAboard(reason: BreakdownReason): boolean {
  return (
    reason === BreakdownReason.RestraintsStuckClosed || reason === BreakdownReason.DoorsStuckClosed
  );
}

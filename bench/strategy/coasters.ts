import { PieceMode } from '../../src/sim/track/track-types';

export type PieceStep = readonly [name: string, mode: PieceMode];

/** A closed circuit found by randomised search, laid out heading +x from its station at (0, 0). */
export interface CoasterTemplate {
  name: string;
  pieces: readonly PieceStep[];
  /** Tile extent of the circuit relative to the station: it never uses rows with negative y. */
  minX: number;
  maxX: number;
  maxY: number;
  /** Excitement in hundredths measured on a flat apron. */
  excitement: number;
}

const N = PieceMode.Normal;
const L = PieceMode.ChainLift;

/** Compact starter circuit: lifted climb, four right turns and a drop. */
export const COMPACT: CoasterTemplate = {
  name: 'compact',
  pieces: [
    ['station', N],
    ['flatToUp25', L],
    ['up25', L],
    ['up25ToFlat', L],
    ['smallRight', N],
    ['flat', N],
    ['smallRight', N],
    ['flatToDown25', N],
    ['down25', N],
    ['down25ToFlat', N],
    ['flat', N],
    ['smallRight', N],
    ['flat', N],
    ['smallRight', N],
  ],
  minX: -2,
  maxX: 5,
  maxY: 4,
  excitement: 467,
};

/** Drop, S-bend and a helix-free run of medium turns. */
export const RIVER_RUN: CoasterTemplate = {
  name: 'riverRun',
  pieces: [
    ['station', N],
    ['flatToDown25', N],
    ['down25', N],
    ['down25ToFlat', N],
    ['flat', N],
    ['smallRight', N],
    ['mediumRight', N],
    ['mediumLeft', N],
    ['smallRight', N],
    ['flatToUp25', L],
    ['up25', L],
    ['up25ToFlat', L],
    ['mediumRight', N],
    ['mediumRight', N],
    ['smallLeft', N],
    ['smallRight', N],
  ],
  minX: -6,
  maxX: 6,
  maxY: 8,
  excitement: 492,
};

/** Long figure with an early drop and two lifts. */
export const SWITCHBACK: CoasterTemplate = {
  name: 'switchback',
  pieces: [
    ['station', N],
    ['smallRight', N],
    ['flatToDown25', N],
    ['down25', N],
    ['down25', N],
    ['down25ToFlat', N],
    ['mediumRight', N],
    ['sBendLeft', N],
    ['flatToUp25', L],
    ['up25', L],
    ['up25ToFlat', L],
    ['smallRight', N],
    ['mediumRight', N],
    ['mediumLeft', N],
    ['mediumRight', N],
    ['flatToUp25', L],
    ['up25ToFlat', L],
  ],
  minX: -10,
  maxX: 2,
  maxY: 9,
  excitement: 494,
};

export const COASTER_TEMPLATES: Record<string, CoasterTemplate> = {
  compact: COMPACT,
  riverRun: RIVER_RUN,
  switchback: SWITCHBACK,
};

/** The same circuit reflected: left and right pieces swap, so it extends to negative y. */
export function mirrored(pieces: readonly PieceStep[]): PieceStep[] {
  return pieces.map(([name, mode]) => [
    name.replace(/Left|Right/g, (m) => (m === 'Left' ? 'Right' : 'Left')),
    mode,
  ]);
}

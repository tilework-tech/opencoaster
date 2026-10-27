/** Simulation ticks per second of game time at 1x speed. */
export const TICK_RATE = 40;
export const TICK_MS = 1000 / TICK_RATE;

/** Sub-tile fixed-point resolution: one tile edge is TILE_UNITS integer units. */
export const TILE_SHIFT = 8;
export const TILE_UNITS = 1 << TILE_SHIFT;
/** Vertical units per height level (same unit scale as x/y). */
export const Z_STEP = 64;
/**
 * Vertical units per track height step: half a land level, as in RCT2, where land moves in steps
 * of 16 height units and track in steps of 8. Track heights (placed piece z, piece dz) count these.
 */
export const TRACK_Z_STEP = Z_STEP / 2;
/** Track height steps per land height level. */
export const TRACK_STEPS_PER_LEVEL = Z_STEP / TRACK_Z_STEP;

export const DEFAULT_MAP_SIZE = 128;
export const MAX_GUESTS = 16384;
export const MAX_STAFF = 512;
export const MAX_VEHICLES = 4096;
export const MAX_LITTER = 8192;

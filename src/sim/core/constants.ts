/** Simulation ticks per second of game time at 1x speed. */
export const TICK_RATE = 40;
export const TICK_MS = 1000 / TICK_RATE;

/** Sub-tile fixed-point resolution: one tile edge is TILE_UNITS integer units. */
export const TILE_SHIFT = 8;
export const TILE_UNITS = 1 << TILE_SHIFT;
/** Vertical units per height level (same unit scale as x/y). */
export const Z_STEP = 64;

export const DEFAULT_MAP_SIZE = 128;
export const MAX_GUESTS = 16384;
export const MAX_STAFF = 512;
export const MAX_VEHICLES = 4096;
export const MAX_LITTER = 8192;

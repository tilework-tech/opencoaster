export type Rgb = readonly [number, number, number];

/** Shade levels per colour ramp, darkest to lightest. */
export const RAMP_LEVELS = 5;

const RAMPS: Record<string, readonly string[]> = {
  outline: ['#2a1c18'],
  asphalt: ['#4a4642', '#5c5753', '#6e6863', '#827b74', '#968e85'],
  paving: ['#7a6a58', '#8e7c67', '#a38f78', '#b8a389', '#cdb89c'],
  dirt: ['#4e3825', '#62472f', '#775739', '#8d6945', '#a37d52'],
  brick: ['#6d3a2c', '#834636', '#9a5442', '#b2644e', '#c97a5f'],
  stone: ['#6a645c', '#827b70', '#9a9285', '#b3ab9b', '#cdc5b2'],
  steel: ['#3a4048', '#505862', '#68727e', '#8591a0', '#a6b3c2'],
  white: ['#8a8a96', '#acacb6', '#cbcbd2', '#e4e2e0', '#f8f4ec'],
  red: ['#5e1a1c', '#7f2326', '#a32d2f', '#c93d38', '#e5594a'],
  orange: ['#6a3010', '#8c4414', '#b3591a', '#d97a26', '#f2a040'],
  yellow: ['#7a5c12', '#a07c18', '#c8a020', '#e8c53a', '#fbe36a'],
  green: ['#1d4a28', '#2a6335', '#3a7d42', '#53a053', '#7cc26c'],
  blue: ['#1c2f5e', '#284382', '#3659a8', '#4c76c9', '#6f9be6'],
  purple: ['#3d2257', '#55337a', '#70499c', '#8f66bd', '#b08ad8'],
  pink: ['#6e2a48', '#8f3a5c', '#b44f74', '#d46f90', '#ee94b0'],
  wood: ['#4a2e1c', '#623d25', '#7c4f2f', '#986540', '#b5804f'],
  timber: ['#7b5a38', '#96704a', '#b08a5e', '#c9a574', '#e0c28f'],
  glass: ['#1b2230', '#26344a', '#33496a', '#4a6a94', '#7ea2c8'],
  foam: ['#6f98a8', '#92b8c4', '#b4d6de', '#d6eef2', '#f2fbff'],
  skin: ['#8a5a3c', '#b07650', '#d49a72', '#efbf9a', '#ffdcc0'],
  grass: ['#2f5a24', '#3d7030', '#4f8a3c', '#64a24a', '#7fbd5e'],
};

/** Eight water colours forming one closed palette-cycle loop (ping-pong through five blues). */
const WATER_BLUES = ['#356f92', '#3a7596', '#3f7b9a', '#44819e', '#4987a2'];
export const WATER_CYCLE_LENGTH = 8;

function hex(value: string): Rgb {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const PALETTE: Rgb[] = [];
const rampIndices = new Map<string, number[]>();

function register(color: string): number {
  const rgb = hex(color);
  const existing = PALETTE.findIndex((c) => c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2]);
  if (existing >= 0) return existing;
  PALETTE.push(rgb);
  return PALETTE.length - 1;
}

for (const [name, colors] of Object.entries(RAMPS)) rampIndices.set(name, colors.map(register));

const WATER_ORDER = [0, 1, 2, 3, 4, 3, 2, 1];
const waterIndices = WATER_ORDER.map((i) => register(WATER_BLUES[i]));

/** Palette indices of a named ramp, darkest first. */
export function ramp(name: string): number[] {
  const indices = rampIndices.get(name);
  if (!indices) throw new Error(`Unknown palette ramp ${name}`);
  return indices;
}

export const OUTLINE = ramp('outline')[0];

/** Palette index shown for water cycle slot `slot` at animation `frame`. */
export function waterColor(slot: number, frame: number): number {
  return waterIndices[
    (((slot + frame) % WATER_CYCLE_LENGTH) + WATER_CYCLE_LENGTH) % WATER_CYCLE_LENGTH
  ];
}

if (PALETTE.length > 256) throw new Error('Palette exceeds 256 entries');

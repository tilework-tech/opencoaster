/** Cardinal directions. Values double as bit positions in a path edge mask. */
export const DIR_E = 0;
export const DIR_S = 1;
export const DIR_W = 2;
export const DIR_N = 3;
export const DIR_NONE = -1;

export const DIR_DX: Readonly<Int8Array> = Int8Array.of(1, 0, -1, 0);
export const DIR_DY: Readonly<Int8Array> = Int8Array.of(0, 1, 0, -1);

export function oppositeDir(d: number): number {
  return (d + 2) & 3;
}

const POPCOUNT4 = Uint8Array.of(0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4);

export function popcount4(mask: number): number {
  return POPCOUNT4[mask & 15];
}

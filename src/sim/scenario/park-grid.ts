import type { EntranceSide } from './scenario';

/** Step from the gate into the park, and the across-spine step, for each entrance side. */
const FRAME: Record<
  EntranceSide,
  { inward: readonly [number, number]; across: readonly [number, number] }
> = {
  north: { inward: [0, 1], across: [1, 0] },
  south: { inward: [0, -1], across: [1, 0] },
  east: { inward: [-1, 0], across: [0, 1] },
  west: { inward: [1, 0], across: [0, 1] },
};

/**
 * Coordinates relative to the park gate: `row` counts tiles inward along the spine path and
 * `lateral` counts tiles across it. The same layout therefore works for every entrance side.
 */
export class ParkGrid {
  private readonly inward: readonly [number, number];
  private readonly across: readonly [number, number];

  constructor(
    readonly gateX: number,
    readonly gateY: number,
    side: EntranceSide,
  ) {
    ({ inward: this.inward, across: this.across } = FRAME[side]);
  }

  tile(row: number, lateral: number): [number, number] {
    return [
      this.gateX + this.inward[0] * row + this.across[0] * lateral,
      this.gateY + this.inward[1] * row + this.across[1] * lateral,
    ];
  }

  /** Quarter turns that carry a track laid out facing +x onto this grid's +lateral heading. */
  get acrossDirection(): number {
    const [dx, dy] = this.across;
    return dx === 1 ? 0 : dy === 1 ? 1 : dx === -1 ? 2 : 3;
  }
}

/** Tiles of one ride's frontage: queue tiles, the entrance tile, exit path tiles and the ride tile. */
export interface RideFrontage {
  ride: [number, number];
  entrance: [number, number];
  queue: Array<[number, number]>;
  exit: [number, number];
  exitPath: Array<[number, number]>;
}

/**
 * A ride at `lateral` tiles from the spine on `row`: the queue runs from beside the spine to the
 * entrance on the ride's spine side, and an exit path on the row nearer the gate joins the spine.
 */
export function rideFrontage(grid: ParkGrid, row: number, lateral: number): RideFrontage {
  const sign = lateral < 0 ? -1 : 1;
  const reach = Math.abs(lateral);
  const queue: Array<[number, number]> = [];
  for (let k = 1; k < reach; k++) queue.push(grid.tile(row, sign * k));
  const exitPath: Array<[number, number]> = [];
  for (let k = 1; k <= reach; k++) exitPath.push(grid.tile(row - 1, sign * k));
  return {
    ride: grid.tile(row, lateral),
    entrance: grid.tile(row, sign * (reach - 1)),
    queue,
    exit: grid.tile(row - 1, lateral),
    exitPath,
  };
}

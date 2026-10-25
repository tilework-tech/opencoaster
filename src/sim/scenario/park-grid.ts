import { rotateTile } from '../track/construction';
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

  /** The (row, lateral) of a world tile: the inverse of `tile`. */
  locate(x: number, y: number): [number, number] {
    const dx = x - this.gateX;
    const dy = y - this.gateY;
    return [dx * this.inward[0] + dy * this.inward[1], dx * this.across[0] + dy * this.across[1]];
  }

  /** Quarter turns that carry a track laid out facing +x onto this grid's +lateral heading. */
  get acrossDirection(): number {
    const [dx, dy] = this.across;
    return dx === 1 ? 0 : dy === 1 ? 1 : dx === -1 ? 2 : 3;
  }
}

/**
 * Tiles of one ride's frontage: queue tiles, the entrance tile, exit path tiles and the ride's
 * anchor tile and orientation.
 */
export interface RideFrontage {
  ride: [number, number];
  dir: number;
  entrance: [number, number];
  queue: Array<[number, number]>;
  exit: [number, number];
  exitPath: Array<[number, number]>;
}

/**
 * A ride whose front corner (the footprint tile nearest the gate and the spine) is at `lateral`
 * tiles from the spine on `row`: the queue runs from beside the spine to the
 * entrance on the ride's spine side, and an exit path on the row nearer the gate joins the spine.
 */
export function rideFrontage(
  grid: ParkGrid,
  row: number,
  lateral: number,
  footprint: ReadonlyArray<readonly [number, number]> = [[0, 0]],
): RideFrontage {
  const sign = lateral < 0 ? -1 : 1;
  const reach = Math.abs(lateral);
  const queue: Array<[number, number]> = [];
  for (let k = 1; k < reach; k++) queue.push(grid.tile(row, sign * k));
  const exitPath: Array<[number, number]> = [];
  for (let k = 1; k <= reach; k++) exitPath.push(grid.tile(row - 1, sign * k));
  const { anchor, dir } = anchorForFrontCorner(grid, row, lateral, sign, footprint);
  return {
    ride: anchor,
    dir,
    entrance: grid.tile(row, sign * (reach - 1)),
    queue,
    exit: grid.tile(row - 1, lateral),
    exitPath,
  };
}

/**
 * Orientation and anchor that put the footprint's front corner on (`row`, `lateral`) with the
 * footprint extending away from the gate and the spine. Among the four orientations the one that
 * reaches least across the spine wins, so long rides run alongside it.
 */
function anchorForFrontCorner(
  grid: ParkGrid,
  row: number,
  lateral: number,
  sign: number,
  footprint: ReadonlyArray<readonly [number, number]>,
): { anchor: [number, number]; dir: number } {
  let best: { anchor: [number, number]; dir: number; reach: number } | null = null;
  const [originX, originY] = grid.tile(row, lateral);
  for (let dir = 0; dir < 4; dir++) {
    const cells = footprint.map(([i, j]) => rotateTile(i, j, dir));
    const grid0 = cells.map(([x, y]) => grid.locate(grid.gateX + x, grid.gateY + y));
    const minRow = Math.min(...grid0.map(([r]) => r));
    const nearLateral =
      sign > 0 ? Math.min(...grid0.map(([, l]) => l)) : Math.max(...grid0.map(([, l]) => l));
    const farLateral =
      sign > 0 ? Math.max(...grid0.map(([, l]) => l)) : Math.min(...grid0.map(([, l]) => l));
    const reach = Math.abs(farLateral - nearLateral);
    if (best && reach >= best.reach) continue;
    const corner = grid0.findIndex(([r, l]) => r === minRow && l === nearLateral);
    const [cx, cy] = cells[corner];
    best = { anchor: [originX - cx, originY - cy], dir, reach };
  }
  return {
    anchor: (best as NonNullable<typeof best>).anchor,
    dir: (best as NonNullable<typeof best>).dir,
  };
}

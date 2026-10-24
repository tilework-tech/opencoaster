/** Direction on the tile grid: 0=+x, 1=+y, 2=-x, 3=-y. */
export type Direction = 0 | 1 | 2 | 3;

/**
 * A placeable track piece definition. Geometry is sampled into integer waypoints so vehicles can
 * be advanced with integer math only. Pieces are authored originally (not copied from any game).
 */
export interface TrackPieceDef {
  id: number;
  name: string;
  entryDir: Direction;
  exitDir: Direction;
  /** Tile delta from the piece origin to the next piece origin. */
  dx: number;
  dy: number;
  /** Height delta in height levels. */
  dz: number;
  /** Sampled centre line in TILE_UNITS, relative to the piece origin: [x, y, z] triples. */
  waypoints: Int32Array;
}

export interface TrackPlacement {
  pieceId: number;
  x: number;
  y: number;
  z: number;
  dir: Direction;
}

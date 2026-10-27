export interface Tile {
  x: number;
  y: number;
}

/**
 * Tiles of a footpath drag from `from` to `to`: a straight run when both share a row or column,
 * otherwise one turn, going along x first from the start tile.
 */
export function pathRunTiles(from: Tile, to: Tile): Tile[] {
  const tiles: Tile[] = [];
  const stepX = Math.sign(to.x - from.x);
  const stepY = Math.sign(to.y - from.y);
  let x = from.x;
  let y = from.y;
  tiles.push({ x, y });
  while (x !== to.x) {
    x += stepX;
    tiles.push({ x, y });
  }
  while (y !== to.y) {
    y += stepY;
    tiles.push({ x, y });
  }
  return tiles;
}

/** Slope argument for a piece the player chose: -1 follows the ground, otherwise the rise direction. */
export function pieceSlope(dir: number, slope: PieceSlope): number {
  if (slope === 'level') return -1;
  if (slope === 'up') return dir;
  return (dir + 2) & 3;
}

export type PieceSlope = 'level' | 'up' | 'down';

const STEPS: readonly Tile[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

/** The tile one step from `tile` in direction `dir` (0 = +x, 1 = +y, 2 = -x, 3 = -y). */
export function stepCursor(tile: Tile, dir: number): Tile {
  const step = STEPS[dir & 3]!;
  return { x: tile.x + step.x, y: tile.y + step.y };
}

/** Base level for a piece entered at `entry` (the level of its entry edge), or undefined to rest on the ground. */
export function pieceBase(entry: number | null, slope: PieceSlope): number | undefined {
  if (entry === null) return undefined;
  return slope === 'down' ? entry - 1 : entry;
}

/**
 * Level of the edge a piece leaves by when travelling `travel`, given its base and the direction it
 * rises toward (-1 when flat); null when it rises sideways and so has no exit that way.
 */
export function exitLevel(base: number, rises: number, travel: number): number | null {
  if (rises < 0) return base;
  if (rises === travel) return base + 1;
  if (rises === ((travel + 2) & 3)) return base;
  return null;
}

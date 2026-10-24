import { rampMask } from './land';
import { ElementType, MAX_ELEMENT_BASE, PathFlag, SLOPE_DIR_SHIFT } from './tile-map';
import type { TileMap } from './tile-map';

/** Levels of headroom above a flat path; ramps add one for their raised end. */
export const PATH_CLEARANCE = 2;

export interface PathPlacement {
  x: number;
  y: number;
  /** Base level; defaults to the ground height of the tile. */
  z?: number;
  /** Direction (0..3) the path rises toward, for a ramp. Omit for a flat piece. */
  slope?: number;
  queue?: boolean;
}

export interface PathRemoval {
  x: number;
  y: number;
  /** Base level of the piece to remove; defaults to the lowest path in the tile. */
  z?: number;
}

export const enum PathAddition {
  None = 0,
  Bin = 1,
  Bench = 2,
}

export function setPathAddition(m: TileMap, x: number, y: number, addition: PathAddition): boolean {
  if (!m.inBounds(x, y) || !Number.isInteger(addition) || addition < 0 || addition > 2)
    return false;
  const tile = m.index(x, y);
  if (!m.canBuild(tile)) return false;
  const element = m.pathElement(tile, -1);
  if (element < 0) return false;
  m.elFlags[element] &= ~(PathFlag.Bin | PathFlag.Bench);
  m.elFlags[element] |=
    addition === PathAddition.Bin
      ? PathFlag.Bin
      : addition === PathAddition.Bench
        ? PathFlag.Bench
        : 0;
  if (addition !== PathAddition.Bin) m.elData[element] = 0;
  m.revision++;
  return true;
}

/** Height level of path element `e` along edge `dir`, or -1 when that side cannot connect. */
function edgeHeight(m: TileMap, e: number, dir: number): number {
  const s = m.pathSlopeDir(e);
  const base = m.elBase[e];
  if (s < 0) return base;
  if (dir === s) return base + 1;
  if (dir === ((s + 2) & 3)) return base;
  return -1;
}

function recomputeTileEdges(m: TileMap, i: number): void {
  for (let e = m.firstElement(i); e >= 0; e = m.nextElement(e)) {
    if (m.elType[e] !== ElementType.Path) continue;
    let edges = 0;
    for (let d = 0; d < 4; d++) {
      const h = edgeHeight(m, e, d);
      const n = h < 0 ? -1 : m.neighbor(i, d);
      if (n < 0) continue;
      const back = (d + 2) & 3;
      for (let f = m.firstElement(n); f >= 0; f = m.nextElement(f)) {
        if (m.elType[f] === ElementType.Path && edgeHeight(m, f, back) === h) {
          edges |= 1 << d;
          break;
        }
      }
    }
    m.elFlags[e] = (m.elFlags[e] & ~PathFlag.Edges) | edges;
  }
}

/** Re-derives joined-edge masks of a tile and its four neighbours. */
export function recomputePathEdges(m: TileMap, i: number): void {
  recomputeTileEdges(m, i);
  for (let d = 0; d < 4; d++) {
    const n = m.neighbor(i, d);
    if (n >= 0) recomputeTileEdges(m, n);
  }
  m.pathVersion++;
  m.revision++;
}

/**
 * Places (or replaces in place) a path piece. A piece must rest on the ground (flat on a flat
 * tile, or a ramp on a matching slope) or float at or above the tile's highest corner, must
 * not be under water, and must not overlap another element's volume.
 */
export function placePath(m: TileMap, p: PathPlacement): boolean {
  if (!m.inBounds(p.x, p.y)) return false;
  const i = m.index(p.x, p.y);
  if (!m.canBuild(i)) return false;
  const dir = p.slope ?? -1;
  if (!Number.isInteger(dir) || dir < -1 || dir > 3) return false;
  const z = p.z ?? m.heights[i];
  if (!Number.isInteger(z) || z < m.heights[i] || z > MAX_ELEMENT_BASE) return false;

  const ramp = dir >= 0;
  const top = m.heights[i] + (m.slope[i] !== 0 ? 1 : 0);
  if (z < top && !(ramp && z === m.heights[i] && m.slope[i] === rampMask(dir))) return false;
  if (m.waterLevel[i] > z) return false;

  const clear = z + PATH_CLEARANCE + (ramp ? 1 : 0);
  const existing = m.pathElement(i, z);
  for (let e = m.firstElement(i); e >= 0; e = m.nextElement(e)) {
    if (e !== existing && m.elBase[e] < clear && z < m.elClear[e]) return false;
  }

  const flags =
    (p.queue ? PathFlag.Queue : 0) | (ramp ? PathFlag.Sloped | (dir << SLOPE_DIR_SHIFT) : 0);
  const keep = PathFlag.Queue | PathFlag.Sloped | PathFlag.SlopeDir;
  if (existing >= 0) {
    if ((m.elFlags[existing] & keep) === flags && m.elClear[existing] === clear) return true;
    m.elFlags[existing] = (m.elFlags[existing] & ~keep) | flags;
    m.elClear[existing] = clear;
  } else if (m.addElement(i, ElementType.Path, z, clear, flags, 0) < 0) {
    return false;
  }
  recomputePathEdges(m, i);
  m.refreshTile(i);
  return true;
}

export function removePath(m: TileMap, p: PathRemoval): boolean {
  if (!m.inBounds(p.x, p.y)) return false;
  const i = m.index(p.x, p.y);
  if (!m.canBuild(i)) return false;
  const e = m.pathElement(i, p.z ?? -1);
  if (e < 0) return false;
  m.removeElement(i, e);
  recomputePathEdges(m, i);
  return true;
}

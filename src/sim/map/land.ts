import {
  ElementType,
  MAX_HEIGHT,
  OWNED,
  PathFlag,
  SLOPE_DIR_SHIFT,
  TERRAIN_TYPES,
} from './tile-map';
import type { TileMap } from './tile-map';

/** Largest rectangle edge accepted by a single land command. */
export const MAX_EDIT_SIZE = 64;

/** Corner mask of the two high corners of a ramp rising toward `dir`. */
export function rampMask(dir: number): number {
  return (1 << ((dir + 1) & 3)) | (1 << ((dir + 2) & 3));
}

interface Scratch {
  stamp: Int32Array;
  undoIdx: Int32Array;
  undoVal: Uint8Array;
  undoCount: number;
  op: number;
  stack: number[];
}

const scratchByMap = new WeakMap<TileMap, Scratch>();

function scratchFor(m: TileMap): Scratch {
  let s = scratchByMap.get(m);
  if (!s) {
    const n = m.vertexHeights.length;
    s = {
      stamp: new Int32Array(n),
      undoIdx: new Int32Array(n),
      undoVal: new Uint8Array(n),
      undoCount: 0,
      op: 0,
      stack: [],
    };
    scratchByMap.set(m, s);
  }
  return s;
}

function begin(m: TileMap): Scratch {
  const s = scratchFor(m);
  s.op++;
  s.undoCount = 0;
  return s;
}

function setVertex(m: TileMap, s: Scratch, v: number, value: number): void {
  if (s.stamp[v] !== s.op) {
    s.stamp[v] = s.op;
    s.undoIdx[s.undoCount] = v;
    s.undoVal[s.undoCount++] = m.vertexHeights[v];
  }
  m.vertexHeights[v] = value;
}

/**
 * Moves a vertex to `target` (only upward when `up`, else only downward) and then drags
 * neighbours (8-neighbourhood, i.e. every vertex sharing a tile) so no tile spans more than
 * one level. The closure is order-independent.
 */
function moveVertex(m: TileMap, s: Scratch, vx: number, vy: number, target: number, up: boolean) {
  const w1 = m.width + 1;
  const h1 = m.height + 1;
  const vh = m.vertexHeights;
  const t = Math.max(0, Math.min(MAX_HEIGHT, target));
  const v0 = vy * w1 + vx;
  if (up ? vh[v0] >= t : vh[v0] <= t) return;
  setVertex(m, s, v0, t);
  const stack = s.stack;
  stack.length = 0;
  stack.push(v0);
  while (stack.length > 0) {
    const u = stack.pop() as number;
    const ux = u % w1;
    const uy = (u / w1) | 0;
    const limit = up ? vh[u] - 1 : vh[u] + 1;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = uy + dy;
      if (ny < 0 || ny >= h1) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = ux + dx;
        if ((dx === 0 && dy === 0) || nx < 0 || nx >= w1) continue;
        const n = ny * w1 + nx;
        if (up ? vh[n] < limit : vh[n] > limit) {
          setVertex(m, s, n, limit);
          stack.push(n);
        }
      }
    }
  }
}

/** True when an element can coexist with the current ground of its tile. */
function elementFitsGround(m: TileMap, i: number, e: number): boolean {
  const base = m.heights[i];
  const eb = m.elBase[e];
  if (m.elType[e] === ElementType.Path) {
    const top = base + (m.slope[i] !== 0 ? 1 : 0);
    if (eb >= top) return true;
    const f = m.elFlags[e];
    return (
      eb === base &&
      (f & PathFlag.Sloped) !== 0 &&
      m.slope[i] === rampMask((f & PathFlag.SlopeDir) >> SLOPE_DIR_SHIFT)
    );
  }
  return m.elClear[e] <= base || eb >= base;
}

export function tileFitsGround(m: TileMap, i: number): boolean {
  for (let e = m.firstElement(i); e >= 0; e = m.nextElement(e)) {
    if (!elementFitsGround(m, i, e)) return false;
  }
  return true;
}

function refreshAffected(m: TileMap, s: Scratch): void {
  const w1 = m.width + 1;
  for (let k = 0; k < s.undoCount; k++) {
    const v = s.undoIdx[k];
    const vx = v % w1;
    const vy = (v / w1) | 0;
    for (let ty = vy - 1; ty <= vy; ty++) {
      for (let tx = vx - 1; tx <= vx; tx++) {
        if (m.inBounds(tx, ty)) m.refreshTile(m.index(tx, ty));
      }
    }
  }
}

/** Refreshes derived tile data; rolls the whole edit back if an element would be buried. */
function commit(m: TileMap, s: Scratch): boolean {
  if (s.undoCount === 0) return false;
  refreshAffected(m, s);
  const w1 = m.width + 1;
  for (let k = 0; k < s.undoCount; k++) {
    const v = s.undoIdx[k];
    const vx = v % w1;
    const vy = (v / w1) | 0;
    for (let ty = vy - 1; ty <= vy; ty++) {
      for (let tx = vx - 1; tx <= vx; tx++) {
        if (m.inBounds(tx, ty) && !tileFitsGround(m, m.index(tx, ty))) {
          for (let j = 0; j < s.undoCount; j++) m.vertexHeights[s.undoIdx[j]] = s.undoVal[j];
          refreshAffected(m, s);
          return false;
        }
      }
    }
  }
  return true;
}

function rectOwned(m: TileMap, x: number, y: number, w: number, h: number): boolean {
  if (w < 1 || h < 1 || w > MAX_EDIT_SIZE || h > MAX_EDIT_SIZE) return false;
  if (!m.inBounds(x, y) || !m.inBounds(x + w - 1, y + h - 1)) return false;
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if ((m.ownership[m.index(tx, ty)] & OWNED) === 0) return false;
    }
  }
  return true;
}

/** Tile corner offsets: corner `c` is at vertex (x + CORNER_DX[c], y + CORNER_DY[c]). */
const CORNER_DX = [0, 1, 1, 0];
const CORNER_DY = [0, 0, 1, 1];

function shiftLand(
  m: TileMap,
  x: number,
  y: number,
  w: number,
  h: number,
  corner: number | undefined,
  up: boolean,
): boolean {
  if (!rectOwned(m, x, y, w, h)) return false;
  const s = begin(m);
  const step = up ? 1 : -1;
  if (corner !== undefined) {
    if (w !== 1 || h !== 1 || !(corner >= 0 && corner < 4)) return false;
    const vx = x + CORNER_DX[corner];
    const vy = y + CORNER_DY[corner];
    moveVertex(m, s, vx, vy, m.vertexHeights[m.vertexIndex(vx, vy)] + step, up);
    return commit(m, s);
  }
  const targets: number[] = [];
  for (let vy = y; vy <= y + h; vy++) {
    for (let vx = x; vx <= x + w; vx++) targets.push(m.vertexHeights[m.vertexIndex(vx, vy)] + step);
  }
  let k = 0;
  for (let vy = y; vy <= y + h; vy++) {
    for (let vx = x; vx <= x + w; vx++) moveVertex(m, s, vx, vy, targets[k++], up);
  }
  return commit(m, s);
}

/** Raises a rectangle of owned tiles one level (or one corner of a single tile). */
export function raiseLand(
  m: TileMap,
  x: number,
  y: number,
  w: number,
  h: number,
  corner?: number,
): boolean {
  return shiftLand(m, x, y, w, h, corner, true);
}

export function lowerLand(
  m: TileMap,
  x: number,
  y: number,
  w: number,
  h: number,
  corner?: number,
): boolean {
  return shiftLand(m, x, y, w, h, corner, false);
}

/** Makes a tile flat at `level` (smoothing neighbours); ignores ownership. */
export function setTileHeight(m: TileMap, x: number, y: number, level: number): boolean {
  if (!m.inBounds(x, y)) return false;
  const s = begin(m);
  const t = Math.max(0, Math.min(MAX_HEIGHT, level));
  for (let pass = 0; pass < 2; pass++) {
    for (let c = 0; c < 4; c++) {
      const vx = x + CORNER_DX[c];
      const vy = y + CORNER_DY[c];
      const cur = m.vertexHeights[m.vertexIndex(vx, vy)];
      if (pass === 0 ? cur > t : cur < t) moveVertex(m, s, vx, vy, t, pass === 1);
    }
  }
  return commit(m, s);
}

/** Sets the water level over owned tiles; refuses to submerge a path. */
export function setWaterLevel(
  m: TileMap,
  x: number,
  y: number,
  w: number,
  h: number,
  level: number,
): boolean {
  if (!rectOwned(m, x, y, w, h)) return false;
  const lv = Math.max(0, Math.min(MAX_HEIGHT, level));
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      const i = m.index(tx, ty);
      for (let e = m.firstElement(i); e >= 0; e = m.nextElement(e)) {
        if (m.elType[e] === ElementType.Path && m.elBase[e] < lv) return false;
      }
    }
  }
  let changed = false;
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      const i = m.index(tx, ty);
      if (m.waterLevel[i] === lv) continue;
      m.waterLevel[i] = lv;
      m.refreshTile(i);
      changed = true;
    }
  }
  return changed;
}

/** Sets the land type (grass, sand, dirt, rock) of owned tiles. */
export function paintLand(
  m: TileMap,
  x: number,
  y: number,
  w: number,
  h: number,
  surface: number,
): boolean {
  if (!TERRAIN_TYPES.includes(surface) || !rectOwned(m, x, y, w, h)) return false;
  let changed = false;
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      const i = m.index(tx, ty);
      if (m.terrain[i] === surface) continue;
      m.terrain[i] = surface;
      m.refreshTile(i);
      changed = true;
    }
  }
  return changed;
}

/**
 * Lowers vertices until every tile spans at most one level; used after bulk edits such as
 * terrain generation. The result is the highest feasible surface below the input.
 */
export function relaxTerrain(m: TileMap): void {
  const w1 = m.width + 1;
  const h1 = m.height + 1;
  const vh = m.vertexHeights;
  let changed = true;
  while (changed) {
    changed = false;
    for (let vy = 0; vy < h1; vy++) {
      for (let vx = 0; vx < w1; vx++) {
        const v = vy * w1 + vx;
        let limit = vh[v];
        for (let dy = -1; dy <= 1; dy++) {
          const ny = vy + dy;
          if (ny < 0 || ny >= h1) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = vx + dx;
            if (nx < 0 || nx >= w1) continue;
            const l = vh[ny * w1 + nx] + 1;
            if (l < limit) limit = l;
          }
        }
        if (limit < vh[v]) {
          vh[v] = limit;
          changed = true;
        }
      }
    }
  }
  for (let i = 0; i < m.heights.length; i++) m.refreshTile(i);
}

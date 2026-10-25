import { Z_STEP } from '../core/constants';

/** Draw class of a tile's top face. Terrain types are the first four plus Dirt and Rock. */
export const enum Surface {
  Grass = 0,
  Sand = 1,
  Water = 2,
  Path = 3,
  Dirt = 4,
  Rock = 5,
  Queue = 6,
}

export const enum PathStyle {
  Tarmac = 0,
  CrazyPaving = 1,
  Dirt = 2,
}

/** Land type stored per tile; the other `Surface` values are derived (water, paths). */
export const TERRAIN_TYPES: readonly number[] = [
  Surface.Grass,
  Surface.Sand,
  Surface.Dirt,
  Surface.Rock,
];

export const enum ElementType {
  Path = 1,
  Track = 2,
  SmallScenery = 3,
  LargeScenery = 4,
  Entrance = 5,
  Wall = 6,
  Banner = 7,
}

/** Terrain vertices live in 0..MAX_HEIGHT; one level is Z_STEP fixed-point units. */
export const MAX_HEIGHT = 31;
/** Highest base level an element may be placed at. */
export const MAX_ELEMENT_BASE = 63;
/** Width in tiles of the never-buildable, never-owned outer ring. */
export const MAP_BORDER = 1;

/** Per-tile `ownership` bits. */
export const OWNED = 1;
export const RIGHTS_OWNED = 2;
export const SALE_LAND = 4;
export const SALE_RIGHTS = 8;

/** Tunable prices in cents. */
export const LAND_PRICE_CENTS = 10_000;
export const RIGHTS_PRICE_CENTS = 4_000;
/** Water terrain changes cost $2.50 per affected tile and height action. */
export const WATER_TILE_ACTION_COST_CENTS = 250;
/** Surface painting has no supported source price in the clean-room spec; keep it free. */
export const LAND_SURFACE_COST_CENTS = 0;
export const PATH_COST_CENTS = 1_000;

/** Edge directions: 0 = +x, 1 = +y, 2 = -x, 3 = -y. An edge mask has bit `1 << dir`. */
export const DIR_DX: Readonly<Int8Array> = Int8Array.of(1, 0, -1, 0);
export const DIR_DY: Readonly<Int8Array> = Int8Array.of(0, 1, 0, -1);

/** Layout of `elFlags` for `ElementType.Path` elements. */
export const enum PathFlag {
  /** Edges joined to an adjacent path piece (derived; maintained by the map). */
  Edges = 0x0f,
  /** Edges joined to a non-path neighbour (ride entrances); bit `4 + dir`. */
  Forced = 0xf0,
  Queue = 0x100,
  /** Ramp rising one level toward `SlopeDir`. */
  Sloped = 0x200,
  SlopeDir = 0xc00,
  Bin = 0x1000,
  Bench = 0x2000,
  /** Covers guests standing on or beside it from rain. */
  Shelter = 0x4000,
  Lamp = 0x8000,
}
/** High payload bit marks a broken path addition without destroying its contents. */
export const PATH_ADDITION_BROKEN = 0x40000000;

export function isPathElementBroken(map: TileMap, element: number): boolean {
  return element >= 0 && (map.elData[element] & PATH_ADDITION_BROKEN) !== 0;
}

export function markPathElementBroken(map: TileMap, element: number): void {
  if (element < 0) return;
  map.elData[element] |= PATH_ADDITION_BROKEN;
  map.revision++;
}

export function repairPathElement(map: TileMap, element: number): void {
  if (element < 0 || !isPathElementBroken(map, element)) return;
  map.elData[element] = 0;
  map.revision++;
}
export const SLOPE_DIR_SHIFT = 10;

const META_FREE = 0;
const META_HIGH = 1;
const META_COUNT = 2;

/**
 * Tile-element-stack map.
 *
 * Terrain is a (width+1) x (height+1) grid of corner heights, so neighbouring tiles share
 * corners by construction. `heights` (lowest corner) and `slope` (bit `c` set when corner `c`
 * is one level above that, corners ordered (x,y), (x+1,y), (x+1,y+1), (x,y+1)) are derived per
 * tile by `refreshTile`. Everything above the ground (paths, track, scenery, ...) is an element
 * in a pooled, per-tile linked list sorted by base height. Pool capacity is fixed.
 */
export class TileMap {
  readonly vertexHeights: Uint8Array;
  readonly heights: Uint8Array;
  readonly slope: Uint8Array;
  /** Land type chosen by the player or generator. */
  readonly terrain: Uint8Array;
  /** Derived draw class of the top face (`Surface`). */
  readonly surface: Uint8Array;
  /** Water surface level; water covers the tile where it exceeds `heights`. 0 = none. */
  readonly waterLevel: Uint8Array;
  /** `OWNED | RIGHTS_OWNED | SALE_LAND | SALE_RIGHTS`. */
  readonly ownership: Uint8Array;
  /** Per-tile bitfield; bit meanings are owned by the module that sets them (see map/docs.md). */
  readonly flags: Uint8Array;

  readonly tileHead: Int32Array;
  readonly elType: Uint8Array;
  readonly elBase: Uint8Array;
  /** Exclusive top level of the element's occupied volume. */
  readonly elClear: Uint8Array;
  readonly elFlags: Uint16Array;
  /** Type-specific payload (e.g. owning ride id). */
  readonly elData: Int32Array;
  readonly elNext: Int32Array;
  /** Selected paving style per element; non-path elements keep zero. */
  readonly pathStyle: Uint8Array;
  private readonly meta: Int32Array;

  /** Bumped by every change a renderer could see; not part of saved state. */
  revision = 0;
  /** Bumped whenever a path element or its edges change; lets the pathfinder drop caches. */
  pathVersion = 0;

  readonly elementCapacity: number;

  constructor(
    readonly width: number,
    readonly height: number,
    elementCapacity = Math.max(64, width * height * 2),
  ) {
    const tiles = width * height;
    this.vertexHeights = new Uint8Array((width + 1) * (height + 1));
    this.heights = new Uint8Array(tiles);
    this.slope = new Uint8Array(tiles);
    this.terrain = new Uint8Array(tiles);
    this.surface = new Uint8Array(tiles);
    this.waterLevel = new Uint8Array(tiles);
    this.ownership = new Uint8Array(tiles);
    this.flags = new Uint8Array(tiles);
    this.tileHead = new Int32Array(tiles).fill(-1);
    this.elementCapacity = elementCapacity;
    this.elType = new Uint8Array(elementCapacity);
    this.elBase = new Uint8Array(elementCapacity);
    this.elClear = new Uint8Array(elementCapacity);
    this.elFlags = new Uint16Array(elementCapacity);
    this.elData = new Int32Array(elementCapacity);
    this.elNext = new Int32Array(elementCapacity);
    this.pathStyle = new Uint8Array(elementCapacity);
    this.meta = Int32Array.of(-1, 0, 0);
  }

  /** Every array that makes up saved/hashed state. */
  arrays(): ArrayBufferView[] {
    return [
      this.vertexHeights,
      this.heights,
      this.slope,
      this.terrain,
      this.surface,
      this.waterLevel,
      this.ownership,
      this.flags,
      this.tileHead,
      this.elType,
      this.elBase,
      this.elClear,
      this.elFlags,
      this.elData,
      this.elNext,
      this.meta,
      this.pathStyle,
    ];
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Tile index of the neighbour in `dir`, or -1 off the map. */
  neighbor(i: number, dir: number): number {
    const x = (i % this.width) + DIR_DX[dir];
    const y = ((i / this.width) | 0) + DIR_DY[dir];
    return x < 0 || y < 0 || x >= this.width || y >= this.height ? -1 : y * this.width + x;
  }

  vertexIndex(vx: number, vy: number): number {
    return vy * (this.width + 1) + vx;
  }

  /** Height level of one of a tile's four corners. */
  cornerHeight(x: number, y: number, corner: number): number {
    const vx = x + (corner === 1 || corner === 2 ? 1 : 0);
    const vy = y + (corner >= 2 ? 1 : 0);
    return this.vertexHeights[this.vertexIndex(vx, vy)];
  }

  /** Sets every vertex to `level` and resets derived data; for fresh maps and tests. */
  fillFlat(level: number): void {
    this.vertexHeights.fill(level);
    for (let i = 0; i < this.heights.length; i++) this.refreshTile(i);
  }

  /** Recomputes `heights`, `slope` and `surface` of a tile from its corners and elements. */
  refreshTile(i: number): void {
    const w1 = this.width + 1;
    const v = this.vertexHeights;
    const o = ((i / this.width) | 0) * w1 + (i % this.width);
    const c0 = v[o];
    const c1 = v[o + 1];
    const c2 = v[o + 1 + w1];
    const c3 = v[o + w1];
    let base = c0;
    if (c1 < base) base = c1;
    if (c2 < base) base = c2;
    if (c3 < base) base = c3;
    this.heights[i] = base;
    this.slope[i] =
      (c0 > base ? 1 : 0) | (c1 > base ? 2 : 0) | (c2 > base ? 4 : 0) | (c3 > base ? 8 : 0);
    this.surface[i] = this.deriveSurface(i);
    this.revision++;
  }

  private deriveSurface(i: number): number {
    const base = this.heights[i];
    for (let e = this.tileHead[i]; e >= 0; e = this.elNext[e]) {
      if (this.elType[e] === ElementType.Path && this.elBase[e] === base) {
        return this.elFlags[e] & PathFlag.Queue ? Surface.Queue : Surface.Path;
      }
    }
    return this.waterLevel[i] > base ? Surface.Water : this.terrain[i];
  }

  // ---- element stacks ----

  get elementCount(): number {
    return this.meta[META_COUNT];
  }

  firstElement(i: number): number {
    return this.tileHead[i];
  }

  nextElement(e: number): number {
    return this.elNext[e];
  }

  /** Inserts an element into a tile's stack (after equal bases). Returns -1 if the pool is full. */
  addElement(
    i: number,
    type: ElementType,
    base: number,
    clear: number,
    flags: number,
    data: number,
  ): number {
    const meta = this.meta;
    let e: number;
    if (meta[META_FREE] >= 0) {
      e = meta[META_FREE];
      meta[META_FREE] = this.elNext[e];
    } else if (meta[META_HIGH] < this.elementCapacity) {
      e = meta[META_HIGH]++;
    } else {
      return -1;
    }
    this.elType[e] = type;
    this.elBase[e] = base;
    this.elClear[e] = clear;
    this.elFlags[e] = flags;
    this.elData[e] = data;
    this.pathStyle[e] = PathStyle.Tarmac;
    let prev = -1;
    let cur = this.tileHead[i];
    while (cur >= 0 && this.elBase[cur] <= base) {
      prev = cur;
      cur = this.elNext[cur];
    }
    this.elNext[e] = cur;
    if (prev < 0) this.tileHead[i] = e;
    else this.elNext[prev] = e;
    meta[META_COUNT]++;
    if (type === ElementType.Path) this.pathVersion++;
    this.refreshTile(i);
    return e;
  }

  removeElement(i: number, e: number): void {
    let prev = -1;
    let cur = this.tileHead[i];
    while (cur >= 0 && cur !== e) {
      prev = cur;
      cur = this.elNext[cur];
    }
    if (cur < 0) return;
    if (prev < 0) this.tileHead[i] = this.elNext[e];
    else this.elNext[prev] = this.elNext[e];
    if (this.elType[e] === ElementType.Path) this.pathVersion++;
    this.elType[e] = 0;
    this.elNext[e] = this.meta[META_FREE];
    this.meta[META_FREE] = e;
    this.meta[META_COUNT]--;
    this.refreshTile(i);
  }

  // ---- path queries (allocation-free) ----

  /** Path element with base level `z` in the tile (any path, lowest first, when `z < 0`), else -1. */
  pathElement(i: number, z: number): number {
    for (let e = this.tileHead[i]; e >= 0; e = this.elNext[e]) {
      if (this.elType[e] === ElementType.Path && (z < 0 || this.elBase[e] === z)) return e;
    }
    return -1;
  }

  /** True when the tile has at least one path element. */
  isWalkable(i: number): boolean {
    return this.pathElement(i, -1) >= 0;
  }

  isQueue(i: number): boolean {
    const e = this.pathElement(i, -1);
    return e >= 0 && (this.elFlags[e] & PathFlag.Queue) !== 0;
  }

  /** Edge mask (bit `1 << dir`) of one path element: joined paths plus forced connections. */
  pathEdgesOf(e: number): number {
    const f = this.elFlags[e];
    return (f & PathFlag.Edges) | ((f & PathFlag.Forced) >> 4);
  }

  /** Edge mask of the tile's lowest path element; 0 when there is no path. */
  pathEdges(i: number): number {
    const e = this.pathElement(i, -1);
    return e < 0 ? 0 : this.pathEdgesOf(e);
  }

  /** `PathGraph` view for the pathfinder: the tile's lowest path element's edges. */
  edgeMask(i: number): number {
    return this.pathEdges(i);
  }

  /** Marks edges of a path element as connected to something that is not a path. */
  setForcedEdges(e: number, mask: number): void {
    this.elFlags[e] = (this.elFlags[e] & ~PathFlag.Forced) | ((mask & 0xf) << 4);
    this.pathVersion++;
    this.revision++;
  }

  /** Slope direction of a sloped path element, or -1 when flat. */
  pathSlopeDir(e: number): number {
    const f = this.elFlags[e];
    return f & PathFlag.Sloped ? (f & PathFlag.SlopeDir) >> SLOPE_DIR_SHIFT : -1;
  }

  // ---- height queries ----

  /** Ground height in Z units at a fixed-point position (clamped to the map). */
  terrainHeightAt(xu: number, yu: number): number {
    const maxX = (this.width << 8) - 1;
    const maxY = (this.height << 8) - 1;
    const px = xu < 0 ? 0 : xu > maxX ? maxX : xu;
    const py = yu < 0 ? 0 : yu > maxY ? maxY : yu;
    const fx = px & 255;
    const fy = py & 255;
    const o = (py >> 8) * (this.width + 1) + (px >> 8);
    const v = this.vertexHeights;
    const w1 = this.width + 1;
    const top = v[o] * (256 - fx) + v[o + 1] * fx;
    const bottom = v[o + w1] * (256 - fx) + v[o + w1 + 1] * fx;
    return ((top * (256 - fy) + bottom * fy) * Z_STEP) >> 16;
  }

  /** Z units of path element `e` at a fixed-point position inside its tile. */
  pathHeightAt(e: number, xu: number, yu: number): number {
    const base = this.elBase[e] * Z_STEP;
    switch (this.pathSlopeDir(e)) {
      case 0:
        return base + (((xu & 255) * Z_STEP) >> 8);
      case 1:
        return base + (((yu & 255) * Z_STEP) >> 8);
      case 2:
        return base + (((256 - (xu & 255)) * Z_STEP) >> 8);
      case 3:
        return base + (((256 - (yu & 255)) * Z_STEP) >> 8);
      default:
        return base;
    }
  }

  /** Walking-surface height in Z units: the tile's lowest path if any, else the ground. */
  heightAt(xu: number, yu: number): number {
    const maxX = (this.width << 8) - 1;
    const maxY = (this.height << 8) - 1;
    const px = xu < 0 ? 0 : xu > maxX ? maxX : xu;
    const py = yu < 0 ? 0 : yu > maxY ? maxY : yu;
    const e = this.pathElement((py >> 8) * this.width + (px >> 8), -1);
    return e < 0 ? this.terrainHeightAt(px, py) : this.pathHeightAt(e, px, py);
  }

  /** True when the tile's owner may build on it (land or construction rights). */
  canBuild(i: number): boolean {
    return (this.ownership[i] & (OWNED | RIGHTS_OWNED)) !== 0;
  }
}

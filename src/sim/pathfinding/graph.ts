import type { TileMap } from '../map/tile-map';
import { Surface } from '../map/tile-map';

/**
 * The footpath graph as the pathfinder sees it. Tiles are row-major (`y * width + x`). Edges must
 * be symmetric: if tile A exposes an exit towards B, B exposes the opposite exit towards A.
 */
export interface PathGraph {
  readonly width: number;
  readonly height: number;
  /** Bumped whenever any path tile or edge changes; cached derived data is rebuilt when it moves. */
  readonly pathVersion: number;
  /** Bits 0..3 = open exits E, S, W, N (see directions.ts). 0 for non-path tiles. */
  edgeMask(tile: number): number;
}

const versions = new WeakMap<object, number>();

/** Map editors call this after adding, removing or reshaping any path tile. */
export function markPathsChanged(map: object): void {
  versions.set(map, (versions.get(map) ?? 0) + 1);
}

/** Adapts a `TileMap` whose `Surface.Path` tiles connect to their four path neighbours. */
export class TileMapPathGraph implements PathGraph {
  readonly width: number;
  readonly height: number;

  constructor(private readonly map: TileMap) {
    this.width = map.width;
    this.height = map.height;
  }

  get pathVersion(): number {
    return versions.get(this.map) ?? 0;
  }

  edgeMask(i: number): number {
    const s = this.map.surface;
    if (s[i] !== Surface.Path) return 0;
    const w = this.width;
    const x = i % w;
    const y = (i / w) | 0;
    let m = 0;
    if (x + 1 < w && s[i + 1] === Surface.Path) m |= 1;
    if (y + 1 < this.height && s[i + w] === Surface.Path) m |= 2;
    if (x > 0 && s[i - 1] === Surface.Path) m |= 4;
    if (y > 0 && s[i - w] === Surface.Path) m |= 8;
    return m;
  }
}

const adapters = new WeakMap<TileMap, TileMapPathGraph>();

/** Anything with a `map` that is either a `PathGraph` or a `TileMap`. */
export interface PathWorld {
  readonly map: PathGraph | TileMap;
}

export function resolveGraph(map: PathGraph | TileMap): PathGraph {
  if ('edgeMask' in map) return map;
  let g = adapters.get(map);
  if (!g) {
    g = new TileMapPathGraph(map);
    adapters.set(map, g);
  }
  return g;
}

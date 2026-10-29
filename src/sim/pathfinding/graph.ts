import type { TileMap } from '../map/tile-map';
import { ElementType, Surface } from '../map/tile-map';
import { DIR_DX, DIR_DY } from './directions';
import { isWallScenery, type SceneryItem } from '../map/scenery';

/**
 * The footpath graph as the pathfinder sees it. Tiles are row-major (`y * width + x`); layered
 * graphs include the layer in each node ID. Edge masks describe exits from that node and may be
 * directional, as with ride exits.
 */
export interface PathGraph {
  readonly width: number;
  readonly height: number;
  /** Bumped whenever any path tile or edge changes; cached derived data is rebuilt when it moves. */
  readonly pathVersion: number;
  /** Bits 0..3 = open exits E, S, W, N (see directions.ts); 0 for nodes without a path. */
  edgeMask(node: number): number;
  /**
   * Number of nodes. A graph with stacked layers (bridges) numbers a node `layer * tiles + tile`;
   * without it every tile is one node.
   */
  readonly nodeCount?: number;
  /** The node an exit of `node` leads to; without it a step moves to the adjacent tile. */
  step?(node: number, dir: number): number;
}

/** Nodes in `graph`: one per tile unless it stacks layers. */
export function nodeCount(graph: PathGraph): number {
  return graph.nodeCount ?? graph.width * graph.height;
}

/** The node reached by leaving `node` through exit `dir`. */
export function stepNode(graph: PathGraph, node: number, dir: number): number {
  return graph.step ? graph.step(node, dir) : node + DIR_DX[dir] + DIR_DY[dir] * graph.width;
}

/** Tile index of a node. */
export function nodeTile(graph: PathGraph, node: number): number {
  return node % (graph.width * graph.height);
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
    if (x + 1 < w && s[i + 1] === Surface.Path && !wallBlocks(this.map, i, 0)) m |= 1;
    if (y + 1 < this.height && s[i + w] === Surface.Path && !wallBlocks(this.map, i, 1)) m |= 2;
    if (x > 0 && s[i - 1] === Surface.Path && !wallBlocks(this.map, i, 2)) m |= 4;
    if (y > 0 && s[i - w] === Surface.Path && !wallBlocks(this.map, i, 3)) m |= 8;
    return m;
  }
}

function wallBlocks(map: TileMap, tile: number, direction: number): boolean {
  const neighbor = map.neighbor(tile, direction);
  const hasWall = (at: number, edge: number): boolean => {
    for (let element = map.firstElement(at); element >= 0; element = map.nextElement(element)) {
      if (
        map.elType[element] === ElementType.SmallScenery &&
        isWallScenery(map.elData[element] as SceneryItem) &&
        map.elFlags[element] === edge
      )
        return true;
    }
    return false;
  };
  return hasWall(tile, direction) || (neighbor >= 0 && hasWall(neighbor, (direction + 2) & 3));
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

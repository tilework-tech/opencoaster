import { describe, expect, it } from 'vitest';
import { TILE_UNITS, Z_STEP } from '../core/constants';
import type { World } from '../core/world';
import { flatWorld, layPath, row } from '../integration/fixtures';
import { placePath } from '../map';
import { GuestState, spawnGuest } from './guest-store';
import { guestSystem } from './guest-system';
import { setParkEntrance } from './park';
import { DIR_NONE, nextDirection, isReachable } from '../pathfinding';

const GROUND = 4;
const BRIDGE = 6;

/** A path along y=10 and a bridge over it along x=9: two ramps up, a level span, two ramps down. */
function bridgeWorld(): World {
  const w = flatWorld();
  layPath(w, row(10, 2, 16));
  layPath(w, [[9, 5]]);
  const m = w.map;
  const pieces: Array<[number, number, number, number]> = [
    [9, 6, GROUND, 1],
    [9, 7, GROUND + 1, 1],
    [9, 8, BRIDGE, -1],
    [9, 9, BRIDGE, -1],
    [9, 10, BRIDGE, -1],
    [9, 11, BRIDGE, -1],
    [9, 12, BRIDGE, -1],
    [9, 13, GROUND + 1, 3],
    [9, 14, GROUND, 3],
  ];
  for (const [x, y, z, slope] of pieces)
    if (!placePath(m, { x, y, z, slope })) throw new Error(`bridge piece ${x},${y}`);
  return w;
}

function walkNodes(w: World, from: number, target: number): number[] {
  const m = w.map;
  const nodes = [from];
  let node = from;
  for (let i = 0; i < 200 && node % (m.width * m.height) !== target; i++) {
    const dir = nextDirection(w, node, target, w.rng);
    if (dir === DIR_NONE) break;
    node = m.step(node, dir);
    nodes.push(node);
  }
  return nodes;
}

describe('a bridge over a footpath', () => {
  it('is its own set of walk nodes, joined to the ground by ramps at its ends only', () => {
    const w = bridgeWorld();
    const m = w.map;
    const tiles = m.width * m.height;
    const under = m.index(9, 10);
    expect(m.walkNode(under, GROUND * Z_STEP)).toBe(under);
    expect(m.walkNode(under, BRIDGE * Z_STEP)).toBe(under + tiles);
    expect(isReachable(w, m.index(9, 5), m.index(9, 14))).toBe(true);
    expect(isReachable(w, m.index(9, 5), m.index(2, 10))).toBe(false);
  });

  it('is walked over on the way from one end to the other', () => {
    const w = bridgeWorld();
    const m = w.map;
    const tiles = m.width * m.height;
    const route = walkNodes(w, m.index(9, 5), m.index(9, 14));
    expect(route[route.length - 1]).toBe(m.index(9, 14));
    expect(route).toContain(m.index(9, 10) + tiles);
    expect(route).not.toContain(m.index(9, 10));
  });

  it('leaves the path beneath it walkable', () => {
    const w = bridgeWorld();
    const m = w.map;
    const route = walkNodes(w, m.index(2, 10), m.index(16, 10));
    expect(route[route.length - 1]).toBe(m.index(16, 10));
    expect(route).toContain(m.index(9, 10));
  });

  it('carries a guest over the bridge at the bridge height', () => {
    const w = bridgeWorld();
    setParkEntrance(w, 9, 14);
    expect(spawnGuest(w)).toBe(true);
    const g = w.guests.cols;
    g.x[0] = 9 * TILE_UNITS + TILE_UNITS / 2;
    g.y[0] = 5 * TILE_UNITS + TILE_UNITS / 2;
    g.z[0] = w.map.heightAt(g.x[0], g.y[0]);
    g.state[0] = GuestState.Leaving;
    const heightsOnBridgeTile: number[] = [];
    for (let i = 0; i < 4000 && w.guests.count > 0; i++) {
      guestSystem.update(w);
      w.tick++;
      if (w.guests.count > 0 && g.y[0] >> 8 === 10 && g.x[0] >> 8 === 9)
        heightsOnBridgeTile.push(g.z[0]);
    }
    expect(heightsOnBridgeTile.length).toBeGreaterThan(0);
    expect(Math.min(...heightsOnBridgeTile)).toBe(BRIDGE * Z_STEP);
  });

  it('carries a guest along the path under the bridge at ground height', () => {
    const w = bridgeWorld();
    setParkEntrance(w, 16, 10);
    expect(spawnGuest(w)).toBe(true);
    const g = w.guests.cols;
    g.x[0] = 2 * TILE_UNITS + TILE_UNITS / 2;
    g.y[0] = 10 * TILE_UNITS + TILE_UNITS / 2;
    g.z[0] = w.map.heightAt(g.x[0], g.y[0]);
    g.state[0] = GuestState.Leaving;
    const heightsUnderBridge: number[] = [];
    for (let i = 0; i < 4000 && w.guests.count > 0; i++) {
      guestSystem.update(w);
      w.tick++;
      if (w.guests.count > 0 && g.y[0] >> 8 === 10 && g.x[0] >> 8 === 9)
        heightsUnderBridge.push(g.z[0]);
    }
    expect(heightsUnderBridge.length).toBeGreaterThan(0);
    expect(Math.max(...heightsUnderBridge)).toBe(GROUND * Z_STEP);
  });
});

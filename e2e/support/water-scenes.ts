import type { World } from '../../src/sim/core/world';
import { LandAction, applyLand } from '../../src/sim/map/land-tool';
import { OWNED } from '../../src/sim/map/tile-map';
import { placePath } from '../../src/sim/map/paths';
import { placeScenery, SceneryItem } from '../../src/sim/map/scenery';
import { starterWorld } from './park';

export interface WaterScene {
  name: string;
  /** Top-left tile of the water selection and its side length. */
  target: { x: number; y: number };
  size: number;
  /** Water tool clicks to make, as `raise` or `lower`. */
  clicks: Array<'raise' | 'lower'>;
}

const PLATEAU = 4;

function dig(w: World, x: number, y: number, size: number, steps: number): void {
  for (let i = 0; i < steps; i++)
    applyLand(w, { action: LandAction.Lower, x, y, width: size, height: size });
}

/**
 * Starter Park with a flat, owned, empty plateau at level 4 over x 40..62, y 4..30 and a handful
 * of staged terrain shapes on it. Every scene is a separate spot of the same save.
 */
export function waterWorld(): { world: World; scenes: WaterScene[] } {
  const world = starterWorld();
  const m = world.map;
  world.economy.cash = 100_000_000;
  for (let vy = 3; vy <= 31; vy++)
    for (let vx = 39; vx <= 63; vx++) m.vertexHeights[m.vertexIndex(vx, vy)] = PLATEAU;
  for (let y = 4; y < 31; y++)
    for (let x = 40; x < 64; x++) {
      const i = m.index(x, y);
      m.waterLevel[i] = 0;
      m.ownership[i] |= OWNED;
      for (let e = m.firstElement(i); e >= 0; e = m.firstElement(i)) m.removeElement(i, e);
      m.refreshTile(i);
    }
  // dip: 3x3 pit two steps deep
  dig(world, 50, 8, 3, 2);
  // lake: 5x5 pit already holding water to a depth of one step, selection beside it
  dig(world, 42, 16, 5, 2);
  for (let y = 15; y <= 21; y++)
    for (let x = 41; x <= 47; x++) {
      const i = m.index(x, y);
      if (m.heights[i] <= 2) m.waterLevel[i] = 3;
    }
  // slope: a ramp rising to the east
  for (let k = 0; k < 3; k++) {
    for (let y = 18; y <= 22; y++)
      for (let x = 53 + k * 2; x <= 60; x++) m.vertexHeights[m.vertexIndex(x, y)] += 1;
  }
  for (let i = 0; i < m.heights.length; i++) m.refreshTile(i);
  // shore: a pit ringed by a footpath, a tree row and a conifer cluster just outside its banks
  dig(world, 58, 7, 3, 2);
  for (let x = 55; x <= 62; x++) placePath(m, { x, y: 12 });
  for (let y = 5; y <= 11; y++) placePath(m, { x: 55, y });
  for (const y of [6, 8, 10]) placeScenery(m, 54, y, SceneryItem.OakTree);
  for (const x of [57, 59, 61]) placeScenery(m, x, 13, SceneryItem.Conifer);
  // edge: pit touching the east map edge
  dig(world, 61, 24, 3, 2);
  return {
    world,
    scenes: [
      { name: 'flat', target: { x: 44, y: 8 }, size: 3, clicks: ['raise', 'raise', 'lower'] },
      { name: 'dip', target: { x: 50, y: 8 }, size: 3, clicks: ['raise', 'raise', 'raise'] },
      {
        name: 'lake',
        target: { x: 48, y: 18 },
        size: 3,
        clicks: ['raise', 'raise', 'lower', 'lower'],
      },
      {
        name: 'shore',
        target: { x: 58, y: 7 },
        size: 3,
        clicks: ['raise', 'raise', 'raise', 'lower'],
      },
      { name: 'slope', target: { x: 57, y: 20 }, size: 3, clicks: ['raise', 'raise'] },
      { name: 'edge', target: { x: 61, y: 24 }, size: 3, clicks: ['raise', 'raise'] },
    ],
  };
}

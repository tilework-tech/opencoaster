import type { World } from '../core/world';
import { SEA_LEVEL } from '../map/terrain';
import { RIDE_CATALOG } from '../rides/ride-types';
import { INWARD, layOutApproach, levelTiles } from './park-approach';
import { layOutEntrance } from './scenario-layout';
import type { EntranceSide, ScenarioEntrance } from './scenario';

/** Sandbox parks open on the south edge with a short entrance path, like a stock RCT2 park. */
export const SANDBOX_ENTRANCE: ScenarioEntrance = { side: 'south', length: 6 };

/** The sandbox owns the central half of the map, matching `generateTerrain`. */
function sandboxOwned(world: World) {
  const mx = world.map.width >> 2;
  const my = world.map.height >> 2;
  return { x0: mx, y0: my, x1: world.map.width - mx - 1, y1: world.map.height - my - 1 };
}

function gateColumn(side: EntranceSide, owned: ReturnType<typeof sandboxOwned>): [number, number] {
  const midX = (owned.x0 + owned.x1) >> 1;
  const midY = (owned.y0 + owned.y1) >> 1;
  switch (side) {
    case 'north':
      return [midX, owned.y0];
    case 'south':
      return [midX, owned.y1];
    case 'east':
      return [owned.x1, midY];
    case 'west':
      return [owned.x0, midY];
  }
}

/**
 * Readies a freshly created sandbox world: every ride unlocked, a level entrance path on the
 * owned edge, and a path running from the gate across the unowned land to a spawn point on the
 * map edge. Call once, before stepping.
 */
export function prepareSandbox(world: World): void {
  for (const def of Object.values(RIDE_CATALOG)) world.research.unlocked.add(def.id);
  const owned = sandboxOwned(world);
  const { side, length } = SANDBOX_ENTRANCE;
  const [gx, gy] = gateColumn(side, owned);
  const [dx, dy] = INWARD[side];
  const strip: Array<[number, number]> = [];
  for (let k = 0; k < length; k++) strip.push([gx + dx * k, gy + dy * k]);
  const level = Math.max(world.map.heights[world.map.index(gx, gy)]!, SEA_LEVEL + 1);
  levelTiles(world.map, strip, level);
  if (layOutEntrance(world, SANDBOX_ENTRANCE, owned) === 0) return;
  layOutApproach(world, side, world.park.entranceX, world.park.entranceY);
}

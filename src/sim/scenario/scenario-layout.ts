import type { World } from '../core/world';
import { placePath } from '../map/paths';
import type { TileMap } from '../map/tile-map';
import { applyScenario } from './scenario';
import { DEFAULT_LAND, generateScenarioMap, ownedBounds } from './scenario-map';
import type { TileRect } from './scenario-map';
import { placePrebuilt } from './scenario-prebuilt';
import type { ScenarioDef, ScenarioEntrance } from './scenario';
import { INWARD, layOutApproach } from './park-approach';
import { setParkEntrance } from '../guests/park';

/**
 * Lays the park entrance: the gate is the owned-land edge tile on `side`, and the path runs
 * inward from it. Searches the edge outward from its midpoint for the first run where every
 * tile is buildable, flat, dry and empty, so the result depends only on the terrain. Returns
 * the number of path pieces placed, or 0 when no such run exists.
 */
export function layOutEntrance(
  world: World,
  entrance: ScenarioEntrance,
  owned: TileRect = ownedBounds(world.map.width, world.map.height, DEFAULT_LAND),
): number {
  const m = world.map;
  const x0 = owned.x0;
  const x1 = owned.x1 + 1;
  const y0 = owned.y0;
  const y1 = owned.y1 + 1;
  const horizontal = entrance.side === 'north' || entrance.side === 'south';
  const [lo, hi] = horizontal ? [x0, x1 - 1] : [y0, y1 - 1];
  const mid = (lo + hi) >> 1;
  const gate = (along: number): [number, number] => {
    switch (entrance.side) {
      case 'north':
        return [along, y0];
      case 'south':
        return [along, y1 - 1];
      case 'east':
        return [x1 - 1, along];
      case 'west':
        return [x0, along];
    }
  };
  const [dx, dy] = INWARD[entrance.side];

  for (let offset = 0; offset <= hi - lo; offset++) {
    for (const along of offset === 0 ? [mid] : [mid - offset, mid + offset]) {
      if (along < lo || along > hi) continue;
      const [gx, gy] = gate(along);
      if (!isRunClear(m, gx, gy, dx, dy, entrance.length)) continue;
      for (let k = 0; k < entrance.length; k++) {
        placePath(m, { x: gx + dx * k, y: gy + dy * k });
      }
      setParkEntrance(world, gx, gy);
      return entrance.length;
    }
  }
  return 0;
}

function isRunClear(
  m: TileMap,
  gx: number,
  gy: number,
  dx: number,
  dy: number,
  length: number,
): boolean {
  for (let k = 0; k < length; k++) {
    const x = gx + dx * k;
    const y = gy + dy * k;
    if (!m.inBounds(x, y)) return false;
    const i = m.index(x, y);
    if (!m.canBuild(i) || m.slope[i] !== 0 || m.waterLevel[i] !== 0) return false;
    if (m.firstElement(i) >= 0) return false;
  }
  return true;
}

/**
 * Applies a scenario definition to a freshly created world: its terrain recipe, finances,
 * research catalogue, objective, the park entrance and any standing rides. Call once, before
 * stepping.
 */
export function prepareScenario(world: World, def: ScenarioDef): void {
  generateScenarioMap(world.map, def, world.seed);
  const economy = world.economy;
  economy.cash = Number.MAX_SAFE_INTEGER;
  if (def.entrance) {
    layOutEntrance(world, def.entrance, ownedBounds(world.map.width, world.map.height, def.land));
    if (def.prebuilt) placePrebuilt(world, def.entrance.side, def.prebuilt);
  }
  applyScenario(world, def);
  economy.monthlyTotals.fill(0);
}

/**
 * `prepareScenario` plus the park's approach: the entrance path continues from the gate across
 * any unowned land to a spawn point on the map edge, where guests arrive. Call once, before stepping.
 */
export function prepareScenarioPark(world: World, def: ScenarioDef): void {
  prepareScenario(world, def);
  if (!def.entrance || world.park.entranceX < 0) return;
  layOutApproach(world, def.entrance.side, world.park.entranceX, world.park.entranceY);
}

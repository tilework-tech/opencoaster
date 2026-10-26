import { TILE_UNITS, Z_STEP } from '../../sim/core/constants';
import type { MapData } from '../../render/renderer';
import { project, worldToScreen } from '../../render/projection';
import type { Rotation } from '../../render/projection';

/** Returns the projected centre of the gate and the contiguous path leading into the park. */
export function scenarioOpeningPosition(map: MapData, rotation: Rotation): [number, number] {
  const { width, height, entranceX, entranceY } = map;
  if (entranceX === undefined || entranceY === undefined || entranceX < 0 || entranceY < 0)
    return worldToScreen(width / 2, height / 2, 0, rotation, map);

  const path = new Set<string>();
  for (let i = 0; i < (map.pathCount ?? 0); i++)
    path.add(`${map.pathElements![i * 6]},${map.pathElements![i * 6 + 1]}`);

  const directions = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ] as const;
  let inward = directions.find(([dx, dy]) => path.has(`${entranceX + dx},${entranceY + dy}`));
  if (!inward) {
    const edgeDistances = [entranceY, width - 1 - entranceX, height - 1 - entranceY, entranceX];
    inward = directions[edgeDistances.indexOf(Math.min(...edgeDistances))];
  }

  const tiles: Array<[number, number]> = [[entranceX, entranceY]];
  let x = entranceX;
  let y = entranceY;
  for (let step = 0; step < 3; step++) {
    const nx = x + inward[0];
    const ny = y + inward[1];
    if (!path.has(`${nx},${ny}`)) break;
    tiles.push([nx, ny]);
    x = nx;
    y = ny;
  }

  const tileX = tiles.reduce((sum, [tx]) => sum + tx + 0.5, 0) / tiles.length;
  const tileY = tiles.reduce((sum, [, ty]) => sum + ty + 0.5, 0) / tiles.length;
  const out = new Float64Array(2);
  const index = entranceY * width + entranceX;
  project(
    tileX * TILE_UNITS,
    tileY * TILE_UNITS,
    map.heights[index]! * Z_STEP,
    width,
    height,
    rotation,
    out,
  );
  return [out[0]!, out[1]!];
}

import { TILE_UNITS, Z_STEP } from '../../sim/core/constants';
import { PathFlag } from '../../sim/map/tile-map';
import type { ToolMode } from '../../ui/game-ui';
import type { MapData, SpriteGhost } from '../../render/renderer';
import {
  pathAdditionBox,
  pathAdditionPlacements,
  pathAdditionGroundZ,
  pathAdditionView,
} from '../../render/ground-anchor';
import { pathAdditionSpriteName } from '../../render/world-art';

const PATH_ADDITION_FLAGS = PathFlag.Bin | PathFlag.Bench | PathFlag.Lamp | PathFlag.Shelter;

const ADDITION_FLAGS: Partial<Record<ToolMode, number>> = {
  bench: PathFlag.Bench,
  bin: PathFlag.Bin,
  lamp: PathFlag.Lamp,
  shelter: PathFlag.Shelter,
};

export function pathAdditionPreviewGhosts(
  map: MapData,
  x: number,
  y: number,
  tool: ToolMode,
  rotation: number,
): SpriteGhost[] {
  const additionFlag = ADDITION_FLAGS[tool];
  const paths = map.pathElements;
  if (!additionFlag || !paths) return [];
  const count = Math.min(map.pathCount ?? 0, paths.length / 6);
  for (let i = 0; i < count; i++) {
    const offset = i * 6;
    if (paths[offset] !== x || paths[offset + 1] !== y) continue;
    const flags = (paths[offset + 3]! & ~PATH_ADDITION_FLAGS) | additionFlag;
    const baseHeight = paths[offset + 2]!;
    if (additionFlag === PathFlag.Shelter) {
      const box = pathAdditionBox(additionFlag);
      return [
        {
          x,
          y,
          level: pathAdditionGroundZ(baseHeight, flags) / Z_STEP,
          sprite: pathAdditionSpriteName(additionFlag, rotation, 0),
          kind: 'path-addition' as const,
          tone: 'ok' as const,
          width: box.width,
          height: box.height,
        },
      ];
    }
    return pathAdditionPlacements(flags, baseHeight).map((placement) => ({
      x: x + placement.x / TILE_UNITS,
      y: y + placement.y / TILE_UNITS,
      tileX: x,
      tileY: y,
      level: placement.groundZ / Z_STEP,
      sprite: pathAdditionSpriteName(additionFlag, pathAdditionView(placement.edge, rotation), 0),
      kind: 'path-addition' as const,
      tone: 'ok' as const,
    }));
  }
  return [];
}

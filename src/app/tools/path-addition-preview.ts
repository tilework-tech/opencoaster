import { TILE_UNITS, Z_STEP } from '../../sim/core/constants';
import { PathFlag } from '../../sim/map/tile-map';
import type { ToolMode } from '../../ui/game-ui';
import type { MapData, SpriteGhost } from '../../render/renderer';
import {
  pathAdditionBox,
  pathAdditionEdgeGroundZ,
  pathAdditionEdgeOffset,
  pathAdditionEdges,
  pathAdditionGroundZ,
  pathAdditionView,
  pathConnectionEdges,
} from '../../render/ground-anchor';
import { pathAdditionSpriteName } from '../../render/world-art';

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
    const flags = paths[offset + 3]!;
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
    return pathAdditionEdges(pathConnectionEdges(flags)).map((edge) => {
      const view = pathAdditionView(edge, rotation);
      const position = pathAdditionEdgeOffset(edge);
      return {
        x: x + position.x / TILE_UNITS,
        y: y + position.y / TILE_UNITS,
        tileX: x,
        tileY: y,
        level: pathAdditionEdgeGroundZ(baseHeight, flags, edge) / Z_STEP,
        sprite: pathAdditionSpriteName(additionFlag, view, 0),
        kind: 'path-addition',
        tone: 'ok',
      };
    });
  }
  return [];
}

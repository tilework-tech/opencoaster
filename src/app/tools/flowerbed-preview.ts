import { flowerBedGroundZ } from '../../render/ground-anchor';
import { FLOWER_BED_BOX } from '../../render/sprite-layout';
import { Z_STEP } from '../../sim/core/constants';
import { flowerBedSpriteName } from '../../render/world-art';
import type { SpriteGhost } from '../../render/renderer';

export function flowerbedPreviewGhost(
  x: number,
  y: number,
  baseHeight: number,
  slopeMask: number,
  rotation: number,
): SpriteGhost {
  return {
    x,
    y,
    level: flowerBedGroundZ(baseHeight, slopeMask, rotation) / Z_STEP,
    sprite: flowerBedSpriteName(x, y, rotation, slopeMask),
    kind: 'scenery',
    width: FLOWER_BED_BOX.width,
    height: FLOWER_BED_BOX.height,
    tone: 'ok',
  };
}

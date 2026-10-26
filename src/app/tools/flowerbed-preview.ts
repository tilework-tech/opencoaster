import { flowerBedGroundZ } from '../../render/ground-anchor';
import { FLOWER_BED_BOX } from '../../render/sprite-layout';
import { Z_STEP } from '../../sim/core/constants';
import { scenerySpriteName } from '../../render/world-art';
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
    sprite: scenerySpriteName('flower-bed'),
    kind: 'scenery',
    width: FLOWER_BED_BOX.width,
    height: FLOWER_BED_BOX.height,
    tone: 'ok',
  };
}

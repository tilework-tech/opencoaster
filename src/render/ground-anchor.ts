import { PathFlag } from '../sim/map/tile-map';
import type { SceneryDefinition } from '../sim/map/scenery';
import { Z_STEP } from '../sim/core/constants';
import { terrainMeshTriangles } from './terrain-geometry';
import { SCENERY_PIXELS_PER_HEIGHT } from './sprite-layout';

export interface GroundBox {
  width: number;
  height: number;
}

export function pathAdditionBox(flags: number): GroundBox {
  if (flags & PathFlag.Shelter) return { width: 54, height: 52 };
  if (flags & PathFlag.Bench) return { width: 30, height: 18 };
  if (flags & PathFlag.Bin) return { width: 18, height: 26 };
  if (flags & PathFlag.Lamp) return { width: 16, height: 32 };
  return { width: 0, height: 0 };
}

export function pathAdditionGroundZ(baseHeight: number, flags: number): number {
  return baseHeight * Z_STEP + ((flags & PathFlag.Sloped) !== 0 ? Z_STEP / 2 : 1);
}

export function sceneryGroundZ(baseHeight: number, slopeMask: number, rotation: number): number {
  const corners = [0, 1, 2, 3].map((corner) => baseHeight + ((slopeMask >> corner) & 1));
  const [first, second] = terrainMeshTriangles(rotation);
  const diagonal = first.filter((corner) => second.includes(corner));
  return ((corners[diagonal[0]]! + corners[diagonal[1]]!) / 2) * Z_STEP;
}

export function sceneryBox(definition: SceneryDefinition): GroundBox {
  return {
    width: definition.width,
    height: definition.height * SCENERY_PIXELS_PER_HEIGHT,
  };
}

export function spriteAnchorScreenShift(
  frameWidth: number,
  anchorX: number,
  renderedWidth: number,
): number {
  return renderedWidth * (0.5 - anchorX / frameWidth);
}

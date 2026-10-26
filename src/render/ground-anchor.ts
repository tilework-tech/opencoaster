import { DIR_DX, DIR_DY, PathFlag, SLOPE_DIR_SHIFT } from '../sim/map/tile-map';
import type { SceneryDefinition } from '../sim/map/scenery';
import { Z_STEP } from '../sim/core/constants';
import { terrainMeshTriangles } from './terrain-geometry';
import { SCENERY_PIXELS_PER_HEIGHT } from './sprite-layout';

export interface GroundBox {
  width: number;
  height: number;
}

export interface PathAdditionOffset {
  x: number;
  y: number;
}

const PATH_ADDITION_EDGE_OFFSET = 64;

export function pathAdditionEdges(edges: number): number[] {
  return [0, 1, 2, 3].filter((edge) => (edges & (1 << edge)) === 0);
}

export function pathAdditionEdgeOffset(edge: number): PathAdditionOffset {
  const direction = ((edge % 4) + 4) % 4;
  return {
    x: DIR_DX[direction]! * PATH_ADDITION_EDGE_OFFSET,
    y: DIR_DY[direction]! * PATH_ADDITION_EDGE_OFFSET,
  };
}

export function pathAdditionView(edge: number, rotation: number): number {
  return (((edge + rotation) % 4) + 4) % 4;
}

export function pathAdditionEdgeGroundZ(baseHeight: number, flags: number, edge: number): number {
  const baseZ = baseHeight * Z_STEP;
  if ((flags & PathFlag.Sloped) === 0) return baseZ + 1;
  const slopeDirection = (flags & PathFlag.SlopeDir) >> SLOPE_DIR_SHIFT;
  const direction = ((edge % 4) + 4) % 4;
  if (direction === slopeDirection) return baseZ + Z_STEP + 1;
  if (direction === ((slopeDirection + 2) & 3)) return baseZ + 1;
  return baseZ + Z_STEP / 2 + 1;
}

export function pathAdditionBox(flags: number, view = 0): GroundBox {
  let box: GroundBox;
  if (flags & PathFlag.Shelter) box = { width: 54, height: 52 };
  else if (flags & PathFlag.Bench) box = { width: 30, height: 18 };
  else if (flags & PathFlag.Bin) box = { width: 18, height: 26 };
  else if (flags & PathFlag.Lamp) box = { width: 16, height: 32 };
  else return { width: 0, height: 0 };
  return view & 1 ? { width: box.height, height: box.width } : box;
}

export function pathConnectionEdges(flags: number): number {
  return (flags & PathFlag.Edges) | ((flags & PathFlag.Forced) >> 4);
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

export function flowerBedGroundZ(baseHeight: number, slopeMask: number, rotation: number): number {
  return sceneryGroundZ(baseHeight, slopeMask, rotation) + 1;
}

export function sceneryBox(definition: SceneryDefinition): GroundBox {
  return {
    width: definition.width,
    height: definition.height * SCENERY_PIXELS_PER_HEIGHT,
  };
}

export function adjustDepthForGroundZ(
  depthAtBaseHeight: number,
  baseHeight: number,
  groundZ: number,
): number {
  return depthAtBaseHeight - (groundZ / Z_STEP - baseHeight);
}

export function spriteAnchorScreenShift(
  frameWidth: number,
  anchorX: number,
  renderedWidth: number,
): number {
  return renderedWidth * (0.5 - anchorX / frameWidth);
}

import { DIR_DX, DIR_DY, PathFlag, SLOPE_DIR_SHIFT } from '../sim/map/tile-map';
import type { SceneryDefinition } from '../sim/map/scenery';
import { Z_STEP } from '../sim/core/constants';
import { terrainMeshTriangles } from './terrain-geometry';
import { FLOWER_BED_BOX, SCENERY_PIXELS_PER_HEIGHT } from './sprite-layout';

export interface GroundBox {
  width: number;
  height: number;
}

export interface PathAdditionOffset {
  x: number;
  y: number;
}

const PATH_ADDITION_EDGE_OFFSET = 96;
const PATH_ADDITION_CORNERS: readonly (readonly [number, number])[] = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

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
  else if (flags & PathFlag.Bench) box = { width: 38, height: 12 };
  else if (flags & PathFlag.Bin) box = { width: 14, height: 12 };
  else if (flags & PathFlag.Lamp) box = { width: 10, height: 36 };
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
  if (definition.sprite === 'flower-bed') return FLOWER_BED_BOX;
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

export interface PathAdditionPlacement {
  /** Tile edge (0-3) the copy stands on, before camera rotation. */
  edge: number;
  /** Offset from the tile centre in world units. */
  x: number;
  y: number;
  groundZ: number;
}

/**
 * Every copy of a bench, bin, or lamp a path tile draws: one on each open (unconnected) edge,
 * backed onto the grass and facing the path. Only lamps stand on a crossroads, as four corner
 * posts. Placements depend on the tile alone, so camera rotation only turns the sprite.
 */
export function pathAdditionPlacements(flags: number, baseHeight: number): PathAdditionPlacement[] {
  const connections = pathConnectionEdges(flags);
  const placements: PathAdditionPlacement[] = [];
  for (let edge = 0; edge < 4; edge++) {
    if (connections & (1 << edge)) continue;
    const offset = pathAdditionEdgeOffset(edge);
    placements.push({
      edge,
      x: offset.x,
      y: offset.y,
      groundZ: pathAdditionEdgeGroundZ(baseHeight, flags, edge),
    });
  }
  if (placements.length === 0 && flags & PathFlag.Lamp)
    for (let corner = 0; corner < 4; corner++) {
      const [sx, sy] = PATH_ADDITION_CORNERS[corner]!;
      const first = pathAdditionEdgeGroundZ(baseHeight, flags, corner);
      const second = pathAdditionEdgeGroundZ(baseHeight, flags, corner + 1);
      placements.push({
        edge: corner,
        x: sx * PATH_ADDITION_EDGE_OFFSET,
        y: sy * PATH_ADDITION_EDGE_OFFSET,
        groundZ: (first + second) / 2,
      });
    }
  return placements;
}

export interface TerrainCorner {
  x: number;
  y: number;
  height: number;
}

export interface TerrainEdgeFace {
  start: TerrainCorner;
  end: TerrainCorner;
  bottomHeight: number;
}

/** How strongly a slope's lean toward the light darkens or brightens a tile. */
const LIGHT_ACROSS = 0.16;
const LIGHT_VERTICAL = 0.06;
const LIGHT_MIN = 0.74;
const LIGHT_MAX = 1.26;

/**
 * Brightness multiplier for a terrain tile from its corner heights in view order (top, right,
 * bottom, left; 64 per level). The light is fixed on screen, so a slope rising toward the right
 * reads lighter, one rising toward the left reads darker, and a slope climbing toward the viewer
 * is a little lighter than one climbing away. Flat tiles are unchanged.
 */
export function terrainLightFactor(corners: readonly [number, number, number, number]): number {
  const alongRight = (corners[1] + corners[2] - corners[0] - corners[3]) / 2 / 64;
  const alongLeft = (corners[2] + corners[3] - corners[0] - corners[1]) / 2 / 64;
  const factor =
    1 + (alongRight - alongLeft) * LIGHT_ACROSS + (alongRight + alongLeft) * LIGHT_VERTICAL;
  return Math.max(LIGHT_MIN, Math.min(LIGHT_MAX, factor));
}

export interface ContourMap {
  width: number;
  height: number;
  heights: Uint8Array;
  slope: Uint8Array;
}

function worldCornerLevels(map: ContourMap, x: number, y: number): number[] {
  const index = y * map.width + x;
  const base = map.heights[index]!;
  const mask = map.slope[index]!;
  return [
    base + (mask & 1),
    base + ((mask >> 1) & 1),
    base + ((mask >> 2) & 1),
    base + ((mask >> 3) & 1),
  ];
}

const EDGE_NEIGHBOUR_BY_DIRECTION: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

const EDGE_NEIGHBOUR: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Bit mask of a tile's world edges (edge j joins corners j and j+1) that lie on a contour: a
 * level edge where the ground changes inclination, or where it steps to a different height than
 * the neighbouring tile's matching edge.
 */
export function terrainContourEdges(map: ContourMap, x: number, y: number): number {
  const corners = worldCornerLevels(map, x, y);
  let mask = 0;
  for (let edge = 0; edge < 4; edge++) {
    const level = corners[edge]!;
    const next = corners[(edge + 1) & 3]!;
    if (level !== next) continue;
    const [dx, dy] = EDGE_NEIGHBOUR[edge]!;
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
    const other = worldCornerLevels(map, nx, ny);
    const shared = (edge + 2) & 3;
    if (other[shared] !== next || other[(shared + 1) & 3] !== level) {
      mask |= 1 << edge;
      continue;
    }
    const ownRise = (corners[(edge + 2) & 3]! + corners[(edge + 3) & 3]!) / 2 - level;
    const otherRise = (other[edge]! + other[(edge + 1) & 3]!) / 2 - level;
    if (ownRise + otherRise !== 0) mask |= 1 << edge;
  }
  return mask;
}

/** `terrainContourEdges` re-indexed to the view: bit k is the edge from view corner k to k+1. */
export function terrainContourViewEdges(
  map: ContourMap,
  x: number,
  y: number,
  rotation: number,
): number {
  const world = terrainContourEdges(map, x, y);
  const top = viewTopCorner(rotation);
  let mask = 0;
  for (let edge = 0; edge < 4; edge++) if (world & (1 << ((top + edge) & 3))) mask |= 1 << edge;
  return mask;
}

/** World corner index shown at the view's top-left corner after the given rotation. */
function viewTopCorner(rotation: number): number {
  return (((4 - rotation) % 4) + 4) % 4;
}

export function viewTerrainCornerHeights(
  worldCorners: readonly [number, number, number, number],
  rotation: number,
): [number, number, number, number] {
  const top = viewTopCorner(rotation);
  return [
    worldCorners[top]!,
    worldCorners[(top + 1) & 3]!,
    worldCorners[(top + 2) & 3]!,
    worldCorners[(top + 3) & 3]!,
  ];
}

/**
 * World corner indices of the two triangles the terrain quad is drawn with for a view rotation.
 * The quad is a triangle strip in view order, so its diagonal joins view corners 1 and 3, which is
 * world corners 1 and 3 on even rotations and world corners 0 and 2 on odd rotations.
 */
export function terrainMeshTriangles(
  rotation: number,
): [[number, number, number], [number, number, number]] {
  const top = viewTopCorner(rotation);
  const world = (view: number) => (top + view) & 3;
  return [
    [world(0), world(1), world(3)],
    [world(1), world(3), world(2)],
  ];
}

export function terrainTileCorners(
  x: number,
  y: number,
  baseHeight: number,
  slopeMask: number,
): [TerrainCorner, TerrainCorner, TerrainCorner, TerrainCorner] {
  return [
    { x, y, height: baseHeight + (slopeMask & 1) },
    { x: x + 1, y, height: baseHeight + ((slopeMask >> 1) & 1) },
    { x: x + 1, y: y + 1, height: baseHeight + ((slopeMask >> 2) & 1) },
    { x, y: y + 1, height: baseHeight + ((slopeMask >> 3) & 1) },
  ];
}

/** Returns the part of a terrain tile below a horizontal water plane in consistent world order. */
export function clipTerrainTileBelowHeight(
  corners: readonly TerrainCorner[],
  waterHeight: number,
): TerrainCorner[] {
  if (corners.length < 3) return [];
  const clipped: TerrainCorner[] = [];
  let previous = corners[corners.length - 1]!;
  let previousWet = previous.height <= waterHeight;
  for (const current of corners) {
    const currentWet = current.height <= waterHeight;
    if (currentWet !== previousWet) {
      const amount = (waterHeight - previous.height) / (current.height - previous.height);
      if (amount > 0 && amount < 1)
        clipped.push({
          x: previous.x + (current.x - previous.x) * amount,
          y: previous.y + (current.y - previous.y) * amount,
          height: waterHeight,
        });
    }
    if (currentWet) clipped.push(current);
    previous = current;
    previousWet = currentWet;
  }
  return clipped;
}

/** Clips the same two-triangle surface, for this view rotation, that the WebGL terrain mesh draws. */
export function clipTerrainTileTrianglesBelowHeight(
  corners: readonly TerrainCorner[],
  waterHeight: number,
  rotation: number,
): TerrainCorner[][] {
  if (corners.length !== 4) return [];
  return terrainMeshTriangles(rotation)
    .map((triangle) =>
      clipTerrainTileBelowHeight(
        triangle.map((corner) => corners[corner]!),
        waterHeight,
      ),
    )
    .filter((polygon) => polygon.length >= 3);
}

/** Returns the waterline segments inside a tile, excluding tile edges shared by neighboring water. */
export function terrainShorelineSegments(
  corners: readonly TerrainCorner[],
  waterHeight: number,
  rotation: number,
): [TerrainCorner, TerrainCorner][] {
  const segments: [TerrainCorner, TerrainCorner][] = [];
  for (const polygon of clipTerrainTileTrianglesBelowHeight(corners, waterHeight, rotation)) {
    for (let index = 0; index < polygon.length; index++) {
      const start = polygon[index]!;
      const end = polygon[(index + 1) % polygon.length]!;
      if (
        start.height === waterHeight &&
        end.height === waterHeight &&
        (start.x !== end.x || start.y !== end.y)
      )
        segments.push([start, end]);
    }
  }
  return segments;
}

const EDGE_CORNERS: readonly (readonly [number, number])[] = [
  [1, 2],
  [2, 3],
  [3, 0],
  [0, 1],
];

/**
 * Lowest height of the neighbouring tile's edge that meets this tile's `direction` edge, or 0
 * beyond the map border. A cliff face hangs from the tile's edge down to this height.
 */
export function terrainNeighborEdgeBase(
  map: ContourMap,
  x: number,
  y: number,
  direction: number,
): number {
  const [dx, dy] = EDGE_NEIGHBOUR_BY_DIRECTION[direction]!;
  const nx = x + dx;
  const ny = y + dy;
  if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) return 0;
  const levels = worldCornerLevels(map, nx, ny);
  const [a, b] = EDGE_CORNERS[(direction + 2) & 3]!;
  return Math.min(levels[a]!, levels[b]!);
}

/** Whether a face on the tile's `direction` edge turns toward the viewer at this rotation. */
export function terrainEdgeFacesViewer(direction: number, rotation: number): boolean {
  return ((direction + rotation) & 3) < 2;
}

export function terrainEdgeFace(
  corners: readonly TerrainCorner[],
  direction: number,
  neighborBase: number,
): TerrainEdgeFace | null {
  const edge = EDGE_CORNERS[direction];
  if (!edge) return null;
  const [start, end] = edge.map((corner) => corners[corner]!);
  if (start.height <= neighborBase && end.height <= neighborBase) return null;
  return {
    start: { ...start, height: Math.max(start.height, neighborBase) },
    end: { ...end, height: Math.max(end.height, neighborBase) },
    bottomHeight: neighborBase,
  };
}

/**
 * Painter keys for one tile's shoreline. The water surface draws before the bank faces that rise
 * from its waterline, so a wall is never covered by water from the tile it belongs to.
 */
export function tileWaterDepth(rx: number, ry: number, waterLevel: number): number {
  return 2 * (rx + ry) - waterLevel + 2;
}

export function tileBankDepth(rx: number, ry: number, waterLevel: number): number {
  return 2 * (rx + ry) - waterLevel + 3;
}

export function waterCoversTerrainTile(
  waterLevel: number,
  slopeMask: number,
  baseHeight: number,
): boolean {
  if (waterLevel <= 0) return false;
  for (let corner = 0; corner < 4; corner++)
    if (baseHeight + ((slopeMask >> corner) & 1) > waterLevel) return false;
  return true;
}

export function waterIntersectsTerrainTile(
  waterLevel: number,
  slopeMask: number,
  baseHeight: number,
): boolean {
  if (waterLevel <= 0) return false;
  for (let corner = 0; corner < 4; corner++)
    if (baseHeight + ((slopeMask >> corner) & 1) < waterLevel) return true;
  return false;
}

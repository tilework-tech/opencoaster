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

export function terrainLightFactor(corners: readonly [number, number, number, number]): number {
  const slopeX = (corners[1] + corners[2] - corners[0] - corners[3]) / 2 / 64;
  const slopeY = (corners[2] + corners[3] - corners[0] - corners[1]) / 2 / 64;
  return Math.max(0.92, Math.min(1.08, 1 + (slopeX - slopeY) * 0.05));
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

export function terrainEdgeFace(
  corners: readonly TerrainCorner[],
  direction: number,
  neighborBase: number,
): TerrainEdgeFace | null {
  const edgeCorners: readonly (readonly [number, number])[] = [
    [1, 2],
    [2, 3],
    [3, 0],
    [0, 1],
  ];
  const edge = edgeCorners[direction];
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

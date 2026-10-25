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

export function viewTerrainCornerHeights(
  worldCorners: readonly [number, number, number, number],
  rotation: number,
): [number, number, number, number] {
  const top = (((4 - rotation) % 4) + 4) % 4;
  return [
    worldCorners[top]!,
    worldCorners[(top + 1) & 3]!,
    worldCorners[(top + 2) & 3]!,
    worldCorners[(top + 3) & 3]!,
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

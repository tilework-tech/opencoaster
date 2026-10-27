import { GROUND_OBJECT_ID, LAND_OVERLAY_OBJECT_ID, WATER_OBJECT_ID } from './object-kinds';
import { landOverlayTiles } from './park-boundary';
import type { OracleTriangle, OracleVertex } from './occlusion-oracle';
import { worldToScreen } from './projection';
import type { Camera, MapData } from './renderer';
import {
  terrainEdgeFace,
  terrainEdgeFacesViewer,
  terrainMeshTriangles,
  terrainNeighborEdgeBase,
  terrainTileCorners,
  waterIntersectsTerrainTile,
} from './terrain-geometry';
import { trenchFaces, trenchSurfaceTriangles } from './trench-geometry';
import type { TrenchPoint } from './trench-geometry';
import type { TrenchTile } from '../sim/track/trench';
import { WATER_BANK } from './world-art';
import { MAX_HEIGHT } from '../sim/map/tile-map';

const NO_TRENCHES: ReadonlyMap<number, TrenchTile> = new Map();

/** Screen extent (world pixels) of a tile's ground around the projection of its sea-level centre. */
const TILE_REACH_X = 64;
const TILE_REACH_UP = (MAX_HEIGHT + 2) * 16 + 32;
const TILE_REACH_DOWN = 96;

/** Projects a world point (tiles, tiles, levels) to a backing-buffer oracle vertex. */
export function terrainVertex(
  map: MapData,
  camera: Pick<Camera, 'x' | 'y' | 'zoom' | 'rotation'>,
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
): (x: number, y: number, height: number) => OracleVertex {
  return (x, y, height) => {
    const [sx, sy] = worldToScreen(x, y, height, camera.rotation, map);
    return {
      x: ((sx - camera.x) * camera.zoom + viewportWidth / 2) * devicePixelRatio,
      y: ((sy - camera.y) * camera.zoom + viewportHeight / 2) * devicePixelRatio,
      height,
    };
  };
}

/**
 * The ground, cliff faces and water surface of `map` as oracle triangles in backing-buffer
 * pixels: the terrain geometry both renderers draw, with its true height at every vertex. With
 * `landOverlay`, the land overlay's tiles follow on the terrain surface.
 */
export function terrainTriangles(
  map: MapData,
  camera: Pick<Camera, 'x' | 'y' | 'zoom' | 'rotation'>,
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
  landOverlay = false,
  trenches: ReadonlyMap<number, TrenchTile> = NO_TRENCHES,
): OracleTriangle[] {
  const vertex = terrainVertex(map, camera, viewportWidth, viewportHeight, devicePixelRatio);
  const out: OracleTriangle[] = [];
  const split = terrainMeshTriangles(camera.rotation);
  const right = viewportWidth * devicePixelRatio;
  const bottom = viewportHeight * devicePixelRatio;
  // A tile's ground, cliffs and water lie within a tile width of its base point horizontally, and
  // between its base and the highest terrain level vertically.
  const reachX = TILE_REACH_X * camera.zoom * devicePixelRatio;
  const reachUp = TILE_REACH_UP * camera.zoom * devicePixelRatio;
  const reachDown = TILE_REACH_DOWN * camera.zoom * devicePixelRatio;
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const index = y * map.width + x;
      const centre = vertex(x + 0.5, y + 0.5, 0);
      if (centre.x < -reachX || centre.x > right + reachX) continue;
      if (centre.y < -reachDown || centre.y > bottom + reachUp) continue;
      const base = map.heights[index];
      const mask = map.slope[index];
      const corners = terrainTileCorners(x, y, base, mask);
      const points = corners.map((c) => vertex(c.x, c.y, c.height));
      const trench = trenches.get(index);
      if (trench) {
        const project = (p: TrenchPoint): OracleVertex => vertex(p.x, p.y, p.height);
        for (const [a, b, c] of trenchSurfaceTriangles(trench, x, y, base, mask, camera.rotation))
          out.push({ id: GROUND_OBJECT_ID, a: project(a), b: project(b), c: project(c) });
        for (const face of trenchFaces(trench, x, y, base, mask, camera.rotation)) {
          const [a, b] = face.top.map(project) as [OracleVertex, OracleVertex];
          const [d, c] = face.bottom.map(project) as [OracleVertex, OracleVertex];
          out.push({ id: GROUND_OBJECT_ID, a, b, c });
          out.push({ id: GROUND_OBJECT_ID, a, b: c, c: d });
        }
      } else
        for (const [a, b, c] of split)
          out.push({ id: GROUND_OBJECT_ID, a: points[a], b: points[b], c: points[c] });
      for (let direction = 0; direction < 4; direction++) {
        if (!terrainEdgeFacesViewer(direction, camera.rotation)) continue;
        const face = terrainEdgeFace(
          corners,
          direction,
          terrainNeighborEdgeBase(map, x, y, direction),
        );
        if (!face) continue;
        const topStart = vertex(face.start.x, face.start.y, face.start.height);
        const topEnd = vertex(face.end.x, face.end.y, face.end.height);
        const bottomStart = vertex(face.start.x, face.start.y, face.bottomHeight);
        const bottomEnd = vertex(face.end.x, face.end.y, face.bottomHeight);
        out.push({ id: GROUND_OBJECT_ID, a: topStart, b: topEnd, c: bottomEnd });
        out.push({ id: GROUND_OBJECT_ID, a: topStart, b: bottomEnd, c: bottomStart });
      }
      const level = map.waterLevel?.[index] ?? 0;
      if (!waterIntersectsTerrainTile(level, mask, base)) continue;
      const surface = level - WATER_BANK.surfaceInset / 64;
      const w = [
        vertex(x, y, surface),
        vertex(x + 1, y, surface),
        vertex(x + 1, y + 1, surface),
        vertex(x, y + 1, surface),
      ];
      out.push({ id: WATER_OBJECT_ID, a: w[0], b: w[1], c: w[2] });
      out.push({ id: WATER_OBJECT_ID, a: w[0], b: w[2], c: w[3] });
    }
  // The land overlay lies on the terrain surface after it, so it wins its own tile's tie.
  if (landOverlay)
    for (const tile of landOverlayTiles(map)) {
      const index = tile.y * map.width + tile.x;
      const corners = terrainTileCorners(tile.x, tile.y, map.heights[index], map.slope[index]);
      const points = corners.map((c) => vertex(c.x, c.y, c.height));
      for (const [a, b, c] of split)
        out.push({ id: LAND_OVERLAY_OBJECT_ID, a: points[a], b: points[b], c: points[c] });
    }
  return out;
}

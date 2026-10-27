import { Z_PIXELS } from './projection';
import { terrainVertex } from './oracle-terrain';
import type { Camera, MapData } from './renderer';
import type { TrenchTile } from '../sim/track/trench';
import {
  TRENCH_ARCH_LEVELS,
  TRENCH_ARCH_TEXTURE_HEIGHT,
  TRENCH_ARCH_TEXTURE_WIDTH,
  TRENCH_HEAD_DARK,
  TRENCH_HEAD_LIT,
  TRENCH_WALL_DARK,
  TRENCH_WALL_LIT,
  TRENCH_WALL_TEXTURE_HEIGHT,
  TRENCH_WALL_TEXTURE_WIDTH,
  trenchFaceFacing,
  trenchFaces,
} from './trench-geometry';
import type { TrenchFace, TrenchPoint } from './trench-geometry';

export type TrenchTexture = 'floor' | 'wall' | 'arch';

/** Texels per side of the floor texture, which is laid once over the tile in view space. */
export const TRENCH_FLOOR_TEXTURE_SIZE = 16;

/** A screen-space vertex with the world height and the texel position it samples. */
export interface PaintVertex {
  x: number;
  y: number;
  height: number;
  u: number;
  v: number;
}

/** A trench triangle with the texture to paint it with, as software-composited by Canvas2D. */
export interface PaintTriangle {
  a: PaintVertex;
  b: PaintVertex;
  c: PaintVertex;
  texture: TrenchTexture;
  shade: number;
}

/**
 * The visible faces of every trench tile as textured triangles in backing-buffer pixels. The
 * texels follow the same mapping the WebGL2 renderer gives its face meshes: walls and the part
 * of a headwall above the arch hang from their top edge, the arch stands on the floor, and the
 * floor is laid once over its tile in view space.
 */
export function trenchPaintTriangles(
  trenches: ReadonlyMap<number, TrenchTile>,
  map: MapData,
  camera: Pick<Camera, 'x' | 'y' | 'zoom' | 'rotation'>,
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
): PaintTriangle[] {
  const project = terrainVertex(map, camera, viewportWidth, viewportHeight, devicePixelRatio);
  const out: PaintTriangle[] = [];
  const vertex = (p: TrenchPoint, u: number, v: number): PaintVertex => ({
    ...project(p.x, p.y, p.height),
    u,
    v,
  });
  const quad = (
    corners: readonly [PaintVertex, PaintVertex, PaintVertex, PaintVertex],
    texture: TrenchTexture,
    shade: number,
  ): void => {
    out.push({ a: corners[0], b: corners[1], c: corners[2], texture, shade });
    out.push({ a: corners[0], b: corners[2], c: corners[3], texture, shade });
  };
  for (const trench of trenches.values()) {
    const x = trench.index % map.width;
    const y = (trench.index - x) / map.width;
    const base = map.heights[trench.index]!;
    for (const face of trenchFaces(trench, x, y, base, map.slope[trench.index]!, camera.rotation)) {
      if (face.kind === 'floor') {
        paintFloor(face, x, y, camera.rotation, vertex, quad);
        continue;
      }
      const facing = (trenchFaceFacing(trench, face) + camera.rotation) & 3;
      if (facing >= 2) continue;
      if (face.kind === 'wall')
        paintWall(face, facing === 0 ? TRENCH_WALL_LIT : TRENCH_WALL_DARK, vertex, quad);
      else paintHead(face, facing === 0 ? TRENCH_HEAD_LIT : TRENCH_HEAD_DARK, vertex, quad);
    }
  }
  return out;
}

type Vertex = (p: TrenchPoint, u: number, v: number) => PaintVertex;
type Quad = (
  corners: readonly [PaintVertex, PaintVertex, PaintVertex, PaintVertex],
  texture: TrenchTexture,
  shade: number,
) => void;

/** View-space tile coordinates of a point of the tile (as in the WebGL2 tile mesh's `aCorner`). */
function viewUv(fx: number, fy: number, rotation: number): [number, number] {
  const top = (((4 - rotation) % 4) + 4) % 4;
  const corner = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ] as const;
  const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), fx * fy, (1 - fx) * fy];
  let u = 0;
  let v = 0;
  for (let k = 0; k < 4; k++) {
    const [cu, cv] = corner[(k - top + 4) & 3]!;
    u += weights[k]! * cu;
    v += weights[k]! * cv;
  }
  return [u, v];
}

function paintFloor(
  face: TrenchFace,
  tileX: number,
  tileY: number,
  rotation: number,
  vertex: Vertex,
  quad: Quad,
): void {
  const [a, b] = face.top;
  const [d, c] = face.bottom;
  const corner = (p: TrenchPoint): PaintVertex => {
    const [u, v] = viewUv(p.x - tileX, p.y - tileY, rotation);
    return vertex(p, u * TRENCH_FLOOR_TEXTURE_SIZE, v * TRENCH_FLOOR_TEXTURE_SIZE);
  };
  quad([corner(a), corner(b), corner(c), corner(d)], 'floor', 1);
}

/** A wall's texels: u along the wall, v down from the surface at each end. */
function paintWall(face: TrenchFace, shade: number, vertex: Vertex, quad: Quad): void {
  const [t0, t1] = face.top;
  const [b0, b1] = face.bottom;
  const w = TRENCH_WALL_TEXTURE_WIDTH;
  const depth = (top: TrenchPoint, bottom: TrenchPoint): number =>
    Math.min(TRENCH_WALL_TEXTURE_HEIGHT, (top.height - bottom.height) * Z_PIXELS);
  quad(
    [
      vertex(t0, 0, 0),
      vertex(t1, w, 0),
      vertex(b1, w, depth(t1, b1)),
      vertex(b0, 0, depth(t0, b0)),
    ],
    'wall',
    shade,
  );
}

/** A headwall: the arch texture standing on the floor, with wall above it where the earth is higher. */
function paintHead(face: TrenchFace, shade: number, vertex: Vertex, quad: Quad): void {
  const [t0, t1] = face.top;
  const [b0, b1] = face.bottom;
  const archLevels = TRENCH_ARCH_LEVELS;
  const w = TRENCH_ARCH_TEXTURE_WIDTH;
  const h = TRENCH_ARCH_TEXTURE_HEIGHT;
  const lift = (p: TrenchPoint, height: number): TrenchPoint => ({ ...p, height });
  const arch0 = lift(t0, Math.min(t0.height, b0.height + archLevels));
  const arch1 = lift(t1, Math.min(t1.height, b1.height + archLevels));
  quad(
    [
      vertex(arch0, 0, h - ((arch0.height - b0.height) / archLevels) * h),
      vertex(arch1, w, h - ((arch1.height - b1.height) / archLevels) * h),
      vertex(b1, w, h),
      vertex(b0, 0, h),
    ],
    'arch',
    shade,
  );
  const roof0 = lift(t0, b0.height + archLevels);
  const roof1 = lift(t1, b1.height + archLevels);
  if ((t0.height + t1.height) / 2 - (roof0.height + roof1.height) / 2 <= 0.02) return;
  const ww = TRENCH_WALL_TEXTURE_WIDTH;
  quad(
    [
      vertex(t0, 0, 0),
      vertex(t1, ww, 0),
      vertex(
        roof1,
        ww,
        Math.min(TRENCH_WALL_TEXTURE_HEIGHT, (t1.height - roof1.height) * Z_PIXELS),
      ),
      vertex(roof0, 0, Math.min(TRENCH_WALL_TEXTURE_HEIGHT, (t0.height - roof0.height) * Z_PIXELS)),
    ],
    'wall',
    shade,
  );
}

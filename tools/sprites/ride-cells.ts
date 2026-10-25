import { clipMesh, rotateMesh, rotatePoint, translateMesh } from './mesh';
import type { Mesh } from './mesh';

export type Footprint = ReadonlyArray<readonly [dx: number, dy: number]>;

/** How far past the footprint a slice on its outer edge keeps overhanging geometry, in tiles. */
const OVERHANG = 3;

/**
 * Centre of the footprint's bounding box in tile offsets from the anchor tile. Flat-ride models
 * are authored around their own origin and placed so that origin lies here.
 */
export function footprintCentre(footprint: Footprint): [number, number] {
  const xs = footprint.map(([x]) => x);
  const ys = footprint.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** The model moved so its origin is the footprint centre, in coordinates relative to the anchor. */
export function placeOnFootprint(model: Mesh, footprint: Footprint): Mesh {
  const [cx, cy] = footprintCentre(footprint);
  return translateMesh(model, cx, cy, 0);
}

/**
 * The part of an anchor-relative `placed` model that belongs to footprint tile `cellIndex`, turned
 * `view` quarter turns and shifted so the tile centre is the origin (the sprite anchor).
 *
 * The cell owns the vertical prism over its tile. On sides with no further footprint tile the
 * prism is open, so geometry overhanging the footprint is kept by the nearest edge tile instead of
 * being cut off. `view` must be `(cameraRotation + rideDir) & 3`: a tile offset `f` of the
 * unrotated footprint lies at `rotatePoint(f, view)` once the ride is turned and viewed.
 */
export function rideCellMesh(
  placed: Mesh,
  footprint: Footprint,
  cellIndex: number,
  view: number,
): Mesh {
  const [i, j] = footprint[cellIndex];
  const has = (di: number, dj: number): boolean =>
    footprint.some(([x, y]) => x === i + di && y === j + dj);
  const clipped = clipMesh(
    placed,
    i - 0.5 - (has(-1, 0) ? 0 : OVERHANG),
    i + 0.5 + (has(1, 0) ? 0 : OVERHANG),
    j - 0.5 - (has(0, -1) ? 0 : OVERHANG),
    j + 0.5 + (has(0, 1) ? 0 : OVERHANG),
  );
  const centre = rotatePoint([i, j, 0], view);
  return translateMesh(rotateMesh(clipped, view), -centre[0], -centre[1], 0);
}

/** The whole placed model expressed in the same frame as `rideCellMesh(…, cellIndex, view)`. */
export function rideCellContext(
  placed: Mesh,
  footprint: Footprint,
  cellIndex: number,
  view: number,
): Mesh {
  const [i, j] = footprint[cellIndex];
  const centre = rotatePoint([i, j, 0], view);
  return translateMesh(rotateMesh(placed, view), -centre[0], -centre[1], 0);
}

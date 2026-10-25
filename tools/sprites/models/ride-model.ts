import { physicalToLevels } from '../mesh';
import type { Mesh, Vec3 } from '../mesh';

export interface RideModel {
  /** Manifest key without view suffix, e.g. `rides/merry-go-round`. */
  key: string;
  frames: number;
  /** Mesh for operating frame `frame`, authored in physical tile units around the tile centre. */
  build: (frame: number) => Mesh;
}

/** The ride mesh in height levels, ready for `renderMesh`. */
export function rideMesh(model: RideModel, frame: number): Mesh {
  return physicalToLevels(model.build(frame));
}

/** Point on an axis-aligned ellipse centred on the tile centre, at parameter `angle` (radians). */
export function ellipsePoint(rx: number, ry: number, angle: number, z = 0): Vec3 {
  return [Math.cos(angle) * rx, Math.sin(angle) * ry, z];
}

/** Heading (radians, counter-clockwise from +x) of the ellipse's tangent at `angle`. */
export function ellipseHeading(rx: number, ry: number, angle: number): number {
  return Math.atan2(ry * Math.cos(angle), -rx * Math.sin(angle));
}

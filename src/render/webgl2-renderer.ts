import type { Renderer } from './renderer';

/**
 * Planned WebGL2 backend (not implemented). Design notes:
 *  - Tiles: one static instance buffer rebuilt only on map change; per-instance (x, y, height,
 *    surface), view rotation applied in the vertex shader.
 *  - Entities: snapshot Int32 layers are uploaded directly as instance attributes
 *    (stride matches SNAPSHOT_STRIDE), drawn as instanced billboards from a procedurally
 *    generated atlas. Zero per-entity JS work per frame.
 *  - Depth: painter's order via a depth value derived from (rx + ry, z).
 */
export class WebGL2Renderer implements Renderer {
  attach(): void {
    throw new Error('WebGL2Renderer is not implemented yet');
  }
  resize(): void {}
  setMap(): void {}
  draw(): void {}
  dispose(): void {}
}

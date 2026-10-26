import { decodeHeight } from './height-encoding';

/**
 * Ground-truth occlusion for the isometric view (src/render/docs.md, "Occlusion model").
 *
 * Every point on one screen pixel's view ray has a distinct world height, so the surface seen at
 * a pixel is the highest of all surfaces covering it. Sprites carry a baked per-pixel height
 * (relative to their anchor) from the mesh they were rasterised from, so compositing placed
 * sprites by `anchorHeight + baked height` is exactly a z-buffer over the placed meshes; ground,
 * water and other analytic surfaces enter as screen-space triangles with per-vertex heights.
 *
 * The result is an object-ID image used to score the renderers; it does not depend on any painter
 * key.
 */
export const NO_OBJECT = 0;

/** RGBA texels of one atlas page and of its height page (see height-encoding.ts). */
export interface OraclePage {
  width: number;
  height: number;
  colour: Uint8ClampedArray;
  heights: Uint8ClampedArray;
}

/** A sprite drawn into a screen-space rectangle, sampled like the WebGL2 renderer samples it. */
export interface OracleSprite {
  id: number;
  page: number;
  frame: { x: number; y: number; width: number; height: number };
  left: number;
  top: number;
  width: number;
  height: number;
  /** World height of the sprite anchor, in levels. */
  anchorHeight: number;
  /** Drawn height over frame height: baked heights scale with the sprite. */
  heightScale: number;
}

export interface OracleVertex {
  x: number;
  y: number;
  /** World height in levels. */
  height: number;
}

export interface OracleTriangle {
  id: number;
  a: OracleVertex;
  b: OracleVertex;
  c: OracleVertex;
}

export interface OracleScene {
  width: number;
  height: number;
  pages: readonly OraclePage[];
  sprites: readonly OracleSprite[];
  triangles: readonly OracleTriangle[];
}

export interface OracleResult {
  /** Winning object per pixel, `NO_OBJECT` where nothing is drawn. */
  ids: Int32Array;
  /** Height of the winning surface per pixel, -Infinity where nothing is drawn. */
  heights: Float32Array;
}

/** Minimum atlas alpha that counts as covered, matching the renderers' alpha cut-off. */
export const COVERAGE_ALPHA = 128;

/**
 * Atlas texel a sprite samples at the screen pixel whose centre is (sx, sy), or -1 when the pixel
 * centre is outside the sprite's rectangle. Mirrors the half-texel inset of the WebGL2 renderer.
 */
export function spriteTexel(
  sprite: OracleSprite,
  pageWidth: number,
  sx: number,
  sy: number,
): number {
  const fx = (sx - sprite.left) / sprite.width;
  const fy = (sy - sprite.top) / sprite.height;
  if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return -1;
  const { frame } = sprite;
  const tx = frame.x + Math.floor(0.5 + fx * (frame.width - 1));
  const ty = frame.y + Math.floor(0.5 + fy * (frame.height - 1));
  return ty * pageWidth + tx;
}

/** Height of `sprite`'s surface at the screen pixel centre (sx, sy), or NaN where it is clear. */
export function spriteHeightAt(
  sprite: OracleSprite,
  page: OraclePage,
  sx: number,
  sy: number,
): number {
  const texel = spriteTexel(sprite, page.width, sx, sy);
  if (texel < 0 || page.colour[texel * 4 + 3] < COVERAGE_ALPHA) return NaN;
  const at = texel * 4;
  if (page.heights[at + 3] === 0) return NaN;
  return (
    sprite.anchorHeight + decodeHeight(page.heights[at], page.heights[at + 1]) * sprite.heightScale
  );
}

/** Height of a triangle's surface at (sx, sy), or NaN outside it. */
export function triangleHeightAt(t: OracleTriangle, sx: number, sy: number): number {
  const { a, b, c } = t;
  const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(area) < 1e-9) return NaN;
  const w0 = ((b.x - sx) * (c.y - sy) - (b.y - sy) * (c.x - sx)) / area;
  const w1 = ((c.x - sx) * (a.y - sy) - (c.y - sy) * (a.x - sx)) / area;
  const w2 = 1 - w0 - w1;
  if (w0 < 0 || w1 < 0 || w2 < 0) return NaN;
  return w0 * a.height + w1 * b.height + w2 * c.height;
}

/**
 * Composites the scene: per pixel, the highest surface wins; between equal heights the later
 * entry wins (triangles come before sprites).
 */
export function compositeScene(scene: OracleScene): OracleResult {
  const { width, height } = scene;
  const ids = new Int32Array(width * height);
  const heights = new Float32Array(width * height).fill(-Infinity);
  const write = (px: number, py: number, h: number, id: number): void => {
    const at = py * width + px;
    if (h >= heights[at]) {
      heights[at] = h;
      ids[at] = id;
    }
  };
  for (const t of scene.triangles) {
    const x0 = Math.max(0, Math.floor(Math.min(t.a.x, t.b.x, t.c.x)));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(t.a.x, t.b.x, t.c.x)));
    const y0 = Math.max(0, Math.floor(Math.min(t.a.y, t.b.y, t.c.y)));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(t.a.y, t.b.y, t.c.y)));
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const h = triangleHeightAt(t, px + 0.5, py + 0.5);
        if (!Number.isNaN(h)) write(px, py, h, t.id);
      }
  }
  for (const sprite of scene.sprites) {
    const page = scene.pages[sprite.page];
    if (!page) continue;
    const x0 = Math.max(0, Math.floor(sprite.left));
    const x1 = Math.min(width - 1, Math.ceil(sprite.left + sprite.width));
    const y0 = Math.max(0, Math.floor(sprite.top));
    const y1 = Math.min(height - 1, Math.ceil(sprite.top + sprite.height));
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const h = spriteHeightAt(sprite, page, px + 0.5, py + 0.5);
        if (!Number.isNaN(h)) write(px, py, h, sprite.id);
      }
  }
  return { ids, heights };
}

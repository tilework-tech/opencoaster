import { decodeHeight } from './height-encoding';
import { COVERAGE_ALPHA } from './occlusion-oracle';
import type { OraclePage, OracleSprite, OracleTriangle } from './occlusion-oracle';
import type { PageFrame } from './sprite-pages';

/**
 * Software per-pixel depth for the Canvas2D renderer (src/render/docs.md, "Occlusion model").
 * Every surface keeps the highest world height seen at each backing pixel, exactly as the WebGL2
 * depth test and the occlusion oracle do: ground and water enter as triangles with per-vertex
 * heights, sprites as their anchor height plus the baked height map of their atlas frame.
 */

/** One atlas frame's texels: packed RGBA (canvas byte order) and decoded heights. */
export interface CompositeFrame {
  width: number;
  height: number;
  colour: Uint32Array;
  /** Height above the anchor in levels; NaN where the texel is not covered. */
  heights: Float32Array;
}

/** Cuts `frame` out of a decoded atlas page and its height page. */
export function compositeFrame(
  page: OraclePage,
  frame: Pick<PageFrame, 'x' | 'y' | 'width' | 'height'>,
): CompositeFrame {
  const { width, height } = frame;
  const colour = new Uint32Array(width * height);
  const heights = new Float32Array(width * height).fill(NaN);
  const pageColour = new Uint32Array(
    page.colour.buffer,
    page.colour.byteOffset,
    page.colour.length / 4,
  );
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const texel = (frame.y + y) * page.width + frame.x + x;
      const at = y * width + x;
      colour[at] = pageColour[texel];
      const h = texel * 4;
      if (page.colour[h + 3] >= COVERAGE_ALPHA && page.heights[h + 3] !== 0)
        heights[at] = decodeHeight(page.heights[h], page.heights[h + 1]);
    }
  return { width, height, colour, heights };
}

/** Where a sprite lands: its backing-pixel rectangle, anchor height and baked-height scale. */
export type CompositePlacement = Pick<
  OracleSprite,
  'id' | 'left' | 'top' | 'width' | 'height' | 'anchorHeight' | 'heightScale'
>;

/** Widens `span` to where the row through `sy` crosses the edge p-q, if it does. */
function crossRow(
  p: OracleTriangle['a'],
  q: OracleTriangle['a'],
  sy: number,
  span: Float64Array,
): void {
  if ((sy < p.y && sy < q.y) || (sy > p.y && sy > q.y)) return;
  if (p.y === q.y) {
    span[0] = Math.min(span[0], p.x, q.x);
    span[1] = Math.max(span[1], p.x, q.x);
    return;
  }
  const x = p.x + ((sy - p.y) * (q.x - p.x)) / (q.y - p.y);
  span[0] = Math.min(span[0], x);
  span[1] = Math.max(span[1], x);
}

export class DepthComposite {
  width = 0;
  height = 0;
  /** World height of the nearest surface per pixel, -Infinity where only background shows. */
  heights = new Float32Array(0);
  /** Object id per pixel when recording ids, else null. */
  ids: Int32Array | null = null;
  private colour: Uint32Array<ArrayBufferLike> = new Uint32Array(0);
  private bytes: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(0);
  private columns = new Int32Array(0);
  /** Left and right ends of the row span being rasterised. */
  private readonly span = new Float64Array(2);

  /**
   * Starts a frame over `pixels` (RGBA, row-major, `width` x `height`), which already holds the
   * painted ground; sprites are composited into it in place.
   */
  begin(width: number, height: number, pixels: Uint8ClampedArray, recordIds: boolean): void {
    this.width = width;
    this.height = height;
    this.bytes = pixels;
    this.colour = new Uint32Array(pixels.buffer, pixels.byteOffset, width * height);
    if (this.heights.length !== width * height) this.heights = new Float32Array(width * height);
    this.heights.fill(-Infinity);
    this.ids = recordIds ? new Int32Array(width * height) : null;
  }

  /**
   * Rasterises ground and water: each pixel keeps the highest triangle covering its centre. Height
   * is affine in screen space over a triangle, so each row is one span with a constant step.
   */
  ground(triangles: readonly OracleTriangle[]): void {
    const { width, height, heights, ids } = this;
    for (const t of triangles) {
      const { a, b, c } = t;
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(area) < 1e-9) continue;
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
      const y1 = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
      if (y1 < y0) continue;
      const minX = Math.min(a.x, b.x, c.x);
      const maxX = Math.max(a.x, b.x, c.x);
      if (maxX < 0 || minX > width) continue;
      // h = gx * x + gy * y + h0 over the triangle's plane.
      const gx = ((b.height - a.height) * (c.y - a.y) - (c.height - a.height) * (b.y - a.y)) / area;
      const gy = ((c.height - a.height) * (b.x - a.x) - (b.height - a.height) * (c.x - a.x)) / area;
      const h0 = a.height - gx * a.x - gy * a.y;
      const span = this.span;
      for (let py = y0; py <= y1; py++) {
        const sy = py + 0.5;
        span[0] = Infinity;
        span[1] = -Infinity;
        crossRow(a, b, sy, span);
        crossRow(b, c, sy, span);
        crossRow(c, a, sy, span);
        const x0 = Math.max(0, Math.ceil(span[0] - 0.5));
        const x1 = Math.min(width - 1, Math.floor(span[1] - 0.5));
        let h = gx * (x0 + 0.5) + gy * sy + h0;
        const line = py * width;
        for (let px = x0; px <= x1; px++, h += gx) {
          const at = line + px;
          if (h < heights[at]) continue;
          heights[at] = h;
          if (ids) ids[at] = t.id;
        }
      }
    }
  }

  /** Copies the current per-pixel heights (and ids) so an unchanged view can restore them. */
  saveGround(): { heights: Float32Array; ids: Int32Array | null } {
    return { heights: this.heights.slice(), ids: this.ids?.slice() ?? null };
  }

  /** Restores heights saved by `saveGround` for the same view. */
  restoreGround(saved: { heights: Float32Array; ids: Int32Array | null }): void {
    this.heights.set(saved.heights);
    if (this.ids && saved.ids) this.ids.set(saved.ids);
  }

  /**
   * Composites one sprite. Texels are sampled like the WebGL2 renderer samples its atlas (nearest
   * texel, half a texel inside the frame). An opaque sprite writes height; a translucent one
   * (`alpha` < 1) is height-tested and blended but hides nothing drawn after it.
   */
  sprite(frame: CompositeFrame, at: CompositePlacement, alpha = 1): void {
    const { width, height, heights, ids, colour } = this;
    const x0 = Math.max(0, Math.floor(at.left));
    const x1 = Math.min(width - 1, Math.ceil(at.left + at.width));
    const y0 = Math.max(0, Math.floor(at.top));
    const y1 = Math.min(height - 1, Math.ceil(at.top + at.height));
    if (x1 < x0 || y1 < y0) return;
    if (this.columns.length < x1 - x0 + 1) this.columns = new Int32Array(x1 - x0 + 1);
    const columns = this.columns;
    for (let px = x0; px <= x1; px++) {
      const fx = (px + 0.5 - at.left) / at.width;
      columns[px - x0] = fx < 0 || fx >= 1 ? -1 : Math.floor(0.5 + fx * (frame.width - 1));
    }
    const opaque = alpha >= 1;
    for (let py = y0; py <= y1; py++) {
      const fy = (py + 0.5 - at.top) / at.height;
      if (fy <= 0 || fy > 1) continue;
      const row = Math.floor(0.5 + fy * (frame.height - 1)) * frame.width;
      const line = py * width;
      for (let px = x0; px <= x1; px++) {
        const column = columns[px - x0];
        if (column < 0) continue;
        const texel = row + column;
        const baked = frame.heights[texel];
        if (baked !== baked) continue;
        const h = at.anchorHeight + baked * at.heightScale;
        const pixel = line + px;
        if (h < heights[pixel]) continue;
        const source = frame.colour[texel];
        const sourceAlpha = ((source >>> 24) / 255) * alpha;
        if (sourceAlpha >= 1) colour[pixel] = source;
        else this.blend(pixel, source, sourceAlpha);
        if (!opaque) continue;
        heights[pixel] = h;
        if (ids) ids[pixel] = at.id;
      }
    }
  }

  private blend(pixel: number, source: number, alpha: number): void {
    const bytes = this.bytes;
    const at = pixel * 4;
    const keep = 1 - alpha;
    bytes[at] = (source & 255) * alpha + bytes[at] * keep;
    bytes[at + 1] = ((source >>> 8) & 255) * alpha + bytes[at + 1] * keep;
    bytes[at + 2] = ((source >>> 16) & 255) * alpha + bytes[at + 2] * keep;
    bytes[at + 3] = 255;
  }
}

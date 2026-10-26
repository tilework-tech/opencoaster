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

  /** Rasterises ground and water: each pixel keeps the highest triangle covering its centre. */
  ground(triangles: readonly OracleTriangle[]): void {
    const { width, height, heights, ids } = this;
    for (const t of triangles) {
      const { a, b, c } = t;
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(area) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
      const x1 = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
      const y1 = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
      for (let py = y0; py <= y1; py++) {
        const sy = py + 0.5;
        for (let px = x0; px <= x1; px++) {
          const sx = px + 0.5;
          const w0 = ((b.x - sx) * (c.y - sy) - (b.y - sy) * (c.x - sx)) / area;
          const w1 = ((c.x - sx) * (a.y - sy) - (c.y - sy) * (a.x - sx)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const h = w0 * a.height + w1 * b.height + w2 * c.height;
          const at = py * width + px;
          if (h < heights[at]) continue;
          heights[at] = h;
          if (ids) ids[at] = t.id;
        }
      }
    }
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
      if (fy < 0 || fy >= 1) continue;
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

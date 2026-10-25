import { OUTLINE, RAMP_LEVELS } from './palette';
import type { Mesh, Vec3 } from './mesh';

/** Index in `Sprite.pixels` for pixels that are not drawn. */
export const TRANSPARENT = 255;

export const TILE_W = 64;
export const TILE_H = 32;
/** Screen pixels per height level (matches Z_PIXELS in src/render/projection.ts). */
export const LEVEL_PX = 16;

/** Direction towards the light, in model space: upper left as seen on screen. */
const LIGHT: Vec3 = (() => {
  const v: Vec3 = [-0.35, 0.55, 0.75];
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
})();
const AMBIENT = 0.3;

export interface Sprite {
  width: number;
  height: number;
  /** Pixel of the model origin: bottom-centre convention used by the atlas manifest. */
  anchor: { x: number; y: number };
  /** Palette indices, row-major; `TRANSPARENT` where nothing is drawn. */
  pixels: Uint8Array;
}

export interface RenderOptions {
  outline?: boolean;
}

/** Exact 2:1 dimetric orthographic projection: one tile is a 64x32 diamond, one level 16px. */
export function project(x: number, y: number, z: number): [number, number] {
  return [(x - y) * (TILE_W / 2), (x + y) * (TILE_H / 2) - z * LEVEL_PX];
}

/** Larger values are nearer the camera, which looks along (-1, -1, -2). */
function depthOf(p: Vec3): number {
  return p[0] + p[1] + 2 * p[2];
}

function lightLevel(a: Vec3, b: Vec3, c: Vec3): number {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  nx /= length;
  ny /= length;
  nz /= length;
  if (nx + ny + 2 * nz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
  return Math.min(RAMP_LEVELS - 1, Math.floor((AMBIENT + (1 - AMBIENT) * lambert) * RAMP_LEVELS));
}

/** Renders a mesh with a z-buffer, flat directional light and no anti-aliasing. */
export function renderMesh(mesh: Mesh, options: RenderOptions = {}): Sprite {
  const margin = options.outline === false ? 0 : 1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const projected = mesh.map((t) =>
    t.v.map((p) => {
      const s = project(p[0], p[1], p[2]);
      minX = Math.min(minX, s[0]);
      maxX = Math.max(maxX, s[0]);
      minY = Math.min(minY, s[1]);
      maxY = Math.max(maxY, s[1]);
      return s;
    }),
  );
  let left = Math.floor(minX) - margin;
  const right = Math.ceil(maxX) + margin;
  let top = Math.floor(minY) - margin;
  const bottom = Math.ceil(maxY) + margin;
  // Even width with the origin on the centre column, even height.
  const half = Math.max(-left, right);
  left = -half;
  if ((bottom - top) % 2 !== 0) top -= 1;
  const width = half * 2;
  const height = bottom - top;
  const pixels = new Uint8Array(width * height).fill(TRANSPARENT);
  const depth = new Float32Array(width * height).fill(-Infinity);

  mesh.forEach((tri, index) => {
    const [pa, pb, pc] = projected[index];
    const area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
    if (Math.abs(area) < 1e-9) return;
    const level = Math.max(
      0,
      Math.min(
        RAMP_LEVELS - 1,
        (tri.material.fixedLevel ?? lightLevel(tri.v[0], tri.v[1], tri.v[2])) +
          (tri.material.levelBias ?? 0),
      ),
    );
    const x0 = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0]) - left));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(pa[0], pb[0], pc[0]) - left));
    const y0 = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1]) - top));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(pa[1], pb[1], pc[1]) - top));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const sx = px + 0.5 + left;
        const sy = py + 0.5 + top;
        const w0 = ((pb[0] - sx) * (pc[1] - sy) - (pb[1] - sy) * (pc[0] - sx)) / area;
        const w1 = ((pc[0] - sx) * (pa[1] - sy) - (pc[1] - sy) * (pa[0] - sx)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const p: Vec3 = [
          w0 * tri.v[0][0] + w1 * tri.v[1][0] + w2 * tri.v[2][0],
          w0 * tri.v[0][1] + w1 * tri.v[1][1] + w2 * tri.v[2][1],
          w0 * tri.v[0][2] + w1 * tri.v[1][2] + w2 * tri.v[2][2],
        ];
        const d = depthOf(p);
        const at = py * width + px;
        if (d <= depth[at] + 1e-6) continue;
        depth[at] = d;
        pixels[at] = tri.material.shader
          ? tri.material.shader(p, level)
          : tri.material.ramp[Math.min(level, tri.material.ramp.length - 1)];
      }
    }
  });

  if (margin > 0) addOutline(pixels, width, height);
  return { width, height, anchor: { x: half, y: -top }, pixels };
}

function addOutline(pixels: Uint8Array, width: number, height: number): void {
  const source = pixels.slice();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (source[y * width + x] !== TRANSPARENT) continue;
      const touches =
        (x > 0 && source[y * width + x - 1] !== TRANSPARENT) ||
        (x < width - 1 && source[y * width + x + 1] !== TRANSPARENT) ||
        (y > 0 && source[(y - 1) * width + x] !== TRANSPARENT) ||
        (y < height - 1 && source[(y + 1) * width + x] !== TRANSPARENT);
      if (touches) pixels[y * width + x] = OUTLINE;
    }
  }
}

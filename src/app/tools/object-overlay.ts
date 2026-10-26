import type { ObjectPickTarget } from '../../input/object-picking';
import { TILE_W } from '../../render/projection';

const OUTLINE_RGB = [255, 228, 107] as const;

/** How far a held person is raised above the ground, as a fraction of tile width. */
const LIFT_TILE_FRACTION = 0.25;

export function heldLiftPixels(zoom: number): number {
  return TILE_W * LIFT_TILE_FRACTION * zoom;
}

/**
 * Paints a sprite's silhouette onto `canvas`: a bright outline one source pixel outside the
 * visible pixels plus a light tint over them, sized to the target's on-screen box.
 */
export function drawSpriteOutline(canvas: HTMLCanvasElement, target: ObjectPickTarget): void {
  const { alphaWidth: w, alphaHeight: h, alpha } = target;
  const scale = target.width / w;
  const pad = Math.max(1, Math.round(2 / scale));
  const outW = w + pad * 2;
  const outH = h + pad * 2;
  const mask = document.createElement('canvas');
  mask.width = outW;
  mask.height = outH;
  const maskContext = mask.getContext('2d')!;
  const image = maskContext.createImageData(outW, outH);
  const solid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && alpha[y * w + x]! > 0;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const sx = x - pad;
      const sy = y - pad;
      let a = 0;
      let tint = false;
      if (solid(sx, sy)) {
        a = 70;
        tint = true;
      } else {
        for (let dy = -pad; dy <= pad && !a; dy++)
          for (let dx = -pad; dx <= pad; dx++)
            if (dx * dx + dy * dy <= pad * pad && solid(sx + dx, sy + dy)) {
              a = 255;
              break;
            }
      }
      if (!a) continue;
      const o = (y * outW + x) * 4;
      image.data[o] = OUTLINE_RGB[0];
      image.data[o + 1] = OUTLINE_RGB[1];
      image.data[o + 2] = OUTLINE_RGB[2];
      image.data[o + 3] = tint ? a : 255;
    }
  }
  maskContext.putImageData(image, 0, 0);
  canvas.width = Math.round(outW * scale);
  canvas.height = Math.round(outH * scale);
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(mask, 0, 0, canvas.width, canvas.height);
  canvas.dataset.padX = String(pad * scale);
  canvas.dataset.padY = String(pad * scale);
}

/** Redraws a picked person's atlas sprite onto `canvas` at its on-screen size. */
export function drawHeldSprite(canvas: HTMLCanvasElement, target: ObjectPickTarget): boolean {
  const source = target.source;
  if (!source) return false;
  canvas.width = Math.max(1, Math.round(target.width));
  canvas.height = Math.max(1, Math.round(target.height));
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    source.image,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return true;
}

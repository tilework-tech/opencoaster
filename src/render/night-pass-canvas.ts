import {
  LAMP_HEAD_COLOUR,
  LAMP_HEAD_CORE,
  LAMP_HEAD_HALO,
  LAMP_HEAD_HEIGHT,
  LAMP_LIGHT_COLOUR,
  POOL_BANDS,
  POOL_RADIUS_X,
  POOL_RADIUS_Y,
  ambientTint,
} from './night-lighting';
import type { LampLightBuffer } from './night-lighting';

/**
 * Canvas2D night pass: multiplies the finished scene by the ambient tint, then adds one light-pool
 * sprite per lamp and the lit lamp heads. The pool sprite is a small CPU-backed canvas rebuilt only
 * when the scale changes, so a frame never reads a large offscreen canvas back into the scene.
 */
export class CanvasNightPass {
  private poolSprite: HTMLCanvasElement | null = null;
  private poolScale = 0;

  /**
   * Draws over the whole canvas in backing-pixel space. `lampCount` lamps are read from `lights`,
   * positioned in viewport pixels; `zoom` times `dpr` scales every light.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    darkness: number,
    lights: LampLightBuffer,
    lampCount: number,
    zoom: number,
    dpr: number,
  ): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (darkness > 0) {
      const [r, g, b] = ambientTint(darkness);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    if (lampCount > 0) this.drawLamps(ctx, lights, lampCount, zoom * dpr, dpr);
    ctx.restore();
  }

  private drawLamps(
    ctx: CanvasRenderingContext2D,
    lights: LampLightBuffer,
    lampCount: number,
    scale: number,
    dpr: number,
  ): void {
    const sprite = this.poolSpriteFor(scale);
    const halfWidth = sprite.width >> 1;
    const halfHeight = sprite.height >> 1;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < lampCount; i++)
      ctx.drawImage(
        sprite,
        Math.round(lights.data[i * 2]! * dpr) - halfWidth,
        Math.round(lights.data[i * 2 + 1]! * dpr) - halfHeight,
      );
    this.drawHeads(ctx, lights, lampCount, scale, dpr);
  }

  /** One lamp's banded pool: each pixel holds the lamp colour at the strength of its ring. */
  private poolSpriteFor(scale: number): HTMLCanvasElement {
    if (this.poolSprite && this.poolScale === scale) return this.poolSprite;
    const width = Math.max(2, Math.ceil(POOL_RADIUS_X * scale) * 2);
    const height = Math.max(2, Math.ceil(POOL_RADIUS_Y * scale) * 2);
    const canvas = this.poolSprite ?? document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas2D light-pool context is unavailable');
    const image = ctx.createImageData(width, height);
    const [lr, lg, lb] = LAMP_LIGHT_COLOUR;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const radius = Math.hypot((x + 0.5) / (width / 2) - 1, (y + 0.5) / (height / 2) - 1);
        const band = POOL_BANDS.find(([edge]) => radius <= edge);
        if (!band) continue;
        const at = (y * width + x) * 4;
        image.data[at] = Math.round(lr * band[1]);
        image.data[at + 1] = Math.round(lg * band[1]);
        image.data[at + 2] = Math.round(lb * band[1]);
        image.data[at + 3] = 255;
      }
    ctx.putImageData(image, 0, 0);
    this.poolSprite = canvas;
    this.poolScale = scale;
    return canvas;
  }

  private drawHeads(
    ctx: CanvasRenderingContext2D,
    lights: LampLightBuffer,
    lampCount: number,
    scale: number,
    dpr: number,
  ): void {
    const halo = Math.max(1, Math.round(LAMP_HEAD_HALO * scale));
    const core = Math.max(1, Math.round(LAMP_HEAD_CORE * scale));
    const lift = LAMP_HEAD_HEIGHT * scale;
    ctx.fillStyle = `rgba(${LAMP_LIGHT_COLOUR.join(',')},0.35)`;
    for (let i = 0; i < lampCount; i++)
      ctx.fillRect(
        Math.round(lights.data[i * 2]! * dpr) - (halo >> 1),
        Math.round(lights.data[i * 2 + 1]! * dpr - lift) - (halo >> 1),
        halo,
        halo,
      );
    ctx.fillStyle = `rgb(${LAMP_HEAD_COLOUR.join(',')})`;
    for (let i = 0; i < lampCount; i++)
      ctx.fillRect(
        Math.round(lights.data[i * 2]! * dpr) - (core >> 1),
        Math.round(lights.data[i * 2 + 1]! * dpr - lift) - (core >> 1),
        core,
        core,
      );
  }
}

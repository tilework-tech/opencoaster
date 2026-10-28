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

/** Canvas2D night pass: dims the finished scene, then adds lamp pools and lit lamp heads. */
export class CanvasNightPass {
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
    if (darkness > 0) {
      const [r, g, b] = ambientTint(darkness);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    if (lampCount > 0) this.drawLamps(ctx, lights, lampCount, zoom * dpr, dpr);
    ctx.restore();
  }

  /**
   * Each pool ring is one path over every lamp, so a ring costs a single fill however many lamps
   * there are; where pools overlap the light does not add up twice.
   */
  private drawLamps(
    ctx: CanvasRenderingContext2D,
    lights: LampLightBuffer,
    lampCount: number,
    scale: number,
    dpr: number,
  ): void {
    ctx.globalCompositeOperation = 'lighter';
    const [lr, lg, lb] = LAMP_LIGHT_COLOUR;
    for (let band = POOL_BANDS.length - 1; band >= 0; band--) {
      const [edge, strength] = POOL_BANDS[band]!;
      const next = POOL_BANDS[band + 1]?.[1] ?? 0;
      const step = strength - next;
      ctx.fillStyle = `rgb(${Math.round(lr * step)},${Math.round(lg * step)},${Math.round(lb * step)})`;
      const radiusX = POOL_RADIUS_X * edge * scale;
      const radiusY = POOL_RADIUS_Y * edge * scale;
      ctx.beginPath();
      for (let i = 0; i < lampCount; i++) {
        const x = Math.round(lights.data[i * 2]! * dpr);
        const y = Math.round(lights.data[i * 2 + 1]! * dpr);
        ctx.moveTo(x + radiusX, y);
        ctx.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
      }
      ctx.fill();
    }
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

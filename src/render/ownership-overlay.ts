import { OWNED, RIGHTS_OWNED, SALE_LAND, SALE_RIGHTS } from '../sim/map/tile-map';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import type { Camera, MapData } from './renderer';
import { project } from './projection';

/** Draws parcel state over terrain without changing the ground textures or tile cache. */
export class OwnershipOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly point = new Float64Array(2);
  private width = 1;
  private height = 1;
  private dpr = 1;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ownership-overlay';
    this.canvas.setAttribute('aria-hidden', 'true');
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('2D ownership overlay unavailable');
    this.context = context;
    parent.append(this.canvas);
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  draw(map: MapData, camera: Camera): void {
    const ctx = this.context;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const flags = map.ownership;
    if (!flags) return;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const index = y * map.width + x;
        const ownership = flags[index];
        if (ownership & (OWNED | RIGHTS_OWNED)) continue;
        const z = (map.heights[index] ?? 0) * Z_STEP;
        ctx.beginPath();
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ] as const) {
          project(
            (x + dx) * TILE_UNITS,
            (y + dy) * TILE_UNITS,
            z,
            map.width,
            map.height,
            camera.rotation,
            this.point,
          );
          const sx = this.width / 2 + (this.point[0] - camera.x) * camera.zoom;
          const sy = this.height / 2 + (this.point[1] - camera.y) * camera.zoom;
          if (dx === 0 && dy === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(20, 23, 27, 0.24)';
        ctx.fill();
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(35, 38, 42, 0.75)';
        ctx.stroke();
        ctx.setLineDash([]);
        if (ownership & (SALE_LAND | SALE_RIGHTS)) this.drawSaleMarker(ctx, x, y, z, map, camera);
      }
    }
  }

  dispose(): void {
    this.canvas.remove();
  }

  private drawSaleMarker(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    z: number,
    map: MapData,
    camera: Camera,
  ): void {
    project(
      (x + 0.5) * TILE_UNITS,
      (y + 0.5) * TILE_UNITS,
      z,
      map.width,
      map.height,
      camera.rotation,
      this.point,
    );
    const sx = this.width / 2 + (this.point[0] - camera.x) * camera.zoom;
    const sy = this.height / 2 + (this.point[1] - camera.y) * camera.zoom - 5;
    ctx.fillStyle = map.ownership?.[y * map.width + x]! & SALE_RIGHTS ? '#4d91d0' : '#f7f0c8';
    ctx.fillRect(sx - 3, sy - 5, 6, 7);
    ctx.strokeStyle = '#393a34';
    ctx.strokeRect(sx - 3, sy - 5, 6, 7);
  }
}

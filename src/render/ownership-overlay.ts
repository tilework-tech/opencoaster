import { OWNED, SALE_LAND, SALE_RIGHTS } from '../sim/map/tile-map';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import type { Camera, MapData } from './renderer';
import { project } from './projection';
import { terrainTileCorners } from './terrain-geometry';

/** Draws parcel state over terrain without changing the ground textures or tile cache. */
export class OwnershipOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly point = new Float64Array(2);
  private readonly corners = new Float64Array(8);
  private width = 1;
  private height = 1;
  private dpr = 1;
  private lastMap: MapData | null = null;
  private lastCamera: Pick<Camera, 'x' | 'y' | 'zoom' | 'rotation'> | null = null;

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
    if (width !== this.width || height !== this.height || dpr !== this.dpr) this.lastMap = null;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  draw(map: MapData, camera: Camera): void {
    const previous = this.lastCamera;
    if (
      this.lastMap === map &&
      previous?.x === camera.x &&
      previous.y === camera.y &&
      previous.zoom === camera.zoom &&
      previous.rotation === camera.rotation
    )
      return;
    const ctx = this.context;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const flags = map.ownership;
    if (!flags) {
      this.rememberDraw(map, camera);
      return;
    }
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const index = y * map.width + x;
        const ownership = flags[index];
        if (ownership & OWNED) continue;
        this.projectTile(x, y, map, camera);
        ctx.beginPath();
        this.traceTile(ctx);
        ctx.closePath();
        ctx.fillStyle = 'rgba(10, 14, 10, 0.58)';
        ctx.fill();
        if (ownership & (SALE_LAND | SALE_RIGHTS))
          this.drawSaleBorders(ctx, ownership, flags, map, x, y);
      }
    }
    this.drawParkFence(flags, map, camera);
    this.rememberDraw(map, camera);
  }

  dispose(): void {
    this.canvas.remove();
  }

  private drawSaleBorders(
    ctx: CanvasRenderingContext2D,
    ownership: number,
    flags: Uint8Array,
    map: MapData,
    x: number,
    y: number,
  ): void {
    const saleType = this.saleType(ownership);
    const directions = [
      [1, 0, 1, 2],
      [0, 1, 2, 3],
      [-1, 0, 3, 0],
      [0, -1, 0, 1],
    ] as const;
    for (const [dx, dy, from, to] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      const neighbor =
        nx >= 0 && ny >= 0 && nx < map.width && ny < map.height
          ? this.saleType(flags[ny * map.width + nx] ?? 0)
          : 0;
      if (neighbor === saleType || (neighbor !== 0 && neighbor < saleType)) continue;
      ctx.beginPath();
      ctx.moveTo(this.corners[from * 2]!, this.corners[from * 2 + 1]!);
      ctx.lineTo(this.corners[to * 2]!, this.corners[to * 2 + 1]!);
      ctx.lineWidth = 2.5;
      ctx.lineDashOffset = 0;
      if (saleType === 3) {
        ctx.setLineDash([1, 4]);
        ctx.strokeStyle = '#f3ce57';
      } else if (saleType === SALE_LAND) {
        ctx.setLineDash([5, 3]);
        ctx.strokeStyle = '#f3ce57';
      } else {
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = '#63c3e8';
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private saleType(ownership: number): number {
    const landForSale = (ownership & SALE_LAND) !== 0;
    const rightsForSale = (ownership & SALE_RIGHTS) !== 0;
    if (landForSale && rightsForSale) return 3;
    if (landForSale) return SALE_LAND;
    if (rightsForSale) return SALE_RIGHTS;
    return 0;
  }

  private drawParkFence(flags: Uint8Array, map: MapData, camera: Camera): void {
    const ctx = this.context;
    const directions = [
      [1, 0, 1, 2],
      [0, 1, 2, 3],
      [-1, 0, 3, 0],
      [0, -1, 0, 1],
    ] as const;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const index = y * map.width + x;
        if (!(flags[index] & OWNED)) continue;
        this.projectTile(x, y, map, camera);
        for (const [dx, dy, from, to] of directions) {
          const nx = x + dx;
          const ny = y + dy;
          if (
            nx >= 0 &&
            ny >= 0 &&
            nx < map.width &&
            ny < map.height &&
            flags[ny * map.width + nx] & OWNED
          )
            continue;
          const x1 = this.corners[from * 2];
          const y1 = this.corners[from * 2 + 1];
          const x2 = this.corners[to * 2];
          const y2 = this.corners[to * 2 + 1];
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.lineWidth = 4;
          ctx.strokeStyle = '#443019';
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x1, y1 - 2);
          ctx.lineTo(x2, y2 - 2);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#c6a661';
          ctx.stroke();
          for (const [px, py] of [
            [x1, y1],
            [x2, y2],
          ]) {
            ctx.fillStyle = '#4a3420';
            ctx.fillRect(px - 2, py - 3, 4, 6);
            ctx.fillStyle = '#e0c17c';
            ctx.fillRect(px - 1, py - 3, 2, 2);
          }
        }
      }
    }
  }

  private projectTile(x: number, y: number, map: MapData, camera: Camera): void {
    const tileIndex = y * map.width + x;
    const corners = terrainTileCorners(
      x,
      y,
      map.heights[tileIndex] ?? 0,
      map.slope?.[tileIndex] ?? 0,
    );
    for (const [index, corner] of corners.entries()) {
      project(
        corner.x * TILE_UNITS,
        corner.y * TILE_UNITS,
        corner.height * Z_STEP,
        map.width,
        map.height,
        camera.rotation,
        this.point,
      );
      this.corners[index * 2] = this.width / 2 + (this.point[0] - camera.x) * camera.zoom;
      this.corners[index * 2 + 1] = this.height / 2 + (this.point[1] - camera.y) * camera.zoom;
    }
  }

  private traceTile(ctx: CanvasRenderingContext2D): void {
    ctx.moveTo(this.corners[0], this.corners[1]);
    for (let index = 1; index < 4; index++)
      ctx.lineTo(this.corners[index * 2], this.corners[index * 2 + 1]);
  }

  private rememberDraw(map: MapData, camera: Camera): void {
    this.lastMap = map;
    this.lastCamera = {
      x: camera.x,
      y: camera.y,
      zoom: camera.zoom,
      rotation: camera.rotation,
    };
  }
}

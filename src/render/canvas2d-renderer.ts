import type { Camera, MapData, Renderer } from './renderer';
import { TILE_H, TILE_W, Z_PIXELS, project, unrotateTile, viewSize } from './projection';
import { SNAPSHOT_STRIDE } from '../worker/snapshot';
import type { Snapshot, SnapshotLayer } from '../worker/snapshot';

const SURFACE_COLORS = [
  '#5aa24a',
  '#d9c98a',
  '#3f7fbf',
  '#8a8a8a',
  '#8b6b43',
  '#77716b',
  '#b08a8a',
];
const GUEST_TINTS = [
  '#e63946',
  '#f1c40f',
  '#2ecc71',
  '#3498db',
  '#9b59b6',
  '#ecf0f1',
  '#e67e22',
  '#1abc9c',
];

/** Flat-colour tiles + dots. Placeholder art only; exists to exercise the data path. */
export class Canvas2DRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D | null = null;
  private map: MapData | null = null;
  private cw = 1;
  private ch = 1;
  private readonly tmp = new Float64Array(2);

  attach(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  resize(width: number, height: number, dpr: number): void {
    this.cw = width * dpr;
    this.ch = height * dpr;
    const c = this.ctx?.canvas;
    if (c) {
      c.width = this.cw;
      c.height = this.ch;
    }
  }

  setMap(map: MapData): void {
    this.map = map;
  }

  draw(snapshot: Snapshot | null, cam: Camera): void {
    const ctx = this.ctx;
    const map = this.map;
    if (!ctx) return;
    ctx.fillStyle = '#10151b';
    ctx.fillRect(0, 0, this.cw, this.ch);
    if (!map) return;

    const z = cam.zoom;
    ctx.setTransform(z, 0, 0, z, this.cw / 2 - cam.x * z, this.ch / 2 - cam.y * z);
    this.drawTiles(ctx, map, cam);
    if (snapshot) {
      this.drawLayer(ctx, snapshot.litter, map, cam, 2, '#6b4f2a');
      this.drawLayer(ctx, snapshot.vehicles, map, cam, 4, '#c0392b');
      this.drawLayer(ctx, snapshot.staff, map, cam, 3, '#f39c12');
      this.drawGuests(ctx, snapshot.guests, map, cam);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawTiles(ctx: CanvasRenderingContext2D, map: MapData, cam: Camera): void {
    const [vw, vh] = viewSize(map.width, map.height, cam.rotation);
    const z = cam.zoom;
    const minX = cam.x - this.cw / 2 / z - TILE_W;
    const maxX = cam.x + this.cw / 2 / z + TILE_W;
    const minY = cam.y - this.ch / 2 / z - TILE_H - 32 * Z_PIXELS;
    const maxY = cam.y + this.ch / 2 / z + TILE_H;
    // Painter's order in view space: far (small rx+ry) to near.
    for (let ry = 0; ry < vh; ry++) {
      for (let rx = 0; rx < vw; rx++) {
        const sx = (rx - ry) * (TILE_W / 2);
        const sy = (rx + ry) * (TILE_H / 2);
        if (sx < minX || sx > maxX || sy < minY || sy > maxY) continue;
        const [x, y] = unrotateTile(rx, ry, map.width, map.height, cam.rotation);
        const i = y * map.width + x;
        const lift = map.heights[i] * Z_PIXELS;
        // View-space top/right/bottom/left vertices are tile corners starting at (4 - rot) & 3.
        const top = (4 - cam.rotation) & 3;
        const mask = map.slope[i];
        const liftTop = lift + ((mask >> top) & 1) * Z_PIXELS;
        const liftRight = lift + ((mask >> ((top + 1) & 3)) & 1) * Z_PIXELS;
        const liftBottom = lift + ((mask >> ((top + 2) & 3)) & 1) * Z_PIXELS;
        const liftLeft = lift + ((mask >> ((top + 3) & 3)) & 1) * Z_PIXELS;
        ctx.fillStyle = SURFACE_COLORS[map.surface[i]] ?? '#f0f';
        ctx.beginPath();
        ctx.moveTo(sx, sy - liftTop);
        ctx.lineTo(sx + TILE_W / 2, sy + TILE_H / 2 - liftRight);
        ctx.lineTo(sx, sy + TILE_H - liftBottom);
        ctx.lineTo(sx - TILE_W / 2, sy + TILE_H / 2 - liftLeft);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  private drawLayer(
    ctx: CanvasRenderingContext2D,
    layer: SnapshotLayer,
    map: MapData,
    cam: Camera,
    r: number,
    color: string,
  ): void {
    ctx.fillStyle = color;
    const d = layer.data;
    const t = this.tmp;
    for (let i = 0, o = 0; i < layer.count; i++, o += SNAPSHOT_STRIDE) {
      project(d[o], d[o + 1], d[o + 2], map.width, map.height, cam.rotation, t);
      ctx.fillRect(t[0] - r, t[1] - r, r * 2, r * 2);
    }
  }

  private drawGuests(
    ctx: CanvasRenderingContext2D,
    layer: SnapshotLayer,
    map: MapData,
    cam: Camera,
  ): void {
    const d = layer.data;
    const t = this.tmp;
    for (let c = 0; c < GUEST_TINTS.length; c++) {
      ctx.fillStyle = GUEST_TINTS[c];
      for (let i = 0, o = 0; i < layer.count; i++, o += SNAPSHOT_STRIDE) {
        if ((d[o + 3] & 0xff) !== c) continue;
        project(d[o], d[o + 1], d[o + 2], map.width, map.height, cam.rotation, t);
        ctx.fillRect(t[0] - 1.5, t[1] - 1.5, 3, 3);
      }
    }
  }

  dispose(): void {
    this.ctx = null;
    this.map = null;
  }
}

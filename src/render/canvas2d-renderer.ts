import type { Camera, MapData, Renderer } from './renderer';
import { TILE_H, TILE_W, Z_PIXELS, project, viewSize } from './projection';
import { SNAPSHOT_STRIDE } from '../worker/snapshot';
import type { Snapshot, SnapshotLayer } from '../worker/snapshot';
import { RideFlag, RideInfo, RIDE_INFO_STRIDE } from '../worker/snapshot';
import { PathFlag } from '../sim/map/tile-map';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import type { RideType } from '../sim/rides/ride-types';
import { rideSpriteFrame, rideSpriteKey } from './sprite-art';

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
const PATH_DX = [1, 0, -1, 0];
const PATH_DY = [0, 1, 0, -1];

interface CanvasRideFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasRideSprite {
  frames: CanvasRideFrame[];
  anchor: { x: number; y: number };
}

interface CanvasRideManifest {
  sprites: Record<string, CanvasRideSprite>;
}

/** Flat-colour tiles + dots. Placeholder art only; exists to exercise the data path. */
export class Canvas2DRenderer implements Renderer {
  readonly backend = 'Canvas2D';
  private ctx: CanvasRenderingContext2D | null = null;
  private map: MapData | null = null;
  private cw = 1;
  private ch = 1;
  private dpr = 1;
  private readonly tmp = new Float64Array(2);
  private readonly pathLow = new Float64Array(2);
  private readonly pathHigh = new Float64Array(2);
  private readonly tile = new Int32Array(2);
  private pathOffsets = new Int32Array(0);
  private pathIndices = new Int32Array(0);
  private visibleCount = 0;
  private rideAtlas: HTMLImageElement | null = null;
  private rideSprites: Record<string, CanvasRideSprite> = {};
  private rideAtlasRequestStarted = false;

  get visibleSpriteCount(): number {
    return this.visibleCount;
  }

  attach(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.loadRideAtlas();
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
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
    const paths = map.pathElements;
    const count = Math.min(map.pathCount ?? 0, paths?.length ? paths.length / 5 : 0);
    this.pathOffsets = new Int32Array(map.width * map.height + 1);
    this.pathIndices = new Int32Array(count);
    if (!paths || count === 0) return;

    for (let i = 0; i < count; i++) {
      const tile = paths[i * 5 + 1] * map.width + paths[i * 5];
      if (tile >= 0 && tile < map.width * map.height) this.pathOffsets[tile + 1]++;
    }
    for (let tile = 1; tile < this.pathOffsets.length; tile++)
      this.pathOffsets[tile] += this.pathOffsets[tile - 1];
    const cursor = this.pathOffsets.slice(0, -1);
    for (let i = 0; i < count; i++) {
      const tile = paths[i * 5 + 1] * map.width + paths[i * 5];
      if (tile >= 0 && tile < map.width * map.height) this.pathIndices[cursor[tile]++] = i;
    }
  }

  draw(snapshot: Snapshot | null, cam: Camera): void {
    const ctx = this.ctx;
    const map = this.map;
    if (!ctx) return;
    this.visibleCount = 0;
    ctx.fillStyle = '#10151b';
    ctx.fillRect(0, 0, this.cw, this.ch);
    if (!map) return;

    const z = cam.zoom;
    const scale = z * this.dpr;
    ctx.setTransform(scale, 0, 0, scale, this.cw / 2 - cam.x * scale, this.ch / 2 - cam.y * scale);
    this.drawTiles(ctx, map, cam);
    if (snapshot) {
      this.drawRideMarkers(ctx, snapshot, map, cam);
      if (snapshot.tracks) this.drawLayer(ctx, snapshot.tracks, map, cam, 5, '#cf5650');
      this.drawLayer(ctx, snapshot.litter, map, cam, 2, ['#6b4f2a', '#9fc35b']);
      this.drawLayer(ctx, snapshot.vehicles, map, cam, 4, '#c0392b');
      this.drawLayer(ctx, snapshot.staff, map, cam, 3, [
        '#4ca95b',
        '#397cb3',
        '#855ea8',
        '#de8840',
      ]);
      this.drawRides(ctx, snapshot, map, cam);
      this.drawGuests(ctx, snapshot.guests, map, cam);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawTiles(ctx: CanvasRenderingContext2D, map: MapData, cam: Camera): void {
    const [vw, vh] = viewSize(map.width, map.height, cam.rotation);
    const z = cam.zoom;
    const minX = cam.x - this.cw / 2 / (z * this.dpr) - TILE_W;
    const maxX = cam.x + this.cw / 2 / (z * this.dpr) + TILE_W;
    const minY = cam.y - this.ch / 2 / (z * this.dpr) - TILE_H - 32 * Z_PIXELS;
    const maxY = cam.y + this.ch / 2 / (z * this.dpr) + TILE_H;
    // Painter's order in view space: far (small rx+ry) to near.
    for (let ry = 0; ry < vh; ry++) {
      for (let rx = 0; rx < vw; rx++) {
        const sx = (rx - ry) * (TILE_W / 2);
        const sy = (rx + ry) * (TILE_H / 2);
        if (sx < minX || sx > maxX || sy < minY || sy > maxY) continue;
        unrotateForDraw(rx, ry, map.width, map.height, cam.rotation, this.tile);
        const x = this.tile[0];
        const y = this.tile[1];
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
        const waterLevel = map.waterLevel?.[i] ?? 0;
        if (waterLevel > map.heights[i]) {
          const waterLift = waterLevel * Z_PIXELS;
          ctx.fillStyle = 'rgba(61, 141, 188, 0.72)';
          ctx.beginPath();
          ctx.moveTo(sx, sy - waterLift);
          ctx.lineTo(sx + TILE_W / 2, sy + TILE_H / 2 - waterLift);
          ctx.lineTo(sx, sy + TILE_H - waterLift);
          ctx.lineTo(sx - TILE_W / 2, sy + TILE_H / 2 - waterLift);
          ctx.closePath();
          ctx.fill();
        }
        this.drawMapElements(ctx, map, cam, i);
        this.visibleCount++;
      }
    }
  }

  private drawMapElements(
    ctx: CanvasRenderingContext2D,
    map: MapData,
    cam: Camera,
    tile: number,
  ): void {
    const paths = map.pathElements;
    if (!paths) return;
    for (let path = this.pathOffsets[tile]; path < this.pathOffsets[tile + 1]; path++) {
      const i = this.pathIndices[path];
      const o = i * 5;
      const x = paths[o];
      const y = paths[o + 1];
      const z = paths[o + 2] * Z_STEP;
      const flags = paths[o + 3];
      const direction = (flags & PathFlag.SlopeDir) >> 10;
      const sloped = (flags & PathFlag.Sloped) !== 0;
      const centerX = x * TILE_UNITS + 128;
      const centerY = y * TILE_UNITS + 128;
      project(
        centerX,
        centerY,
        z + (sloped ? Z_STEP / 2 : 1),
        map.width,
        map.height,
        cam.rotation,
        this.tmp,
      );
      if (!this.isVisible(this.tmp[0], this.tmp[1], cam, 22)) continue;
      ctx.fillStyle = flags & PathFlag.Queue ? '#b77d9d' : '#b59a70';
      if (sloped) {
        const dx = PATH_DX[direction] ?? 0;
        const dy = PATH_DY[direction] ?? 0;
        project(
          centerX - dx * 64,
          centerY - dy * 64,
          z,
          map.width,
          map.height,
          cam.rotation,
          this.pathLow,
        );
        project(
          centerX + dx * 64,
          centerY + dy * 64,
          z + Z_STEP,
          map.width,
          map.height,
          cam.rotation,
          this.pathHigh,
        );
        const vx = this.pathHigh[0] - this.pathLow[0];
        const vy = this.pathHigh[1] - this.pathLow[1];
        const length = Math.hypot(vx, vy) || 1;
        const nx = (-vy / length) * 4;
        const ny = (vx / length) * 4;
        ctx.beginPath();
        ctx.moveTo(this.pathLow[0] + nx, this.pathLow[1] + ny);
        ctx.lineTo(this.pathHigh[0] + nx, this.pathHigh[1] + ny);
        ctx.lineTo(this.pathHigh[0] - nx, this.pathHigh[1] - ny);
        ctx.lineTo(this.pathLow[0] - nx, this.pathLow[1] - ny);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#725f4b';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.fillRect(this.tmp[0] - 9, this.tmp[1] - 4, 18, 8);
      }
      if (flags & PathFlag.Bin) {
        ctx.fillStyle = '#547d58';
        ctx.fillRect(this.tmp[0] - 3, this.tmp[1] - 13, 6, 9);
      } else if (flags & PathFlag.Bench) {
        ctx.fillStyle = '#805535';
        ctx.fillRect(this.tmp[0] - 9, this.tmp[1] - 11, 18, 3);
      } else if (flags & PathFlag.Shelter) {
        ctx.fillStyle = '#5c6fa1';
        ctx.beginPath();
        ctx.moveTo(this.tmp[0] - 7, this.tmp[1] - 9);
        ctx.quadraticCurveTo(this.tmp[0], this.tmp[1] - 19, this.tmp[0] + 7, this.tmp[1] - 9);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(this.tmp[0] - 1, this.tmp[1] - 9, 2, 9);
      } else if (flags & PathFlag.Lamp) {
        ctx.fillStyle = '#e9d784';
        ctx.beginPath();
        ctx.arc(this.tmp[0], this.tmp[1] - 13, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      this.visibleCount++;
    }
  }

  private drawRideMarkers(
    ctx: CanvasRenderingContext2D,
    snapshot: Snapshot,
    map: MapData,
    cam: Camera,
  ): void {
    const colors = [
      [RideFlag.EntrancePlaced, RideInfo.EntranceX, RideInfo.EntranceY, '#46ae72'],
      [RideFlag.ExitPlaced, RideInfo.ExitX, RideInfo.ExitY, '#d36355'],
    ] as const;
    for (let i = 0; i < snapshot.rides.count; i++) {
      const o = i * RIDE_INFO_STRIDE;
      const flags = snapshot.rideInfo[o + RideInfo.Flags];
      for (const [flag, xField, yField, color] of colors) {
        if ((flags & flag) === 0) continue;
        const x = snapshot.rideInfo[o + xField];
        const y = snapshot.rideInfo[o + yField];
        project(
          x * TILE_UNITS + 128,
          y * TILE_UNITS + 128,
          map.heights[y * map.width + x] * Z_STEP,
          map.width,
          map.height,
          cam.rotation,
          this.tmp,
        );
        if (!this.isVisible(this.tmp[0], this.tmp[1], cam, 8)) continue;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(this.tmp[0], this.tmp[1] - 4, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawRides(
    ctx: CanvasRenderingContext2D,
    snapshot: Snapshot,
    map: MapData,
    cam: Camera,
  ): void {
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < snapshot.rides.count; i++) {
      const o = i * RIDE_INFO_STRIDE;
      const type = snapshot.rideInfo[o + RideInfo.Type] as RideType;
      const def = RIDE_CATALOG[type];
      const tileX = snapshot.rideInfo[o + RideInfo.RideX];
      const tileY = snapshot.rideInfo[o + RideInfo.RideY];
      if (
        !def ||
        def.usesTrack ||
        tileX < 0 ||
        tileY < 0 ||
        tileX >= map.width ||
        tileY >= map.height
      )
        continue;
      const worldX = tileX * TILE_UNITS + TILE_UNITS / 2;
      const worldY = tileY * TILE_UNITS + TILE_UNITS / 2;
      const z = map.heights[tileY * map.width + tileX] * Z_STEP;
      project(worldX, worldY, z, map.width, map.height, cam.rotation, this.tmp);

      const key = rideSpriteKey(type, cam.rotation);
      const sprite = this.rideSprites[key];
      const frameIndex = rideSpriteFrame(
        snapshot.rideInfo[o + RideInfo.Phase],
        snapshot.tick,
        sprite?.frames.length ?? 1,
      );
      const frame = sprite?.frames[frameIndex] ?? sprite?.frames[0];
      if (frame && this.rideAtlas?.complete && this.rideAtlas.naturalWidth > 0) {
        const margin = Math.max(frame.width - sprite.anchor.x, sprite.anchor.x, frame.height);
        if (!this.isVisible(this.tmp[0], this.tmp[1], cam, margin)) continue;
        ctx.drawImage(
          this.rideAtlas,
          frame.x,
          frame.y,
          frame.width,
          frame.height,
          this.tmp[0] - sprite.anchor.x,
          this.tmp[1] - sprite.anchor.y,
          frame.width,
          frame.height,
        );
      } else {
        if (!this.isVisible(this.tmp[0], this.tmp[1], cam, 8)) continue;
        ctx.fillStyle = '#6f75bd';
        ctx.fillRect(this.tmp[0] - 4, this.tmp[1] - 4, 8, 8);
      }
      this.visibleCount++;
    }
  }

  private loadRideAtlas(): void {
    if (this.rideAtlasRequestStarted || typeof fetch !== 'function') return;
    this.rideAtlasRequestStarted = true;
    void fetch(`${import.meta.env.BASE_URL}sprites/manifest.json`)
      .then(async (response) => {
        if (!response.ok) return;
        const manifest = (await response.json()) as CanvasRideManifest;
        const image = new Image();
        image.src = `${import.meta.env.BASE_URL}sprites/atlas.png`;
        await image.decode();
        this.rideSprites = manifest.sprites;
        this.rideAtlas = image;
      })
      .catch(() => {
        this.rideAtlasRequestStarted = false;
      });
  }

  private drawLayer(
    ctx: CanvasRenderingContext2D,
    layer: SnapshotLayer,
    map: MapData,
    cam: Camera,
    r: number,
    color: string | readonly string[],
  ): void {
    const d = layer.data;
    const t = this.tmp;
    for (let i = 0, o = 0; i < layer.count; i++, o += SNAPSHOT_STRIDE) {
      ctx.fillStyle = typeof color === 'string' ? color : (color[d[o + 3] & 0xff] ?? color[0]);
      project(d[o], d[o + 1], d[o + 2], map.width, map.height, cam.rotation, t);
      if (!this.isVisible(t[0], t[1], cam, r * 2)) continue;
      ctx.fillRect(t[0] - r, t[1] - r, r * 2, r * 2);
      this.visibleCount++;
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
    for (let i = 0, o = 0; i < layer.count; i++, o += SNAPSHOT_STRIDE) {
      project(d[o], d[o + 1], d[o + 2], map.width, map.height, cam.rotation, t);
      if (!this.isVisible(t[0], t[1], cam, 3)) continue;
      ctx.fillStyle = GUEST_TINTS[(d[o + 3] & 0xff) % GUEST_TINTS.length];
      ctx.fillRect(t[0] - 1.5, t[1] - 1.5, 3, 3);
      this.visibleCount++;
    }
  }

  private isVisible(x: number, y: number, cam: Camera, margin: number): boolean {
    const halfWidth = this.cw / (cam.zoom * this.dpr) / 2 + margin;
    const halfHeight = this.ch / (cam.zoom * this.dpr) / 2 + margin;
    return Math.abs(x - cam.x) <= halfWidth && Math.abs(y - cam.y) <= halfHeight;
  }

  dispose(): void {
    this.ctx = null;
    this.map = null;
  }
}

function unrotateForDraw(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: Camera['rotation'],
  out: Int32Array,
): void {
  switch (rotation) {
    case 0:
      out[0] = x;
      out[1] = y;
      break;
    case 1:
      out[0] = y;
      out[1] = height - 1 - x;
      break;
    case 2:
      out[0] = width - 1 - x;
      out[1] = height - 1 - y;
      break;
    case 3:
      out[0] = width - 1 - y;
      out[1] = x;
      break;
  }
}

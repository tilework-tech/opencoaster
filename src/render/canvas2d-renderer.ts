import type { Camera, MapData, Renderer } from './renderer';
import { TILE_H, TILE_W, Z_PIXELS, project, viewSize } from './projection';
import { SNAPSHOT_STRIDE } from '../worker/snapshot';
import type { Snapshot, SnapshotLayer } from '../worker/snapshot';
import { RideFlag, RideInfo, RIDE_INFO_STRIDE } from '../worker/snapshot';
import { PathFlag } from '../sim/map/tile-map';
import { SCENERY_CATALOG, SceneryCategory } from '../sim/map/scenery';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import type { RideType } from '../sim/rides/ride-types';
import { drawAnchoredSprite, drawTileTexture } from './canvas-atlas';
import { spritePages } from './sprite-pages';
import { CoasterScene } from './coaster-scene';
import type { CanvasAtlas } from './canvas-atlas';
import {
  WATER_BANK,
  pathSpriteName,
  rideSpriteFrame,
  rideSpriteKey,
  facilityFacingFromPaths,
  facilitySpriteKey,
  rideHutFacing,
  rideHutSpriteKey,
  waterFrameIndex,
} from './world-art';
import { terrainSurfaceSpriteName } from './world-art';
import type { PathSurface } from './world-art';
import {
  clipTerrainTileTrianglesBelowHeight,
  terrainShorelineSegments,
  terrainTileCorners,
} from './terrain-geometry';

const SURFACE_COLORS = [
  '#5aa24a',
  '#d9c98a',
  '#3f7fbf',
  '#8a8a8a',
  '#8b6b43',
  '#77716b',
  '#b08a8a',
];
/** Colour of terrain under water, seen as the bank above the lowered water surface. */
const LAKE_BED_COLOR = '#b9a76b';
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
/** Largest coaster sprite half-extent in pixels, for viewport culling. */
const COASTER_CULL_RADIUS = 160;
const PATH_DX = [1, 0, -1, 0];
const PATH_DY = [0, 1, 0, -1];
const PATH_STYLE_COLORS = ['#55565a', '#a9a193', '#987047'];
const TREE_COLORS = ['#397b35', '#285f48', '#bf6c98'];
const SHRUB_COLOR = '#397b35';
const FLOWER_COLORS = ['#f4c542', '#e85b86', '#f2eeee'];

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
  private sceneryOffsets = new Int32Array(0);
  private sceneryIndices = new Int32Array(0);
  private visibleCount = 0;
  private atlas: CanvasAtlas | null = null;
  private readonly coasterScene = new CoasterScene();
  private tick = 0;

  get visibleSpriteCount(): number {
    return this.visibleCount;
  }

  attach(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.atlas = spritePages;
    spritePages.start();
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
    const count = Math.min(map.pathCount ?? 0, paths?.length ? paths.length / 6 : 0);
    this.pathOffsets = new Int32Array(map.width * map.height + 1);
    this.pathIndices = new Int32Array(count);
    if (paths && count > 0) {
      for (let i = 0; i < count; i++) {
        const tile = paths[i * 6 + 1] * map.width + paths[i * 6];
        if (tile >= 0 && tile < map.width * map.height) this.pathOffsets[tile + 1]++;
      }
      for (let tile = 1; tile < this.pathOffsets.length; tile++)
        this.pathOffsets[tile] += this.pathOffsets[tile - 1];
      const cursor = this.pathOffsets.slice(0, -1);
      for (let i = 0; i < count; i++) {
        const tile = paths[i * 6 + 1] * map.width + paths[i * 6];
        if (tile >= 0 && tile < map.width * map.height) this.pathIndices[cursor[tile]++] = i;
      }
    }

    const scenery = map.sceneryElements;
    const sceneryCount = Math.min(map.sceneryCount ?? 0, scenery?.length ? scenery.length / 5 : 0);
    this.sceneryOffsets = new Int32Array(map.width * map.height + 1);
    this.sceneryIndices = new Int32Array(sceneryCount);
    if (scenery && sceneryCount > 0) {
      for (let i = 0; i < sceneryCount; i++) {
        const tile = scenery[i * 5 + 1] * map.width + scenery[i * 5];
        if (tile >= 0 && tile < map.width * map.height) this.sceneryOffsets[tile + 1]++;
      }
      for (let tile = 1; tile < this.sceneryOffsets.length; tile++)
        this.sceneryOffsets[tile] += this.sceneryOffsets[tile - 1];
      const cursor = this.sceneryOffsets.slice(0, -1);
      for (let i = 0; i < sceneryCount; i++) {
        const tile = scenery[i * 5 + 1] * map.width + scenery[i * 5];
        if (tile >= 0 && tile < map.width * map.height) this.sceneryIndices[cursor[tile]++] = i;
      }
    }
  }

  draw(snapshot: Snapshot | null, cam: Camera): void {
    const ctx = this.ctx;
    const map = this.map;
    if (!ctx) return;
    this.visibleCount = 0;
    this.tick = snapshot?.tick ?? 0;
    ctx.fillStyle = '#10151b';
    ctx.fillRect(0, 0, this.cw, this.ch);
    if (!map) return;

    const z = cam.zoom;
    const scale = z * this.dpr;
    ctx.setTransform(scale, 0, 0, scale, this.cw / 2 - cam.x * scale, this.ch / 2 - cam.y * scale);
    this.drawTiles(ctx, map, cam);
    if (snapshot) {
      this.drawParkGate(ctx, snapshot, map, cam);
      this.drawRideMarkers(ctx, snapshot, map, cam);
      const coasterSprites = this.drawCoasters(ctx, snapshot, map, cam);
      if (snapshot.tracks && !coasterSprites)
        this.drawLayer(ctx, snapshot.tracks, map, cam, 5, '#cf5650');
      this.drawLayer(ctx, snapshot.litter, map, cam, 2, ['#6b4f2a', '#9fc35b']);
      this.drawLayer(
        ctx,
        snapshot.vehicles,
        map,
        cam,
        4,
        '#c0392b',
        coasterSprites ? (word) => this.coasterScene.drawsRide(word >>> 16) : undefined,
      );
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
        const waterLevel = map.waterLevel?.[i] ?? 0;
        const terrainSurface =
          map.surface[i] === 1
            ? 'sand'
            : map.surface[i] === 4
              ? 'dirt'
              : map.surface[i] === 5
                ? 'rock'
                : 'grass';
        ctx.fillStyle =
          waterLevel > map.heights[i] ? LAKE_BED_COLOR : (SURFACE_COLORS[map.surface[i]] ?? '#f0f');
        ctx.beginPath();
        ctx.moveTo(sx, sy - liftTop);
        ctx.lineTo(sx + TILE_W / 2, sy + TILE_H / 2 - liftRight);
        ctx.lineTo(sx, sy + TILE_H - liftBottom);
        ctx.lineTo(sx - TILE_W / 2, sy + TILE_H / 2 - liftLeft);
        ctx.closePath();
        ctx.fill();
        if (mask === 0 && this.atlas) {
          drawTileTexture(
            ctx,
            this.atlas,
            terrainSurfaceSpriteName(terrainSurface),
            0,
            sx,
            sy - lift,
            TILE_W,
            TILE_H,
          );
        }
        if (cam.showGridlines) {
          ctx.strokeStyle = 'rgba(28, 34, 26, 0.18)';
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
        if (waterLevel > 0) {
          const waterLift = waterLevel * Z_PIXELS - WATER_BANK.surfaceInset / (Z_STEP / Z_PIXELS);
          const waterHeight = waterLevel - WATER_BANK.surfaceInset / 64;
          const clipped = clipTerrainTileTrianglesBelowHeight(
            terrainTileCorners(x, y, map.heights[i]!, mask),
            waterHeight,
          );
          if (clipped.length > 0) {
            const bankFaces = terrainShorelineSegments(
              terrainTileCorners(x, y, map.heights[i]!, mask),
              waterHeight,
            );
            for (const [start, end] of bankFaces) {
              ctx.fillStyle = 'rgba(94, 75, 45, 0.82)';
              ctx.beginPath();
              const faceCorners = [
                [start, waterLevel],
                [end, waterLevel],
                [end, waterHeight],
                [start, waterHeight],
              ] as const;
              for (let faceCorner = 0; faceCorner < faceCorners.length; faceCorner++) {
                const [point, height] = faceCorners[faceCorner]!;
                project(
                  point.x * TILE_UNITS,
                  point.y * TILE_UNITS,
                  height * Z_STEP,
                  map.width,
                  map.height,
                  cam.rotation,
                  this.tmp,
                );
                if (faceCorner === 0) ctx.moveTo(this.tmp[0]!, this.tmp[1]!);
                else ctx.lineTo(this.tmp[0]!, this.tmp[1]!);
              }
              ctx.closePath();
              ctx.fill();
            }
            ctx.save();
            ctx.beginPath();
            for (const polygon of clipped) {
              for (let corner = 0; corner < polygon.length; corner++) {
                const point = polygon[corner]!;
                project(
                  point.x * TILE_UNITS,
                  point.y * TILE_UNITS,
                  waterHeight * Z_STEP,
                  map.width,
                  map.height,
                  cam.rotation,
                  this.tmp,
                );
                if (corner === 0) ctx.moveTo(this.tmp[0]!, this.tmp[1]!);
                else ctx.lineTo(this.tmp[0]!, this.tmp[1]!);
              }
              ctx.closePath();
            }
            ctx.clip();
            ctx.globalAlpha = 0.88;
            const drawn = this.atlas
              ? drawTileTexture(
                  ctx,
                  this.atlas,
                  'water/surface',
                  waterFrameIndex(this.tick),
                  sx,
                  sy - waterLift,
                  TILE_W,
                  TILE_H,
                )
              : false;
            if (!drawn) {
              ctx.fillStyle = 'rgba(53, 111, 146, 0.88)';
              ctx.beginPath();
              ctx.moveTo(sx, sy - waterLift);
              ctx.lineTo(sx + TILE_W / 2, sy + TILE_H / 2 - waterLift);
              ctx.lineTo(sx, sy + TILE_H - waterLift);
              ctx.lineTo(sx - TILE_W / 2, sy + TILE_H / 2 - waterLift);
              ctx.closePath();
              ctx.fill();
            }
            ctx.globalAlpha = 1;
            ctx.restore();
          }
        }
        this.drawMapElements(ctx, map, cam, i);
        this.visibleCount++;
      }
    }
  }

  private drawPathAddition(ctx: CanvasRenderingContext2D, flags: number): void {
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
  }

  private drawMapElements(
    ctx: CanvasRenderingContext2D,
    map: MapData,
    cam: Camera,
    tile: number,
  ): void {
    const paths = map.pathElements;
    for (let path = this.pathOffsets[tile]; paths && path < this.pathOffsets[tile + 1]; path++) {
      const i = this.pathIndices[path];
      const o = i * 6;
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
      const edges = (flags & PathFlag.Edges) | ((flags & PathFlag.Forced) >> 4);
      const surface: PathSurface =
        flags & PathFlag.Queue
          ? 'queue'
          : ((['tarmac', 'crazy-paving', 'dirt'][paths[o + 5]] ?? 'tarmac') as PathSurface);
      project(centerX, centerY, z, map.width, map.height, cam.rotation, this.pathLow);
      if (
        this.atlas &&
        drawAnchoredSprite(
          ctx,
          this.atlas,
          pathSpriteName(surface, edges, sloped ? direction : undefined, cam.rotation),
          this.pathLow[0],
          this.pathLow[1],
        )
      ) {
        this.drawPathAddition(ctx, flags);
        this.visibleCount++;
        continue;
      }
      ctx.fillStyle =
        flags & PathFlag.Queue ? '#b77d9d' : (PATH_STYLE_COLORS[paths[o + 5]] ?? '#b59a70');
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
      this.drawPathAddition(ctx, flags);
      if (flags & PathFlag.Queue) {
        ctx.fillStyle = '#d7bb65';
        ctx.fillRect(this.tmp[0] - 7, this.tmp[1] - 5, 14, 1.5);
        ctx.fillRect(this.tmp[0] - 7, this.tmp[1] - 1, 14, 1.5);
        ctx.fillRect(this.tmp[0] - 6, this.tmp[1] - 5, 1, 6);
        ctx.fillRect(this.tmp[0] + 5, this.tmp[1] - 5, 1, 6);
      }
      this.visibleCount++;
    }
    this.drawSceneryElements(ctx, map, cam, tile);
  }

  private drawSceneryElements(
    ctx: CanvasRenderingContext2D,
    map: MapData,
    cam: Camera,
    tile: number,
  ): void {
    const scenery = map.sceneryElements;
    if (!scenery) return;
    for (
      let sceneryIndex = this.sceneryOffsets[tile];
      sceneryIndex < this.sceneryOffsets[tile + 1];
      sceneryIndex++
    ) {
      const offset = this.sceneryIndices[sceneryIndex] * 5;
      const x = scenery[offset];
      const y = scenery[offset + 1];
      const z = scenery[offset + 2] * Z_STEP;
      const definition = SCENERY_CATALOG[scenery[offset + 4]];
      if (!definition) continue;
      project(
        x * TILE_UNITS + TILE_UNITS / 2,
        y * TILE_UNITS + TILE_UNITS / 2,
        z,
        map.width,
        map.height,
        cam.rotation,
        this.tmp,
      );
      if (!this.isVisible(this.tmp[0], this.tmp[1], cam, definition.width)) continue;
      const crownHeight = Math.max(5, definition.height * Z_PIXELS * 0.55);
      if (definition.category === SceneryCategory.Trees) {
        ctx.fillStyle = '#76502e';
        ctx.fillRect(this.tmp[0] - 1.5, this.tmp[1] - crownHeight * 0.45, 3, crownHeight * 0.45);
        ctx.fillStyle = TREE_COLORS[scenery[offset + 4]] ?? TREE_COLORS[0];
        ctx.beginPath();
        ctx.arc(
          this.tmp[0],
          this.tmp[1] - crownHeight * 0.7,
          Math.max(5, definition.width * 0.22),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      } else if (definition.category === SceneryCategory.Gardens) {
        ctx.fillStyle = '#745135';
        ctx.fillRect(this.tmp[0] - 11, this.tmp[1] - 4, 22, 7);
        for (let flower = 0; flower < 3; flower++) {
          ctx.fillStyle = FLOWER_COLORS[flower];
          ctx.beginPath();
          ctx.arc(this.tmp[0] + (flower - 1) * 6, this.tmp[1] - 2, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (definition.category === SceneryCategory.Fences) {
        ctx.fillStyle = scenery[offset + 4] === 7 ? '#8b8a84' : '#9a7048';
        const vertical = (scenery[offset + 3] & 1) === 1;
        ctx.fillRect(this.tmp[0] - (vertical ? 2 : 12), this.tmp[1] - 9, vertical ? 4 : 24, 3);
        ctx.fillRect(this.tmp[0] - (vertical ? 2 : 12), this.tmp[1] - 3, vertical ? 4 : 24, 3);
      } else {
        ctx.fillStyle = SHRUB_COLOR;
        ctx.fillRect(this.tmp[0] - 10, this.tmp[1] - 7, 20, 8);
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
      [RideFlag.EntrancePlaced, RideInfo.EntranceX, RideInfo.EntranceY, 'entrance'],
      [RideFlag.ExitPlaced, RideInfo.ExitX, RideInfo.ExitY, 'exit'],
    ] as const;
    for (let i = 0; i < snapshot.rides.count; i++) {
      const o = i * RIDE_INFO_STRIDE;
      const category = RIDE_CATALOG[snapshot.rideInfo[o + RideInfo.Type] as RideType]?.category;
      if (['shop', 'stall', 'facility'].includes(category ?? '')) continue;
      const flags = snapshot.rideInfo[o + RideInfo.Flags];
      for (const [flag, xField, yField, part] of colors) {
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
        if (!this.isVisible(this.tmp[0], this.tmp[1], cam, 24)) continue;
        const type = snapshot.rideInfo[o + RideInfo.Type] as RideType;
        const facing = rideHutFacing(
          snapshot.rideInfo[o + RideInfo.RideX],
          snapshot.rideInfo[o + RideInfo.RideY],
          x,
          y,
        );
        if (
          !this.atlas ||
          !drawAnchoredSprite(
            ctx,
            this.atlas,
            rideHutSpriteKey(type, part, facing, cam.rotation),
            this.tmp[0],
            this.tmp[1],
          )
        ) {
          ctx.fillStyle = part === 'entrance' ? '#46ae72' : '#d36355';
          ctx.beginPath();
          ctx.arc(this.tmp[0], this.tmp[1] - 4, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  private drawParkGate(
    ctx: CanvasRenderingContext2D,
    snapshot: Snapshot,
    map: MapData,
    cam: Camera,
  ): void {
    const x = snapshot.park.entranceX;
    const y = snapshot.park.entranceY;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    project(
      x * TILE_UNITS + TILE_UNITS / 2,
      y * TILE_UNITS + TILE_UNITS / 2,
      map.heights[y * map.width + x] * Z_STEP,
      map.width,
      map.height,
      cam.rotation,
      this.tmp,
    );
    if (!this.isVisible(this.tmp[0], this.tmp[1], cam, 40)) return;
    const key = `scenery/park-entrance/view-${cam.rotation}`;
    if (this.atlas) drawAnchoredSprite(ctx, this.atlas, key, this.tmp[0], this.tmp[1]);
  }

  private drawRides(
    ctx: CanvasRenderingContext2D,
    snapshot: Snapshot,
    map: MapData,
    cam: Camera,
  ): void {
    for (let i = 0; i < snapshot.rides.count; i++) {
      const offset = i * RIDE_INFO_STRIDE;
      const type = snapshot.rideInfo[offset + RideInfo.Type] as RideType;
      const definition = RIDE_CATALOG[type];
      const tileX = snapshot.rideInfo[offset + RideInfo.RideX];
      const tileY = snapshot.rideInfo[offset + RideInfo.RideY];
      if (
        !definition ||
        definition.usesTrack ||
        tileX < 0 ||
        tileY < 0 ||
        tileX >= map.width ||
        tileY >= map.height
      )
        continue;

      const z = map.heights[tileY * map.width + tileX] * Z_STEP;
      project(
        tileX * TILE_UNITS + TILE_UNITS / 2,
        tileY * TILE_UNITS + TILE_UNITS / 2,
        z,
        map.width,
        map.height,
        cam.rotation,
        this.tmp,
      );
      const isFacility = ['shop', 'stall', 'facility'].includes(definition.category);
      const key = isFacility
        ? facilitySpriteKey(type, facilityFacingFromPaths(tileX, tileY, map), cam.rotation)
        : rideSpriteKey(type, cam.rotation);
      const entry = this.atlas?.resolve(key);
      const frameIndex = rideSpriteFrame(
        snapshot.rideInfo[offset + RideInfo.Phase],
        snapshot.tick,
        entry?.frames.length ?? 1,
      );
      const frame = entry?.frames[frameIndex] ?? entry?.frames[0];
      if (frame && this.atlas) {
        const margin = Math.max(frame.width - entry!.anchor.x, entry!.anchor.x, frame.height);
        if (!this.isVisible(this.tmp[0], this.tmp[1], cam, margin)) continue;
        drawAnchoredSprite(ctx, this.atlas, key, this.tmp[0], this.tmp[1], frameIndex);
      } else {
        if (!this.isVisible(this.tmp[0], this.tmp[1], cam, 8)) continue;
        ctx.fillStyle = '#6f75bd';
        ctx.fillRect(this.tmp[0] - 4, this.tmp[1] - 4, 8, 8);
      }
      this.visibleCount++;
    }
  }

  /** Draws coaster track, supports and cars from the atlas in painter order; false without art. */
  private drawCoasters(
    ctx: CanvasRenderingContext2D,
    snapshot: Snapshot,
    map: MapData,
    cam: Camera,
  ): boolean {
    const atlas = this.atlas;
    if (!atlas) return false;
    const scene = this.coasterScene;
    scene.build(snapshot, map, cam.rotation);
    const hasSprite = scene.items
      .slice(0, scene.length)
      .some((item) => atlas.resolve(item.key.split('#')[0]));
    if (!hasSprite) return false;
    const items = scene.items.slice(0, scene.length);
    items.sort((a, b) => a.depth - b.depth);
    const t = this.tmp;
    ctx.imageSmoothingEnabled = false;
    for (const item of items) {
      project(item.x, item.y, item.z, map.width, map.height, cam.rotation, t);
      if (!this.isVisible(t[0], t[1], cam, COASTER_CULL_RADIUS)) continue;
      if (drawAnchoredSprite(ctx, atlas, item.key, t[0], t[1])) {
        this.visibleCount++;
      } else if (item.key.includes('/track/') || item.key.startsWith('track/')) {
        ctx.fillStyle = '#cf5650';
        ctx.fillRect(t[0] - 5, t[1] - 5, 10, 10);
        this.visibleCount++;
      }
    }
    return true;
  }

  private drawLayer(
    ctx: CanvasRenderingContext2D,
    layer: SnapshotLayer,
    map: MapData,
    cam: Camera,
    r: number,
    color: string | readonly string[],
    skip?: (word: number) => boolean,
  ): void {
    const d = layer.data;
    const t = this.tmp;
    for (let i = 0, o = 0; i < layer.count; i++, o += SNAPSHOT_STRIDE) {
      if (skip?.(d[o + 3])) continue;
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

import type { Camera, MapData, PathPieceGhost, Renderer, SpriteGhost } from './renderer';
import { TILE_H, TILE_W, Z_PIXELS, project, unrotateTile, viewSize } from './projection';
import { SNAPSHOT_STRIDE, guestRowHeading, isRidingGuestRow } from '../worker/snapshot';
import type { Snapshot, SnapshotLayer } from '../worker/snapshot';
import { RideFlag, RideInfo, RIDE_INFO_STRIDE } from '../worker/snapshot';
import { PathFlag } from '../sim/map/tile-map';
import { SCENERY_CATALOG, SceneryCategory } from '../sim/map/scenery';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import type { RideType } from '../sim/rides/ride-types';
import {
  drawAnchoredSprite,
  drawBoxedSprite,
  drawGhostSprite,
  drawTileTexture,
} from './canvas-atlas';
import { spritePages } from './sprite-pages';
import type { PageImage, SpriteEntry } from './sprite-pages';
import { CoasterScene } from './coaster-scene';
import type { CanvasAtlas } from './canvas-atlas';
import {
  WATER_BANK,
  flowerBedDepth,
  flowerBedSpriteName,
  pathElementSprite,
  pathAdditionSpriteName,
  litterSpriteName,
  scenerySpriteName,
  rideSpriteFrame,
  rideSpriteKey,
  facilityFacingFromPaths,
  facilitySpriteKey,
  rideHutFacing,
  rideHutSpriteKey,
  waterFrameIndex,
  ambientTreeName,
  terrainCliffSpriteName,
  terrainSurfaceSpriteName,
} from './world-art';
import { OwnershipOverlay } from './ownership-overlay';
import type { TerrainSurface } from './world-art';
import { guestSpriteIndex, staffSpriteName } from './webgl2-renderer';
import { peopleSpriteKey, walkingFrame } from './people-art';
import { FLOWER_BED } from '../sim/staff/grounds';
import { AMBIENT_TREE_BOX, FLOWER_BED_BOX, GUEST_BOX, STAFF_BOX } from './sprite-layout';
import {
  pathAdditionBox,
  pathAdditionEdgeGroundZ,
  pathAdditionEdgeOffset,
  pathAdditionEdges,
  pathAdditionGroundZ,
  pathAdditionView,
  flowerBedGroundZ,
  pathConnectionEdges,
  sceneryBox,
  sceneryFrameDrop,
  sceneryGroundZ,
} from './ground-anchor';
import {
  clipTerrainTileTrianglesBelowHeight,
  terrainEdgeFace,
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
const SEAM = 0.5;
const PATH_DX = [1, 0, -1, 0];
const PATH_DY = [0, 1, 0, -1];
const PATH_STYLE_COLORS = ['#55565a', '#a9a193', '#987047'];
const TREE_COLORS = ['#397b35', '#285f48', '#bf6c98'];
const SHRUB_COLOR = '#397b35';
const FLOWER_COLORS = ['#f4c542', '#e85b86', '#f2eeee'];

/** Flat-colour tiles + dots. Placeholder art only; exists to exercise the data path. */
export class Canvas2DRenderer implements Renderer {
  private ownershipOverlay: OwnershipOverlay | null = null;
  readonly backend = 'Canvas2D';
  private ctx: CanvasRenderingContext2D | null = null;
  private map: MapData | null = null;
  private cw = 1;
  private ch = 1;
  private dpr = 1;
  private readonly tmp = new Float64Array(2);
  private readonly cliffPoints = Array.from({ length: 4 }, () => new Float64Array(2));
  private readonly pathLow = new Float64Array(2);
  private readonly pathHigh = new Float64Array(2);
  private readonly tile = new Int32Array(2);
  private pathOffsets = new Int32Array(0);
  private pathIndices = new Int32Array(0);
  private sceneryOffsets = new Int32Array(0);
  private sceneryIndices = new Int32Array(0);
  private visibleCount = 0;
  private ghosts: readonly PathPieceGhost[] = [];
  private ghostsByTile: Map<number, PathPieceGhost[]> | null = null;
  private spriteGhosts: readonly SpriteGhost[] = [];
  private spriteGhostsByTile: Map<number, SpriteGhost[]> | null = null;
  private atlas: CanvasAtlas | null = null;
  private readonly coasterScene = new CoasterScene();
  private tick = 0;
  private drawOrder: { depth: number; order: number; draw: () => void }[] = [];
  private nextDrawOrder = 0;

  get visibleSpriteCount(): number {
    return this.visibleCount;
  }

  attach(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    if (canvas.parentElement) this.ownershipOverlay = new OwnershipOverlay(canvas.parentElement);
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
    this.ownershipOverlay?.resize(width, height, dpr);
  }

  setMap(map: MapData): void {
    this.map = map;
    this.ghostsByTile = null;
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

  setGhosts(ghosts: readonly PathPieceGhost[]): void {
    this.ghosts = ghosts;
    this.ghostsByTile = null;
  }

  setSpriteGhosts(ghosts: readonly SpriteGhost[]): void {
    this.spriteGhosts = ghosts;
    this.spriteGhostsByTile = null;
  }

  draw(snapshot: Snapshot | null, cam: Camera): void {
    const ctx = this.ctx;
    const map = this.map;
    if (!ctx) return;
    this.visibleCount = 0;
    this.tick = snapshot?.tick ?? 0;
    this.drawOrder = [];
    this.nextDrawOrder = 0;
    ctx.fillStyle = '#10151b';
    ctx.fillRect(0, 0, this.cw, this.ch);
    if (!map) return;

    const z = cam.zoom;
    const scale = z * this.dpr;
    ctx.setTransform(scale, 0, 0, scale, this.cw / 2 - cam.x * scale, this.ch / 2 - cam.y * scale);
    this.drawTiles(ctx, map, cam, snapshot);
    if (snapshot) {
      this.drawParkGate(ctx, snapshot, map, cam);
      this.drawRideMarkers(ctx, snapshot, map, cam);
      const coasterSprites = this.drawCoasters(ctx, snapshot, map, cam);
      if (snapshot.tracks && !coasterSprites)
        this.drawLayer(ctx, snapshot.tracks, map, cam, 5, '#cf5650');
      this.drawLitter(ctx, snapshot.litter, map, cam);
      this.drawLayer(
        ctx,
        snapshot.vehicles,
        map,
        cam,
        4,
        '#c0392b',
        coasterSprites ? (word) => this.coasterScene.drawsRide(word >>> 16) : undefined,
      );
      if (this.atlas) this.drawStaff(ctx, snapshot.staff, map, cam, snapshot.tick);
      else
        this.drawLayer(ctx, snapshot.staff, map, cam, 3, [
          '#4ca95b',
          '#397cb3',
          '#855ea8',
          '#de8840',
        ]);
      this.drawRides(ctx, snapshot, map, cam);
      this.drawGuests(ctx, snapshot.guests, snapshot.tick, map, cam);
    }
    this.drawOrder.sort((a, b) => a.depth - b.depth || a.order - b.order);
    for (const item of this.drawOrder) item.draw();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ownershipOverlay?.draw(map, cam);
  }

  private enqueue(
    map: MapData,
    cam: Camera,
    x: number,
    y: number,
    z: number,
    offset: number,
    draw: () => void,
  ): void {
    const tx = x / TILE_UNITS;
    const ty = y / TILE_UNITS;
    let sum: number;
    switch (cam.rotation) {
      case 0:
        sum = tx + ty;
        break;
      case 1:
        sum = map.height - ty + tx;
        break;
      case 2:
        sum = map.width - tx + map.height - ty;
        break;
      case 3:
        sum = ty + map.width - tx;
        break;
    }
    this.queueAtDepth(2 * sum - z / Z_STEP + offset, draw);
  }

  private queueAtDepth(depth: number, draw: () => void): void {
    this.drawOrder.push({
      depth,
      order: this.nextDrawOrder++,
      draw,
    });
  }

  private drawTiles(
    ctx: CanvasRenderingContext2D,
    map: MapData,
    cam: Camera,
    snapshot: Snapshot | null,
  ): void {
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
        const terrainZ = map.heights[i]! * Z_STEP;
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
        // Tiles overlap their neighbours by SEAM px so antialiased edges leave no background gaps.
        ctx.moveTo(sx, sy - liftTop - SEAM);
        ctx.lineTo(sx + TILE_W / 2 + SEAM * 2, sy + TILE_H / 2 - liftRight);
        ctx.lineTo(sx, sy + TILE_H - liftBottom + SEAM);
        ctx.lineTo(sx - TILE_W / 2 - SEAM * 2, sy + TILE_H / 2 - liftLeft);
        ctx.closePath();
        ctx.fill();
        if (this.atlas && (mask === 0 || terrainSurface === 'rock')) {
          const texture = () =>
            drawTileTexture(
              ctx,
              this.atlas!,
              terrainSurfaceSpriteName(terrainSurface),
              0,
              sx,
              sy - lift,
              TILE_W,
              TILE_H,
            );
          if (mask === 0) texture();
          else {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(sx, sy - liftTop);
            ctx.lineTo(sx + TILE_W / 2, sy + TILE_H / 2 - liftRight);
            ctx.lineTo(sx, sy + TILE_H - liftBottom);
            ctx.lineTo(sx - TILE_W / 2, sy + TILE_H / 2 - liftLeft);
            ctx.closePath();
            ctx.clip();
            texture();
            ctx.restore();
          }
        }
        if (terrainSurface === 'rock')
          this.enqueue(map, cam, x * TILE_UNITS, y * TILE_UNITS, terrainZ, 0.25, () =>
            this.drawRockCliffFaces(ctx, map, cam, x, y, i, mask),
          );
        if (cam.showGridlines) {
          ctx.strokeStyle = 'rgba(28, 34, 26, 0.18)';
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
        if (waterLevel > 0) {
          const waterLift = waterLevel * Z_PIXELS - WATER_BANK.surfaceInset / (Z_STEP / Z_PIXELS);
          const waterHeight = waterLevel - WATER_BANK.surfaceInset / 64;
          const tileCorners = terrainTileCorners(x, y, map.heights[i]!, mask);
          const clipped = clipTerrainTileTrianglesBelowHeight(
            tileCorners,
            waterHeight,
            cam.rotation,
          );
          if (clipped.length > 0) {
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
            for (const [start, end] of terrainShorelineSegments(
              tileCorners,
              waterHeight,
              cam.rotation,
            )) {
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
          }
        }
        const terrainPeak = map.heights[i]! + (mask !== 0 ? 1 : 0);
        const raisedOver = (behindX: number, behindY: number): boolean => {
          if (behindX < 0 || behindY < 0 || behindX >= vw || behindY >= vh) return false;
          const [behindWorldX, behindWorldY] = unrotateTile(
            behindX,
            behindY,
            map.width,
            map.height,
            cam.rotation,
          );
          const behindIndex = behindWorldY * map.width + behindWorldX;
          return terrainPeak > map.heights[behindIndex]! + (map.slope[behindIndex] !== 0 ? 1 : 0);
        };
        if (raisedOver(rx - 1, ry) || raisedOver(rx, ry - 1)) {
          this.enqueue(map, cam, x * TILE_UNITS, y * TILE_UNITS, terrainZ, 5, () =>
            this.drawTerrainOccluder(ctx, map, cam, x, y, i, mask, terrainSurface, sx, sy, lift),
          );
        }
        const centerX = x * TILE_UNITS + TILE_UNITS / 2;
        const centerY = y * TILE_UNITS + TILE_UNITS / 2;
        const groundFlowerBed = Boolean((snapshot?.grounds[i] ?? 0) & FLOWER_BED);
        let sceneryFlowerBed = false;
        const tileScenery = map.sceneryElements;
        if (tileScenery) {
          for (
            let item = this.sceneryOffsets[i]!;
            item < this.sceneryOffsets[i + 1]!;
            item++
          ) {
            const sceneryIndex = this.sceneryIndices[item]!;
            const definition = SCENERY_CATALOG[tileScenery[sceneryIndex * 5 + 4] ?? -1];
            if (definition?.sprite === 'flower-bed') {
              sceneryFlowerBed = true;
              break;
            }
          }
        }
        if (this.atlas)
          this.enqueue(
            map,
            cam,
            centerX,
            centerY,
            groundFlowerBed || sceneryFlowerBed
              ? flowerBedGroundZ(map.heights[i]!, mask, cam.rotation)
              : sceneryGroundZ(map.heights[i]!, mask, cam.rotation),
            groundFlowerBed || sceneryFlowerBed ? flowerBedDepth(2) : 2,
            () => this.drawGroundProps(ctx, map, cam, snapshot, i, x, y),
          );
        this.enqueue(map, cam, centerX, centerY, terrainZ, -1, () =>
          this.drawMapElements(ctx, map, cam, i),
        );
        for (const ghost of this.ghostsAt(map, i))
          this.enqueue(map, cam, centerX, centerY, ghost.level * Z_STEP, 0, () =>
            this.drawPathGhost(ctx, map, cam, ghost),
          );
        this.enqueue(
          map,
          cam,
          centerX,
          centerY,
          sceneryFlowerBed
            ? flowerBedGroundZ(map.heights[i]!, mask, cam.rotation)
            : sceneryGroundZ(map.heights[i]!, mask, cam.rotation),
          sceneryFlowerBed ? flowerBedDepth(2) : 2,
          () => this.drawSceneryElements(ctx, map, cam, i),
        );
        for (const ghost of this.spriteGhostsAt(map, i)) {
          if (ghost.kind === 'scenery')
            this.enqueue(map, cam, centerX, centerY, ghost.level * Z_STEP, 2, () =>
              this.drawSpriteGhost(ctx, map, cam, ghost),
            );
          else if (ghost.kind === 'path-addition')
            this.enqueue(
              map,
              cam,
              ghost.x * TILE_UNITS + TILE_UNITS / 2,
              ghost.y * TILE_UNITS + TILE_UNITS / 2,
              ghost.level * Z_STEP,
              -1,
              () => this.drawSpriteGhost(ctx, map, cam, ghost),
            );
        }
        this.visibleCount++;
      }
    }
  }

  private drawTerrainOccluder(
    ctx: CanvasRenderingContext2D,
    map: MapData,
    cam: Camera,
    x: number,
    y: number,
    index: number,
    mask: number,
    surface: TerrainSurface,
    sx: number,
    sy: number,
    lift: number,
  ): void {
    const corners = terrainTileCorners(x, y, map.heights[index]!, mask);
    const top = (4 - cam.rotation) & 3;
    const points = Array.from({ length: 4 }, (_, corner) => {
      const point = corners[(top + corner) & 3]!;
      const projected = new Float64Array(2);
      project(
        point.x * TILE_UNITS,
        point.y * TILE_UNITS,
        point.height * Z_STEP,
        map.width,
        map.height,
        cam.rotation,
        projected,
      );
      return projected;
    });
    ctx.beginPath();
    ctx.moveTo(points[0]![0]!, points[0]![1]!);
    for (let corner = 1; corner < points.length; corner++)
      ctx.lineTo(points[corner]![0]!, points[corner]![1]!);
    ctx.closePath();
    ctx.fillStyle = SURFACE_COLORS[map.surface[index]!] ?? '#5aa24a';
    ctx.fill();
    if (this.atlas && (mask === 0 || surface === 'rock')) {
      ctx.save();
      ctx.clip();
      drawTileTexture(
        ctx,
        this.atlas,
        terrainSurfaceSpriteName(surface),
        0,
        sx,
        sy - lift,
        TILE_W,
        TILE_H,
      );
      ctx.restore();
    }
  }

  private drawRockCliffFaces(
    ctx: CanvasRenderingContext2D,
    map: MapData,
    cam: Camera,
    x: number,
    y: number,
    index: number,
    mask: number,
  ): void {
    const corners = terrainTileCorners(x, y, map.heights[index]!, mask);
    const neighbors = [
      [x + 1, y],
      [x, y + 1],
      [x - 1, y],
      [x, y - 1],
    ] as const;
    for (let direction = 0; direction < neighbors.length; direction++) {
      const [neighborX, neighborY] = neighbors[direction]!;
      const onMapEdge =
        neighborX < 0 || neighborX >= map.width || neighborY < 0 || neighborY >= map.height;
      const neighborBase = onMapEdge ? 0 : map.heights[neighborY * map.width + neighborX]!;
      const face = terrainEdgeFace(corners, direction, neighborBase);
      if (!face || Math.max(face.start.height, face.end.height) <= face.bottomHeight) continue;

      const [start, end, endBottom, startBottom] = this.cliffPoints;
      project(
        face.start.x * TILE_UNITS,
        face.start.y * TILE_UNITS,
        face.start.height * Z_STEP,
        map.width,
        map.height,
        cam.rotation,
        start!,
      );
      project(
        face.end.x * TILE_UNITS,
        face.end.y * TILE_UNITS,
        face.end.height * Z_STEP,
        map.width,
        map.height,
        cam.rotation,
        end!,
      );
      project(
        face.end.x * TILE_UNITS,
        face.end.y * TILE_UNITS,
        face.bottomHeight * Z_STEP,
        map.width,
        map.height,
        cam.rotation,
        endBottom!,
      );
      project(
        face.start.x * TILE_UNITS,
        face.start.y * TILE_UNITS,
        face.bottomHeight * Z_STEP,
        map.width,
        map.height,
        cam.rotation,
        startBottom!,
      );

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(start![0]!, start![1]!);
      ctx.lineTo(end![0]!, end![1]!);
      ctx.lineTo(endBottom![0]!, endBottom![1]!);
      ctx.lineTo(startBottom![0]!, startBottom![1]!);
      ctx.closePath();
      const cliff = this.atlas?.resolve(
        terrainCliffSpriteName('rock', (direction + cam.rotation) & 3),
      );
      const frame = cliff?.frames[0];
      const image = frame && this.atlas?.pageImage(frame.page);
      if (frame && image) {
        ctx.clip();
        ctx.imageSmoothingEnabled = false;
        this.drawCliffTextureTriangle(
          ctx,
          image,
          frame,
          [
            [0, 0],
            [frame.width, 0],
            [0, frame.height],
          ],
          [start!, end!, startBottom!],
        );
        this.drawCliffTextureTriangle(
          ctx,
          image,
          frame,
          [
            [frame.width, 0],
            [frame.width, frame.height],
            [0, frame.height],
          ],
          [end!, endBottom!, startBottom!],
        );
      } else {
        ctx.fillStyle = '#6e675e';
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawCliffTextureTriangle(
    ctx: CanvasRenderingContext2D,
    image: PageImage,
    frame: SpriteEntry['frames'][number],
    source: readonly [
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
    ],
    target: readonly [Float64Array, Float64Array, Float64Array],
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(target[0]![0]!, target[0]![1]!);
    ctx.lineTo(target[1]![0]!, target[1]![1]!);
    ctx.lineTo(target[2]![0]!, target[2]![1]!);
    ctx.closePath();
    ctx.clip();

    const [sourceOrigin, sourceX, sourceY] = source;
    const [targetOrigin, targetX, targetY] = target;
    const sourceDxX = sourceX[0] - sourceOrigin[0];
    const sourceDxY = sourceX[1] - sourceOrigin[1];
    const sourceDyX = sourceY[0] - sourceOrigin[0];
    const sourceDyY = sourceY[1] - sourceOrigin[1];
    const determinant = sourceDxX * sourceDyY - sourceDyX * sourceDxY;
    const targetDxX = targetX[0]! - targetOrigin[0]!;
    const targetDxY = targetX[1]! - targetOrigin[1]!;
    const targetDyX = targetY[0]! - targetOrigin[0]!;
    const targetDyY = targetY[1]! - targetOrigin[1]!;
    const a = (targetDxX * sourceDyY - targetDyX * sourceDxY) / determinant;
    const c = (sourceDxX * targetDyX - sourceDyX * targetDxX) / determinant;
    const b = (targetDxY * sourceDyY - targetDyY * sourceDxY) / determinant;
    const d = (sourceDxX * targetDyY - sourceDyX * targetDxY) / determinant;
    const e = targetOrigin[0]! - a * sourceOrigin[0] - c * sourceOrigin[1];
    const f = targetOrigin[1]! - b * sourceOrigin[0] - d * sourceOrigin[1];
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(
      image,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      0,
      0,
      frame.width,
      frame.height,
    );
    ctx.restore();
  }

  private drawPathAddition(
    ctx: CanvasRenderingContext2D,
    flags: number,
    data: number,
    view: number,
  ): void {
    const sprite = pathAdditionSpriteName(flags, view, data);
    const box = pathAdditionBox(flags, view);
    if (this.atlas && sprite) {
      const drawn =
        flags & PathFlag.Shelter
          ? drawBoxedSprite(
              ctx,
              this.atlas,
              sprite,
              this.tmp[0],
              this.tmp[1],
              box.width,
              box.height,
            )
          : drawAnchoredSprite(ctx, this.atlas, sprite, this.tmp[0], this.tmp[1]);
      if (drawn) return;
    }
    const x = this.tmp[0];
    const y = this.tmp[1];
    if (flags & PathFlag.Bin) {
      ctx.fillStyle = '#547d58';
      ctx.fillRect(
        x - (view & 1 ? 13 : 3),
        y - (view & 1 ? 3 : 13),
        view & 1 ? 9 : 6,
        view & 1 ? 6 : 9,
      );
    } else if (flags & PathFlag.Bench) {
      ctx.fillStyle = '#805535';
      if (view & 1) {
        ctx.fillRect(x - 2, y - 9, 4, 18);
        ctx.fillRect(x - 5, y - 9, 3, 18);
      } else {
        ctx.fillRect(x - 9, y - 11, 18, 3);
      }
    } else if (flags & PathFlag.Shelter) {
      ctx.fillStyle = '#5c6fa1';
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 9);
      ctx.quadraticCurveTo(x, y - 19, x + 7, y - 9);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - 1, y - 9, 2, 9);
    } else if (flags & PathFlag.Lamp) {
      ctx.fillStyle = '#e9d784';
      ctx.beginPath();
      ctx.arc(x, y - 13, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPathAdditions(
    ctx: CanvasRenderingContext2D,
    map: MapData,
    cam: Camera,
    flags: number,
    data: number,
    baseHeight: number,
    centerX: number,
    centerY: number,
  ): void {
    if ((flags & (PathFlag.Bin | PathFlag.Bench | PathFlag.Lamp | PathFlag.Shelter)) === 0) return;
    if (flags & PathFlag.Shelter) {
      project(
        centerX,
        centerY,
        pathAdditionGroundZ(baseHeight, flags),
        map.width,
        map.height,
        cam.rotation,
        this.tmp,
      );
      this.drawPathAddition(ctx, flags, data, cam.rotation);
      return;
    }
    for (const edge of pathAdditionEdges(pathConnectionEdges(flags))) {
      const offset = pathAdditionEdgeOffset(edge);
      project(
        centerX + offset.x,
        centerY + offset.y,
        pathAdditionEdgeGroundZ(baseHeight, flags, edge),
        map.width,
        map.height,
        cam.rotation,
        this.tmp,
      );
      this.drawPathAddition(ctx, flags, data, pathAdditionView(edge, cam.rotation));
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
        pathAdditionGroundZ(paths[o + 2]!, flags),
        map.width,
        map.height,
        cam.rotation,
        this.tmp,
      );
      if (!this.isVisible(this.tmp[0], this.tmp[1], cam, 22)) continue;
      project(centerX, centerY, z, map.width, map.height, cam.rotation, this.pathLow);
      if (
        this.atlas &&
        drawAnchoredSprite(
          ctx,
          this.atlas,
          pathElementSprite(flags, paths[o + 5]!, cam.rotation),
          this.pathLow[0],
          this.pathLow[1],
        )
      ) {
        this.drawPathAdditions(ctx, map, cam, flags, paths[o + 4], paths[o + 2]!, centerX, centerY);
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
      this.drawPathAdditions(ctx, map, cam, flags, paths[o + 4], paths[o + 2]!, centerX, centerY);
      if (flags & PathFlag.Queue) {
        ctx.fillStyle = '#d7bb65';
        ctx.fillRect(this.tmp[0] - 7, this.tmp[1] - 5, 14, 1.5);
        ctx.fillRect(this.tmp[0] - 7, this.tmp[1] - 1, 14, 1.5);
        ctx.fillRect(this.tmp[0] - 6, this.tmp[1] - 5, 1, 6);
        ctx.fillRect(this.tmp[0] + 5, this.tmp[1] - 5, 1, 6);
      }
      this.visibleCount++;
    }
  }

  private ghostsAt(map: MapData, tile: number): readonly PathPieceGhost[] {
    if (!this.ghostsByTile) {
      this.ghostsByTile = new Map();
      for (const ghost of this.ghosts) {
        const index = ghost.y * map.width + ghost.x;
        const list = this.ghostsByTile.get(index);
        if (list) list.push(ghost);
        else this.ghostsByTile.set(index, [ghost]);
      }
    }
    return this.ghostsByTile.get(tile) ?? [];
  }

  private spriteGhostsAt(map: MapData, tile: number): readonly SpriteGhost[] {
    if (!this.spriteGhostsByTile) {
      this.spriteGhostsByTile = new Map();
      for (const ghost of this.spriteGhosts) {
        const index = (ghost.tileY ?? ghost.y) * map.width + (ghost.tileX ?? ghost.x);
        const list = this.spriteGhostsByTile.get(index);
        if (list) list.push(ghost);
        else this.spriteGhostsByTile.set(index, [ghost]);
      }
    }
    return this.spriteGhostsByTile.get(tile) ?? [];
  }

  /** Draws a sprite preview at the built piece's projected ground pivot and box. */
  private drawSpriteGhost(
    ctx: CanvasRenderingContext2D,
    map: MapData,
    cam: Camera,
    ghost: SpriteGhost,
  ): void {
    if (!this.atlas) return;
    project(
      ghost.x * TILE_UNITS + TILE_UNITS / 2,
      ghost.y * TILE_UNITS + TILE_UNITS / 2,
      ghost.level * Z_STEP,
      map.width,
      map.height,
      cam.rotation,
      this.pathLow,
    );
    if (!this.isVisible(this.pathLow[0]!, this.pathLow[1]!, cam, 40)) return;
    drawGhostSprite(
      ctx,
      this.atlas,
      ghost.sprite,
      this.pathLow[0]!,
      this.pathLow[1]!,
      ghost.tone,
      ghost.width,
      ghost.height,
    );
  }

  private drawPathGhost(
    ctx: CanvasRenderingContext2D,
    map: MapData,
    cam: Camera,
    ghost: PathPieceGhost,
  ): void {
    if (!this.atlas) return;
    project(
      ghost.x * TILE_UNITS + 128,
      ghost.y * TILE_UNITS + 128,
      ghost.level * Z_STEP,
      map.width,
      map.height,
      cam.rotation,
      this.pathLow,
    );
    if (!this.isVisible(this.pathLow[0], this.pathLow[1], cam, 22)) return;
    drawGhostSprite(
      ctx,
      this.atlas,
      pathElementSprite(ghost.flags, ghost.surface, cam.rotation),
      this.pathLow[0],
      this.pathLow[1],
      ghost.tone,
    );
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
      const tile = y * map.width + x;
      const z = sceneryGroundZ(map.heights[tile]!, map.slope[tile]!, cam.rotation);
      const definition = SCENERY_CATALOG[scenery[offset + 4]];
      if (!definition) continue;
      const box = sceneryBox(definition);
      project(
        x * TILE_UNITS + TILE_UNITS / 2,
        y * TILE_UNITS + TILE_UNITS / 2,
        z - sceneryFrameDrop(definition),
        map.width,
        map.height,
        cam.rotation,
        this.tmp,
      );
      if (!this.isVisible(this.tmp[0], this.tmp[1], cam, Math.max(box.width, box.height))) continue;
      if (
        this.atlas &&
        drawBoxedSprite(
          ctx,
          this.atlas,
          definition.sprite === 'flower-bed'
            ? flowerBedSpriteName(x, y, cam.rotation, map.slope[tile]!)
            : scenerySpriteName(definition.sprite),
          this.tmp[0],
          this.tmp[1],
          box.width,
          box.height,
        )
      ) {
        this.visibleCount++;
        continue;
      }
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
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
        const type = snapshot.rideInfo[o + RideInfo.Type] as RideType;
        const worldX = x * TILE_UNITS + 128;
        const worldY = y * TILE_UNITS + 128;
        const z = map.heights[y * map.width + x]! * Z_STEP;
        this.enqueue(map, cam, worldX, worldY, z, 2, () => {
          project(worldX, worldY, z, map.width, map.height, cam.rotation, this.tmp);
          if (!this.isVisible(this.tmp[0]!, this.tmp[1]!, cam, 24)) return;
          const facing = rideHutFacing(
            snapshot.rideInfo[o + RideInfo.RideX]!,
            snapshot.rideInfo[o + RideInfo.RideY]!,
            x,
            y,
          );
          if (
            !this.atlas ||
            !drawAnchoredSprite(
              ctx,
              this.atlas,
              rideHutSpriteKey(type, part, facing, cam.rotation),
              this.tmp[0]!,
              this.tmp[1]!,
            )
          ) {
            ctx.fillStyle = part === 'entrance' ? '#46ae72' : '#d36355';
            ctx.beginPath();
            ctx.arc(this.tmp[0]!, this.tmp[1]! - 4, 5, 0, Math.PI * 2);
            ctx.fill();
          }
        });
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
    const worldX = x * TILE_UNITS + TILE_UNITS / 2;
    const worldY = y * TILE_UNITS + TILE_UNITS / 2;
    const z = map.heights[y * map.width + x]! * Z_STEP;
    this.enqueue(map, cam, worldX, worldY, z, 2, () => {
      project(worldX, worldY, z, map.width, map.height, cam.rotation, this.tmp);
      if (!this.isVisible(this.tmp[0]!, this.tmp[1]!, cam, 40)) return;
      const key = `scenery/park-entrance/view-${cam.rotation}`;
      if (this.atlas) drawAnchoredSprite(ctx, this.atlas, key, this.tmp[0]!, this.tmp[1]!);
    });
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
      const worldX = tileX * TILE_UNITS + TILE_UNITS / 2;
      const worldY = tileY * TILE_UNITS + TILE_UNITS / 2;
      this.enqueue(map, cam, worldX, worldY, z, 0, () => {
        project(worldX, worldY, z, map.width, map.height, cam.rotation, this.tmp);
        const isFacility = ['shop', 'stall', 'facility'].includes(definition.category);
        const key = isFacility
          ? facilitySpriteKey(type, facilityFacingFromPaths(tileX, tileY, map), cam.rotation)
          : rideSpriteKey(type, cam.rotation);
        const entry = this.atlas?.resolve(key);
        const frameIndex = rideSpriteFrame(
          snapshot.rideInfo[offset + RideInfo.Phase]!,
          snapshot.tick,
          entry?.frames.length ?? 1,
        );
        const frame = entry?.frames[frameIndex] ?? entry?.frames[0];
        if (frame && this.atlas) {
          const margin = Math.max(frame.width - entry!.anchor.x, entry!.anchor.x, frame.height);
          if (!this.isVisible(this.tmp[0]!, this.tmp[1]!, cam, margin)) return;
          drawAnchoredSprite(ctx, this.atlas, key, this.tmp[0]!, this.tmp[1]!, frameIndex);
        } else {
          if (!this.isVisible(this.tmp[0]!, this.tmp[1]!, cam, 8)) return;
          ctx.fillStyle = '#6f75bd';
          ctx.fillRect(this.tmp[0]! - 4, this.tmp[1]! - 4, 8, 8);
        }
        this.visibleCount++;
      });
    }
    for (const ghost of this.spriteGhosts) {
      if (ghost.kind !== 'ride') continue;
      const worldX = ghost.x * TILE_UNITS + TILE_UNITS / 2;
      const worldY = ghost.y * TILE_UNITS + TILE_UNITS / 2;
      this.enqueue(map, cam, worldX, worldY, ghost.level * Z_STEP, 0, () =>
        this.drawSpriteGhost(ctx, map, cam, ghost),
      );
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
      this.queueAtDepth(item.depth, () => {
        project(item.x, item.y, item.z, map.width, map.height, cam.rotation, t);
        if (!this.isVisible(t[0]!, t[1]!, cam, COASTER_CULL_RADIUS)) return;
        if (drawAnchoredSprite(ctx, atlas, item.key, t[0]!, t[1]!)) {
          this.visibleCount++;
        } else if (item.key.includes('/track/') || item.key.startsWith('track/')) {
          ctx.fillStyle = '#cf5650';
          ctx.fillRect(t[0]! - 5, t[1]! - 5, 10, 10);
          this.visibleCount++;
        }
      });
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
      const x = d[o]!;
      const y = d[o + 1]!;
      const z = d[o + 2]!;
      const metadata = d[o + 3]!;
      this.enqueue(map, cam, x, y, z, 0, () => {
        ctx.fillStyle = typeof color === 'string' ? color : (color[metadata & 0xff] ?? color[0]);
        project(x, y, z, map.width, map.height, cam.rotation, t);
        if (!this.isVisible(t[0]!, t[1]!, cam, r * 2)) return;
        ctx.fillRect(t[0]! - r, t[1]! - r, r * 2, r * 2);
        this.visibleCount++;
      });
    }
  }

  private drawLitter(
    ctx: CanvasRenderingContext2D,
    layer: SnapshotLayer,
    map: MapData,
    cam: Camera,
  ): void {
    const data = layer.data;
    for (let index = 0, offset = 0; index < layer.count; index++, offset += SNAPSHOT_STRIDE) {
      project(
        data[offset],
        data[offset + 1],
        data[offset + 2],
        map.width,
        map.height,
        cam.rotation,
        this.tmp,
      );
      if (!this.isVisible(this.tmp[0], this.tmp[1], cam, 8)) continue;
      const kind = data[offset + 3] & 0xff;
      if (
        !this.atlas ||
        !drawBoxedSprite(
          ctx,
          this.atlas,
          litterSpriteName(kind, cam.rotation),
          this.tmp[0],
          this.tmp[1],
          14,
          8,
        )
      ) {
        ctx.fillStyle = kind === 1 ? '#9fc35b' : '#6b4f2a';
        ctx.fillRect(this.tmp[0] - 2, this.tmp[1] - 2, 4, 4);
      }
      this.visibleCount++;
    }
  }

  private drawGuests(
    ctx: CanvasRenderingContext2D,
    layer: SnapshotLayer,
    tick: number,
    map: MapData,
    cam: Camera,
  ): void {
    const d = layer.data;
    const t = this.tmp;
    for (let i = 0, o = 0; i < layer.count; i++, o += SNAPSHOT_STRIDE) {
      const x = d[o]!;
      const y = d[o + 1]!;
      const z = d[o + 2]!;
      const metadata = d[o + 3]!;
      if (isRidingGuestRow(metadata)) continue;
      this.enqueue(map, cam, x, y, z, 0, () => {
        project(x, y, z, map.width, map.height, cam.rotation, t);
        if (!this.isVisible(t[0]!, t[1]!, cam, GUEST_BOX.height)) return;
        const sprite = `people/guest-walk#${guestSpriteIndex(metadata & 0xff, guestRowHeading(metadata), tick >>> 2) - 40}`;
        if (!this.atlas || !drawAnchoredSprite(ctx, this.atlas, sprite, t[0]!, t[1]!)) {
          ctx.fillStyle = GUEST_TINTS[(metadata & 0xff) % GUEST_TINTS.length];
          ctx.fillRect(t[0]! - 1.5, t[1]! - 1.5, 3, 3);
        }
        this.visibleCount++;
      });
    }
  }

  private drawStaff(
    ctx: CanvasRenderingContext2D,
    layer: SnapshotLayer,
    map: MapData,
    cam: Camera,
    tick: number,
  ): void {
    const d = layer.data;
    const t = this.tmp;
    for (let i = 0, o = 0; i < layer.count; i++, o += SNAPSHOT_STRIDE) {
      const x = d[o]!;
      const y = d[o + 1]!;
      const z = d[o + 2]!;
      const metadata = d[o + 3]!;
      this.enqueue(map, cam, x, y, z, 0, () => {
        project(x, y, z, map.width, map.height, cam.rotation, t);
        if (!this.isVisible(t[0]!, t[1]!, cam, Math.max(STAFF_BOX.height, 24))) return;
        const kind = metadata & 0xff;
        const direction = (metadata >>> 8) & 3;
        const sprite = `${peopleSpriteKey(kind, direction, cam.rotation)}#${walkingFrame(tick)}`;
        if (!drawAnchoredSprite(ctx, this.atlas!, sprite, t[0]!, t[1]!))
          drawBoxedSprite(
            ctx,
            this.atlas!,
            staffSpriteName(kind),
            t[0]!,
            t[1]!,
            STAFF_BOX.width,
            STAFF_BOX.height,
          );
        this.visibleCount++;
      });
    }
  }

  /** Ambient trees and flower beds, placed by tile exactly as in the WebGL renderer. */
  private drawGroundProps(
    ctx: CanvasRenderingContext2D,
    map: MapData,
    cam: Camera,
    snapshot: Snapshot | null,
    tile: number,
    x: number,
    y: number,
  ): void {
    const atlas = this.atlas;
    if (!atlas) return;
    const z = sceneryGroundZ(map.heights[tile]!, map.slope[tile]!, cam.rotation);
    const worldX = x * TILE_UNITS + TILE_UNITS / 2;
    const worldY = y * TILE_UNITS + TILE_UNITS / 2;
    const place = (name: string, offsetZ: number, width: number, height: number): void => {
      project(worldX, worldY, z + offsetZ, map.width, map.height, cam.rotation, this.tmp);
      if (!this.isVisible(this.tmp[0], this.tmp[1], cam, Math.max(width, height))) return;
      if (drawBoxedSprite(ctx, atlas, name, this.tmp[0], this.tmp[1], width, height))
        this.visibleCount++;
    };
    const tree = ambientTreeName(map.surface[tile]!, x, y);
    if (tree) place(scenerySpriteName(tree), 0, AMBIENT_TREE_BOX.width, AMBIENT_TREE_BOX.height);
    if (snapshot && ((snapshot.grounds[tile] ?? 0) & FLOWER_BED) !== 0)
      place(
        flowerBedSpriteName(x, y, cam.rotation, map.slope[tile]!),
        flowerBedGroundZ(map.heights[tile]!, map.slope[tile]!, cam.rotation) - z - Z_STEP,
        FLOWER_BED_BOX.width,
        FLOWER_BED_BOX.height,
      );
  }

  private isVisible(x: number, y: number, cam: Camera, margin: number): boolean {
    const halfWidth = this.cw / (cam.zoom * this.dpr) / 2 + margin;
    const halfHeight = this.ch / (cam.zoom * this.dpr) / 2 + margin;
    return Math.abs(x - cam.x) <= halfWidth && Math.abs(y - cam.y) <= halfHeight;
  }

  dispose(): void {
    this.ownershipOverlay?.dispose();
    this.ownershipOverlay = null;
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

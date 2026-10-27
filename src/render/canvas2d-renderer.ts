import type { Camera, MapData, PathPieceGhost, Renderer, SpriteGhost } from './renderer';
import { TILE_H, TILE_W, Z_PIXELS, project, unrotateTile, viewSize } from './projection';
import {
  SNAPSHOT_STRIDE,
  guestRowHeading,
  guestRowIdle,
  isRidingGuestRow,
} from '../worker/snapshot';
import type { Snapshot, SnapshotLayer } from '../worker/snapshot';
import { RideFlag, RideInfo, RIDE_INFO_STRIDE } from '../worker/snapshot';
import { PathFlag, SALE_LAND, SALE_RIGHTS } from '../sim/map/tile-map';
import { SCENERY_CATALOG, SceneryCategory, isWallScenery } from '../sim/map/scenery';
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
import { RideCellScene, isSlicedRide } from './ride-scene';
import type { RideCellDraw } from './ride-scene';
import type { CanvasAtlas } from './canvas-atlas';
import {
  WATER_BANK,
  flowerBedSpriteName,
  pathElementSprite,
  queueRailSprites,
  pathAdditionSpriteName,
  litterSpriteName,
  scenerySpriteName,
  wallSpriteName,
  shrubSpriteName,
  rideSpriteFrame,
  rideSpriteKey,
  facilityFacingFromPaths,
  facilitySpriteKey,
  LITTER_SPRITE_SIZE,
  rideHutFacingForFootprint,
  rideHutSpriteKey,
  waterFrameIndex,
  ambientTreeName,
  terrainCliffSpriteName,
  terrainSurfaceSpriteName,
} from './world-art';
import { DepthSurface } from './depth-surface';
import { PARK_FENCE, landOverlayTiles, parkBoundaryEdges } from './park-boundary';
import { terrainTriangles } from './oracle-terrain';
import { GROUND_OBJECT_ID, LAND_OVERLAY_OBJECT_ID, WATER_OBJECT_ID } from './object-kinds';
import type { ObjectIdCapture } from './webgl2-renderer';
import type { TerrainSurface } from './world-art';
import { buildObjectPickTargets, pickTopmostObject } from '../input/object-picking';
import type { ObjectPickTarget } from '../input/object-picking';
import { guestFrame, guestSpriteIndex, staffSpriteName } from './webgl2-renderer';
import { anchorKey } from './depth-key';
import { peopleSpriteKey, walkingFrame } from './people-art';
import { FLOWER_BED } from '../sim/staff/grounds';
import { AMBIENT_TREE_BOX, FLOWER_BED_BOX, GUEST_BOX, STAFF_BOX } from './sprite-layout';
import {
  PATH_SURFACE_Z,
  pathAdditionBox,
  pathAdditionPlacements,
  pathAdditionGroundZ,
  pathAdditionView,
  flowerBedGroundZ,
  sceneryBox,
  sceneryGroundZ,
} from './ground-anchor';
import {
  clipTerrainTileTrianglesBelowHeight,
  terrainContourViewEdges,
  terrainEdgeFace,
  terrainEdgeFacesViewer,
  terrainNeighborEdgeBase,
  terrainLightFactor,
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
/** Levels added to the height of track drawn through the terrain, so it wins every depth test. */
const XRAY_HEIGHT_BOOST = 200;
const XRAY_ALPHA = 0.55;
const COASTER_CULL_RADIUS = 160;
const SEAM = 0.5;
/** Ground-layer key offset of a raised tile repainted over the cliff faces behind it. */
const RAISED_TILE_REDRAW = 5;
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
  private readonly rideCells = new RideCellScene();
  private tick = 0;
  private patrolStaffId: number | null = null;
  private patrolPreview: readonly [number, number] | null = null;
  private patrolPreviewRemove = false;
  private drawOrder: { depth: number; order: number; draw: () => void; ground: boolean }[] = [];
  private surface: DepthSurface | null = null;
  private recordIds = false;
  private landOverlay = false;
  private undergroundView = false;
  private landOverlayMap: MapData | null = null;
  private landOverlayCodes = new Int16Array(0);
  /** Bumped with every new map, keying the composite's cached ground heights. */
  private groundRevision = 0;
  private nextDrawOrder = 0;
  private pickCacheKey = '';
  private pickCacheSnapshot: Snapshot | null = null;
  private pickTargets: ObjectPickTarget[] = [];

  get visibleSpriteCount(): number {
    return this.visibleCount;
  }

  objectTargets(
    snapshot: Snapshot | null,
    camera: Camera,
    viewport: { width: number; height: number },
  ): readonly ObjectPickTarget[] {
    if (!this.map || !this.atlas) return [];
    const key = `${snapshot?.revision ?? -1}:${camera.x}:${camera.y}:${camera.zoom}:${camera.rotation}:${viewport.width}:${viewport.height}:${this.atlas.version}`;
    if (key !== this.pickCacheKey || snapshot !== this.pickCacheSnapshot) {
      this.pickTargets = buildObjectPickTargets(snapshot, this.map, camera, viewport, this.atlas);
      this.pickCacheKey = key;
      this.pickCacheSnapshot = snapshot;
    }
    return this.pickTargets;
  }

  pickObject(
    snapshot: Snapshot | null,
    camera: Camera,
    screenX: number,
    screenY: number,
    viewport: { width: number; height: number },
  ): ObjectPickTarget | null {
    return pickTopmostObject(this.objectTargets(snapshot, camera, viewport), screenX, screenY);
  }

  private heldPerson: { person: 'guest' | 'staff'; id: number } | null = null;
  private heldGuestSlot = -1;
  private heldStaffSlot = -1;

  setHeldPerson(person: 'guest' | 'staff' | null, id = -1): void {
    this.heldPerson = person ? { person, id } : null;
  }

  private resolveHeldSlots(snapshot: Snapshot | null): void {
    const held = this.heldPerson;
    this.heldGuestSlot =
      held?.person === 'guest' && snapshot ? snapshot.guestIds.indexOf(held.id) : -1;
    this.heldStaffSlot =
      held?.person === 'staff' && snapshot ? snapshot.staffIds.indexOf(held.id) : -1;
  }

  setPatrolStaff(staffId: number | null): void {
    this.patrolStaffId = staffId;
  }

  setPatrolPreview(tile: readonly [number, number] | null, remove: boolean): void {
    this.patrolPreview = tile;
    this.patrolPreviewRemove = remove;
  }

  attach(canvas: HTMLCanvasElement): void {
    // Sprites are depth-composited in memory each frame, so keep the canvas readable cheaply.
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    const surface = new DepthSurface(ctx, spritePages);
    this.surface = surface.available ? surface : null;
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
    this.groundRevision++;
    this.pickCacheKey = '';
    this.pickCacheSnapshot = null;
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

  setUndergroundView(visible: boolean): void {
    this.undergroundView = visible;
  }

  setLandOverlay(visible: boolean): void {
    this.landOverlay = visible;
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
    const real = this.ctx;
    const map = this.map;
    if (!real) return;
    const ctx = this.surface?.context ?? real;
    this.resolveHeldSlots(snapshot);
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
    if (snapshot) this.rideCells.build(snapshot, map, cam.rotation);
    else this.rideCells.reset();
    this.drawTiles(ctx, map, cam, snapshot);
    this.drawParkFence(ctx, map, cam);
    if (snapshot) {
      this.drawParkGate(ctx, snapshot, map, cam);
      this.drawRideMarkers(ctx, snapshot, map, cam);
      const coasterSprites = this.drawCoasters(ctx, snapshot, map, cam);
      if (snapshot.tracks && !coasterSprites)
        this.drawLayer(ctx, snapshot.tracks, map, cam, 5, '#cf5650');
      this.drawLayer(
        ctx,
        snapshot.vehicles,
        map,
        cam,
        4,
        '#c0392b',
        coasterSprites ? (word) => this.coasterScene.drawsRide(word >>> 16) : undefined,
      );
      this.drawLitter(ctx, snapshot.litter, map, cam);
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
    for (const item of this.drawOrder) if (item.ground) item.draw();
    const surface = this.surface;
    if (surface)
      surface.compose(
        real.canvas.width,
        real.canvas.height,
        { scale, x: this.cw / 2 - cam.x * scale, y: this.ch / 2 - cam.y * scale },
        `${this.groundRevision}:${cam.x}:${cam.y}:${cam.zoom}:${cam.rotation}:${this.dpr}:${this.landOverlay}`,
        () =>
          terrainTriangles(
            map,
            cam,
            this.cw / this.dpr,
            this.ch / this.dpr,
            this.dpr,
            this.landOverlay,
          ),
        this.recordIds,
      );
    for (const item of this.drawOrder) if (!item.ground) item.draw();
    surface?.finish();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /**
   * Draws one frame and returns its object-ID image: the id of the object seen at every backing
   * pixel, in the same format as the WebGL2 renderer's capture (see object-kinds.ts).
   */
  captureObjectIds(snapshot: Snapshot | null, cam: Camera): ObjectIdCapture {
    if (!this.surface || !this.map) throw new Error('Canvas2D renderer cannot capture object ids');
    this.recordIds = true;
    try {
      this.draw(snapshot, cam);
    } finally {
      this.recordIds = false;
    }
    const { ids, sprites, kinds } = this.surface.capture();
    kinds.set(GROUND_OBJECT_ID, 'ground');
    kinds.set(WATER_OBJECT_ID, 'water');
    kinds.set(LAND_OVERLAY_OBJECT_ID, 'land-overlay');
    const pages = [...new Set(sprites.map((sprite) => sprite.page))].sort((a, b) => a - b);
    const { width, height } = this.ctx!.canvas;
    return { width, height, ids, sprites, kinds, pages };
  }

  private enqueue(
    map: MapData,
    cam: Camera,
    x: number,
    y: number,
    z: number,
    draw: () => void,
  ): void {
    this.queueAtDepth(anchorKey(map, cam.rotation, x, y, z), draw);
  }

  /**
   * Queues ground drawing (cliff faces, raised-tile redraws), painted onto the canvas in key order
   * before world sprites are depth-composited over it. `offset` orders ground pieces among
   * themselves only; it never decides what hides a world object.
   */
  private enqueueGround(
    map: MapData,
    cam: Camera,
    x: number,
    y: number,
    z: number,
    offset: number,
    draw: () => void,
  ): void {
    this.queueAtDepth(anchorKey(map, cam.rotation, x, y, z) + offset, draw, true);
  }

  private queueAtDepth(depth: number, draw: () => void, ground = false): void {
    this.drawOrder.push({
      depth,
      order: this.nextDrawOrder++,
      draw,
      ground,
    });
  }

  /**
   * Projects a sprite's ground pivot into `out` and makes its height the anchor height of the
   * next sprite composited (docs.md, "Occlusion model").
   */
  private anchor(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    rotation: Camera['rotation'],
    out: Float64Array | number[],
  ): void {
    project(x, y, z, width, height, rotation, out as Float64Array);
    if (this.surface) this.surface.anchorHeight = z / Z_STEP;
  }

  private drawTiles(
    ctx: CanvasRenderingContext2D,
    map: MapData,
    cam: Camera,
    snapshot: Snapshot | null,
  ): void {
    const [vw, vh] = viewSize(map.width, map.height, cam.rotation);
    let patrolArea = 0;
    if (snapshot && this.patrolStaffId !== null) {
      for (let slot = 0; slot < snapshot.staff.count; slot++)
        if (snapshot.staffIds[slot] === this.patrolStaffId)
          patrolArea = snapshot.patrolAreaIds[slot]!;
    }
    const z = cam.zoom;
    const minX = cam.x - this.cw / 2 / (z * this.dpr) - TILE_W;
    const maxX = cam.x + this.cw / 2 / (z * this.dpr) + TILE_W;
    // Raised terrain draws above its tile's base row and anything standing up to 32 levels above
    // the terrain (raised paths, track) draws above it, so tiles are kept 32 levels beyond both
    // edges.
    const minY = cam.y - this.ch / 2 / (z * this.dpr) - TILE_H - 32 * Z_PIXELS;
    const maxY = cam.y + this.ch / 2 / (z * this.dpr) + TILE_H + 32 * Z_PIXELS;
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
        if (mask !== 0) {
          const light = terrainLightFactor([
            ((mask >> top) & 1) * 64,
            ((mask >> ((top + 1) & 3)) & 1) * 64,
            ((mask >> ((top + 2) & 3)) & 1) * 64,
            ((mask >> ((top + 3) & 3)) & 1) * 64,
          ]);
          if (light !== 1) {
            ctx.fillStyle =
              light > 1
                ? `rgba(255, 255, 255, ${(light - 1) * 1.3})`
                : `rgba(0, 0, 0, ${1 - light})`;
            ctx.beginPath();
            ctx.moveTo(sx, sy - liftTop);
            ctx.lineTo(sx + TILE_W / 2, sy + TILE_H / 2 - liftRight);
            ctx.lineTo(sx, sy + TILE_H - liftBottom);
            ctx.lineTo(sx - TILE_W / 2, sy + TILE_H / 2 - liftLeft);
            ctx.closePath();
            ctx.fill();
          }
        }
        const blocksWide = Math.ceil(map.width / 4);
        const block = (y >>> 2) * blocksWide + (x >>> 2);
        const patrolOffset = patrolArea > 0 ? (patrolArea - 1) * snapshot!.patrolWordsPerArea : 0;
        const marked =
          patrolArea > 0 &&
          (snapshot!.patrolAreas[patrolOffset + (block >>> 5)]! & (1 << (block & 31))) !== 0;
        if (marked) {
          this.drawPatrolTile(ctx, map, cam, x, y, i, mask, 'active');
        }
        if (
          this.patrolPreview &&
          this.patrolPreview[0] >>> 2 === x >>> 2 &&
          this.patrolPreview[1] >>> 2 === y >>> 2 &&
          (this.patrolPreviewRemove ? marked : !marked)
        ) {
          this.drawPatrolTile(
            ctx,
            map,
            cam,
            x,
            y,
            i,
            mask,
            this.patrolPreviewRemove ? 'remove' : 'add',
          );
        }
        const overlay = this.landOverlay ? this.landOverlayFor(map)[i]! : -1;
        if (overlay >= 0) this.drawLandOverlayTile(ctx, map, cam, x, y, i, mask, overlay);
        this.enqueueGround(map, cam, x * TILE_UNITS, y * TILE_UNITS, terrainZ, 0.25, () =>
          this.drawCliffFaces(ctx, map, cam, x, y, i, mask, terrainSurface),
        );
        if (cam.showGridlines) {
          ctx.strokeStyle = 'rgba(28, 34, 26, 0.18)';
          ctx.lineWidth = 0.7;
          ctx.stroke();
          const contours = terrainContourViewEdges(map, x, y, cam.rotation);
          if (contours !== 0) {
            const vertices = [
              [sx, sy - liftTop],
              [sx + TILE_W / 2, sy + TILE_H / 2 - liftRight],
              [sx, sy + TILE_H - liftBottom],
              [sx - TILE_W / 2, sy + TILE_H / 2 - liftLeft],
            ] as const;
            ctx.strokeStyle = 'rgba(18, 26, 12, 0.45)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            for (let edge = 0; edge < 4; edge++) {
              if (!(contours & (1 << edge))) continue;
              const from = vertices[edge]!;
              const to = vertices[(edge + 1) & 3]!;
              ctx.moveTo(from[0], from[1]);
              ctx.lineTo(to[0], to[1]);
            }
            ctx.stroke();
          }
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
          // Redrawn from its rearmost corner, after the cliff faces of the tiles behind it.
          this.enqueueGround(
            map,
            cam,
            (cam.rotation >= 2 ? x + 1 : x) * TILE_UNITS,
            (cam.rotation === 1 || cam.rotation === 2 ? y + 1 : y) * TILE_UNITS,
            terrainZ,
            RAISED_TILE_REDRAW,
            () =>
              this.drawTerrainOccluder(ctx, map, cam, x, y, i, mask, terrainSurface, sx, sy, lift),
          );
        }
        const centerX = x * TILE_UNITS + TILE_UNITS / 2;
        const centerY = y * TILE_UNITS + TILE_UNITS / 2;
        const groundFlowerBed = Boolean((snapshot?.grounds[i] ?? 0) & FLOWER_BED);
        let sceneryFlowerBed = false;
        const tileScenery = map.sceneryElements;
        if (tileScenery) {
          for (let item = this.sceneryOffsets[i]!; item < this.sceneryOffsets[i + 1]!; item++) {
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
            () => this.drawGroundProps(ctx, map, cam, snapshot, i, x, y),
          );
        for (
          let path = this.pathOffsets[i];
          map.pathElements && path < this.pathOffsets[i + 1];
          path++
        ) {
          const element = this.pathIndices[path]! * 6;
          this.enqueue(map, cam, centerX, centerY, map.pathElements[element + 2]! * Z_STEP, () =>
            this.drawMapElements(ctx, map, cam, i, 'slab'),
          );
          break;
        }
        for (
          let path = this.pathOffsets[i];
          map.pathElements && path < this.pathOffsets[i + 1];
          path++
        ) {
          const element = this.pathIndices[path]! * 6;
          const flags = map.pathElements[element + 3]!;
          for (const rail of queueRailSprites(flags, cam.rotation))
            this.enqueue(map, cam, centerX, centerY, map.pathElements[element + 2]! * Z_STEP, () =>
              this.drawQueueRail(ctx, map, cam, x, y, map.pathElements![element + 2]!, rail.sprite),
            );
        }
        this.enqueue(map, cam, centerX, centerY, terrainZ, () =>
          this.drawMapElements(ctx, map, cam, i, 'additions'),
        );
        for (const ghost of this.ghostsAt(map, i))
          this.enqueue(map, cam, centerX, centerY, ghost.level * Z_STEP, () =>
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
          () => this.drawSceneryElements(ctx, map, cam, i),
        );
        for (const ghost of this.spriteGhostsAt(map, i)) {
          if (ghost.kind === 'scenery')
            this.enqueue(map, cam, centerX, centerY, ghost.level * Z_STEP, () =>
              this.drawSpriteGhost(ctx, map, cam, ghost),
            );
          else if (ghost.kind === 'path-addition')
            this.enqueue(
              map,
              cam,
              ghost.x * TILE_UNITS + TILE_UNITS / 2,
              ghost.y * TILE_UNITS + TILE_UNITS / 2,
              ghost.level * Z_STEP,
              () => this.drawSpriteGhost(ctx, map, cam, ghost),
            );
        }
        this.visibleCount++;
      }
    }
  }

  /** Per tile: -1 where the park owns the land, else sale borders (world edges) + 16 * offer. */
  private landOverlayFor(map: MapData): Int16Array {
    if (this.landOverlayMap === map) return this.landOverlayCodes;
    const codes = new Int16Array(map.width * map.height).fill(-1);
    for (const tile of landOverlayTiles(map))
      codes[tile.y * map.width + tile.x] = tile.borders + tile.sale * 16;
    this.landOverlayMap = map;
    this.landOverlayCodes = codes;
    return codes;
  }

  /**
   * The land overlay on one tile, painted onto the ground during the terrain walk so terrain in
   * front still covers it and world sprites composite over it: a dark wash and dashed sale borders.
   */
  private drawLandOverlayTile(
    ctx: CanvasRenderingContext2D,
    map: MapData,
    cam: Camera,
    x: number,
    y: number,
    index: number,
    mask: number,
    code: number,
  ): void {
    const corners = terrainTileCorners(x, y, map.heights[index]!, mask);
    const points = corners.map((corner) => {
      project(
        corner.x * TILE_UNITS,
        corner.y * TILE_UNITS,
        corner.height * Z_STEP,
        map.width,
        map.height,
        cam.rotation,
        this.tmp,
      );
      return [this.tmp[0]!, this.tmp[1]!] as const;
    });
    ctx.beginPath();
    points.forEach(([px, py], corner) => (corner === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(10, 14, 10, 0.58)';
    ctx.fill();
    const sale = code >> 4;
    if (sale === 0) return;
    // World edge e runs from corner (e + 1) & 3 to corner (e + 2) & 3.
    ctx.lineWidth = 2.5 / (cam.zoom * this.dpr);
    ctx.strokeStyle = sale === SALE_RIGHTS ? '#63c3e8' : '#f3ce57';
    ctx.setLineDash(sale === SALE_LAND ? [5, 3] : sale === SALE_RIGHTS ? [2, 2] : [1, 4]);
    for (let edge = 0; edge < 4; edge++) {
      if (!(code & (1 << edge))) continue;
      const [ax, ay] = points[(edge + 1) & 3]!;
      const [bx, by] = points[(edge + 2) & 3]!;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private drawPatrolTile(
    ctx: CanvasRenderingContext2D,
    map: MapData,
    cam: Camera,
    x: number,
    y: number,
    index: number,
    mask: number,
    tone: 'active' | 'add' | 'remove',
  ): void {
    const corners = terrainTileCorners(x, y, map.heights[index]!, mask);
    ctx.beginPath();
    corners.forEach((corner, cornerIndex) => {
      project(
        corner.x * TILE_UNITS,
        corner.y * TILE_UNITS,
        corner.height * Z_STEP,
        map.width,
        map.height,
        cam.rotation,
        this.tmp,
      );
      if (cornerIndex === 0) ctx.moveTo(this.tmp[0]!, this.tmp[1]!);
      else ctx.lineTo(this.tmp[0]!, this.tmp[1]!);
    });
    ctx.closePath();
    ctx.fillStyle =
      tone === 'active'
        ? 'rgba(67, 137, 255, 0.28)'
        : tone === 'add'
          ? 'rgba(255, 255, 255, 0.16)'
          : 'rgba(230, 68, 54, 0.3)';
    ctx.strokeStyle = tone === 'active' ? '#9fc8ff' : tone === 'add' ? '#ffffff' : '#ff594f';
    ctx.lineWidth = (tone === 'active' ? 1.5 : 2) / (cam.zoom * this.dpr);
    ctx.setLineDash(
      tone === 'active' ? [] : [3 / (cam.zoom * this.dpr), 3 / (cam.zoom * this.dpr)],
    );
    ctx.fill();
    ctx.stroke();
    if (tone !== 'active') ctx.setLineDash([]);
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

  private drawCliffFaces(
    ctx: CanvasRenderingContext2D,
    map: MapData,
    cam: Camera,
    x: number,
    y: number,
    index: number,
    mask: number,
    surface: TerrainSurface,
  ): void {
    const corners = terrainTileCorners(x, y, map.heights[index]!, mask);
    for (let direction = 0; direction < 4; direction++) {
      if (!terrainEdgeFacesViewer(direction, cam.rotation)) continue;
      const neighborBase = terrainNeighborEdgeBase(map, x, y, direction);
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
        terrainCliffSpriteName(surface, (direction + cam.rotation) & 3),
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
    ctx.imageSmoothingEnabled = false;

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
      this.anchor(
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
    for (const placement of pathAdditionPlacements(flags, baseHeight)) {
      this.anchor(
        centerX + placement.x,
        centerY + placement.y,
        placement.groundZ,
        map.width,
        map.height,
        cam.rotation,
        this.tmp,
      );
      this.drawPathAddition(ctx, flags, data, pathAdditionView(placement.edge, cam.rotation));
    }
  }

  private drawMapElements(
    ctx: CanvasRenderingContext2D,
    map: MapData,
    cam: Camera,
    tile: number,
    part: 'slab' | 'additions',
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
      this.anchor(centerX, centerY, z, map.width, map.height, cam.rotation, this.pathLow);
      if (part === 'additions') {
        this.drawPathAdditions(ctx, map, cam, flags, paths[o + 4], paths[o + 2]!, centerX, centerY);
        continue;
      }
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
    this.anchor(
      ghost.x * TILE_UNITS + TILE_UNITS / 2,
      ghost.y * TILE_UNITS + TILE_UNITS / 2,
      ghost.level * Z_STEP,
      map.width,
      map.height,
      cam.rotation,
      this.pathLow,
    );
    if (!this.isVisible(this.pathLow[0]!, this.pathLow[1]!, cam, 40)) return;
    if (ghost.sprite.startsWith('scenery/flower-bed/') || ghost.sprite.includes('/edge-'))
      drawGhostSprite(
        ctx,
        this.atlas,
        ghost.sprite,
        Math.round(this.pathLow[0]!),
        Math.round(this.pathLow[1]!),
        ghost.tone,
      );
    else
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
    this.anchor(
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
    for (const rail of queueRailSprites(ghost.flags, cam.rotation))
      drawGhostSprite(ctx, this.atlas, rail.sprite, this.pathLow[0], this.pathLow[1], ghost.tone);
  }

  /** One queue rail along a tile edge, drawn after the people standing on the tile. */
  private drawQueueRail(
    ctx: CanvasRenderingContext2D,
    map: MapData,
    cam: Camera,
    x: number,
    y: number,
    base: number,
    sprite: string,
  ): void {
    if (!this.atlas) return;
    this.anchor(
      x * TILE_UNITS + 128,
      y * TILE_UNITS + 128,
      base * Z_STEP,
      map.width,
      map.height,
      cam.rotation,
      this.pathLow,
    );
    if (!this.isVisible(this.pathLow[0], this.pathLow[1], cam, 22)) return;
    drawAnchoredSprite(ctx, this.atlas, sprite, this.pathLow[0], this.pathLow[1]);
  }

  /** The park boundary fence: a wall-style sprite on every edge of owned land. */
  private drawParkFence(ctx: CanvasRenderingContext2D, map: MapData, cam: Camera): void {
    const atlas = this.atlas;
    if (!atlas) return;
    const edges = parkBoundaryEdges(map);
    for (let i = 0; i < edges.length; i += 3) {
      const x = edges[i]!;
      const y = edges[i + 1]!;
      const edge = edges[i + 2]!;
      const tile = y * map.width + x;
      const z = map.heights[tile]! * Z_STEP;
      const worldX = x * TILE_UNITS + TILE_UNITS / 2;
      const worldY = y * TILE_UNITS + TILE_UNITS / 2;
      this.enqueue(map, cam, worldX, worldY, z, () => {
        this.anchor(worldX, worldY, z, map.width, map.height, cam.rotation, this.tmp);
        if (!this.isVisible(this.tmp[0]!, this.tmp[1]!, cam, 64)) return;
        drawAnchoredSprite(
          ctx,
          atlas,
          wallSpriteName(PARK_FENCE, edge, map.slope[tile]!, cam.rotation),
          this.tmp[0]!,
          this.tmp[1]!,
        );
      });
    }
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
      const flags = scenery[offset + 3]!;
      const wall = isWallScenery(scenery[offset + 4]!);
      const z = wall
        ? map.heights[tile]! * Z_STEP
        : sceneryGroundZ(map.heights[tile]!, map.slope[tile]!, cam.rotation);
      const definition = SCENERY_CATALOG[scenery[offset + 4]];
      if (!definition) continue;
      const box = sceneryBox(definition);
      this.anchor(
        x * TILE_UNITS + TILE_UNITS / 2,
        y * TILE_UNITS + TILE_UNITS / 2,
        z,
        map.width,
        map.height,
        cam.rotation,
        this.tmp,
      );
      if (!this.isVisible(this.tmp[0], this.tmp[1], cam, Math.max(box.width, box.height))) continue;
      const sprite = wall
        ? wallSpriteName(definition.sprite, flags, map.slope[tile]!, cam.rotation)
        : definition.sprite === 'flower-bed'
          ? flowerBedSpriteName(x, y, cam.rotation, map.slope[tile]!)
          : definition.sprite === 'shrub'
            ? shrubSpriteName(x, y, cam.rotation)
            : scenerySpriteName(definition.sprite, cam.rotation);
      const drewSprite =
        this.atlas &&
        (wall || definition.sprite === 'flower-bed'
          ? drawAnchoredSprite(ctx, this.atlas, sprite, this.tmp[0]!, this.tmp[1]!)
          : drawBoxedSprite(
              ctx,
              this.atlas,
              sprite,
              this.tmp[0]!,
              this.tmp[1]!,
              box.width,
              box.height,
            ));
      if (drewSprite) {
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
        this.enqueue(map, cam, worldX, worldY, z, () => {
          this.anchor(worldX, worldY, z, map.width, map.height, cam.rotation, this.tmp);
          if (!this.isVisible(this.tmp[0]!, this.tmp[1]!, cam, 24)) return;
          const facing = rideHutFacingForFootprint(
            type,
            snapshot.rideInfo[o + RideInfo.RideX]!,
            snapshot.rideInfo[o + RideInfo.RideY]!,
            snapshot.rideInfo[o + RideInfo.Dir]!,
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
    this.enqueue(map, cam, worldX, worldY, z, () => {
      this.anchor(worldX, worldY, z, map.width, map.height, cam.rotation, this.tmp);
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
    for (let i = 0; i < this.rideCells.length; i++) {
      const item = this.rideCells.items[i]!;
      this.queueAtDepth(item.depth, () => this.drawRideCell(ctx, item, snapshot, map, cam));
    }
    for (let i = 0; i < snapshot.rides.count; i++) {
      const offset = i * RIDE_INFO_STRIDE;
      const type = snapshot.rideInfo[offset + RideInfo.Type] as RideType;
      const definition = RIDE_CATALOG[type];
      const tileX = snapshot.rideInfo[offset + RideInfo.RideX];
      const tileY = snapshot.rideInfo[offset + RideInfo.RideY];
      if (
        !definition ||
        definition.usesTrack ||
        isSlicedRide(type) ||
        tileX < 0 ||
        tileY < 0 ||
        tileX >= map.width ||
        tileY >= map.height
      )
        continue;

      const z = map.heights[tileY * map.width + tileX] * Z_STEP;
      const worldX = tileX * TILE_UNITS + TILE_UNITS / 2;
      const worldY = tileY * TILE_UNITS + TILE_UNITS / 2;
      this.enqueue(map, cam, worldX, worldY, z, () => {
        this.anchor(worldX, worldY, z, map.width, map.height, cam.rotation, this.tmp);
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
      this.enqueue(map, cam, worldX, worldY, ghost.level * Z_STEP, () =>
        this.drawSpriteGhost(ctx, map, cam, ghost),
      );
    }
  }

  /** One footprint slice of a flat ride; a slice missing from the atlas is simply not drawn. */
  private drawRideCell(
    ctx: CanvasRenderingContext2D,
    item: RideCellDraw,
    snapshot: Snapshot,
    map: MapData,
    cam: Camera,
  ): void {
    const atlas = this.atlas;
    const entry = atlas?.resolve(item.key);
    if (!atlas || !entry) return;
    this.anchor(item.x, item.y, item.z, map.width, map.height, cam.rotation, this.tmp);
    const frameIndex = rideSpriteFrame(item.phase, snapshot.tick, entry.frames.length);
    const frame = entry.frames[frameIndex] ?? entry.frames[0]!;
    const margin = Math.max(frame.width - entry.anchor.x, entry.anchor.x, frame.height);
    if (!this.isVisible(this.tmp[0]!, this.tmp[1]!, cam, margin)) return;
    drawAnchoredSprite(ctx, atlas, item.key, this.tmp[0]!, this.tmp[1]!, frameIndex);
    this.visibleCount++;
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
    scene.build(snapshot, map, cam.rotation, this.undergroundView);
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
        this.anchor(item.x, item.y, item.z, map.width, map.height, cam.rotation, t);
        if (!this.isVisible(t[0]!, t[1]!, cam, COASTER_CULL_RADIUS)) return;
        if (item.xray) {
          if (this.surface) this.surface.anchorHeight += XRAY_HEIGHT_BOOST;
          ctx.globalAlpha = XRAY_ALPHA;
        }
        const drawn = drawAnchoredSprite(ctx, atlas, item.key, t[0]!, t[1]!);
        if (item.xray) ctx.globalAlpha = 1;
        if (drawn) {
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
      this.enqueue(map, cam, x, y, z, () => {
        ctx.fillStyle = typeof color === 'string' ? color : (color[metadata & 0xff] ?? color[0]);
        this.anchor(x, y, z, map.width, map.height, cam.rotation, t);
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
    const t = this.tmp;
    for (let index = 0, offset = 0; index < layer.count; index++, offset += SNAPSHOT_STRIDE) {
      const x = data[offset]!;
      const y = data[offset + 1]!;
      const z = data[offset + 2]! + PATH_SURFACE_Z;
      const kind = data[offset + 3]! & 0xff;
      this.enqueue(map, cam, x, y, z, () => {
        this.anchor(x, y, z, map.width, map.height, cam.rotation, t);
        if (!this.isVisible(t[0]!, t[1]!, cam, 8)) return;
        if (
          !this.atlas ||
          !drawBoxedSprite(
            ctx,
            this.atlas,
            litterSpriteName(kind, cam.rotation),
            t[0]!,
            t[1]!,
            LITTER_SPRITE_SIZE.width,
            LITTER_SPRITE_SIZE.height,
          )
        ) {
          ctx.fillStyle = kind === 1 ? '#9fc35b' : '#6b4f2a';
          ctx.fillRect(t[0]! - 2, t[1]! - 1, 4, 2);
        }
        this.visibleCount++;
      });
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
      const z = d[o + 2]! + PATH_SURFACE_Z;
      const metadata = d[o + 3]!;
      if (isRidingGuestRow(metadata) || i === this.heldGuestSlot) continue;
      this.enqueue(map, cam, x, y, z, () => {
        this.anchor(x, y, z, map.width, map.height, cam.rotation, t);
        if (!this.isVisible(t[0]!, t[1]!, cam, GUEST_BOX.height)) return;
        const sprite = `people/guest-walk#${guestSpriteIndex(metadata & 0xff, guestRowHeading(metadata), guestFrame(tick, guestRowIdle(metadata)), cam.rotation) - 40}`;
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
      const z = d[o + 2]! + PATH_SURFACE_Z;
      const metadata = d[o + 3]!;
      if (i === this.heldStaffSlot) continue;
      this.enqueue(map, cam, x, y, z, () => {
        this.anchor(x, y, z, map.width, map.height, cam.rotation, t);
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
      this.anchor(worldX, worldY, z + offsetZ, map.width, map.height, cam.rotation, this.tmp);
      if (!this.isVisible(this.tmp[0], this.tmp[1], cam, Math.max(width, height))) return;
      const drawn = name.includes('/flower-bed/')
        ? drawAnchoredSprite(ctx, atlas, name, this.tmp[0], this.tmp[1])
        : drawBoxedSprite(ctx, atlas, name, this.tmp[0], this.tmp[1], width, height);
      if (drawn) this.visibleCount++;
    };
    const tree = ambientTreeName(map.surface[tile]!, x, y);
    if (tree)
      place(
        scenerySpriteName(tree, cam.rotation),
        0,
        AMBIENT_TREE_BOX.width,
        AMBIENT_TREE_BOX.height,
      );
    if (snapshot && ((snapshot.grounds[tile] ?? 0) & FLOWER_BED) !== 0)
      place(
        flowerBedSpriteName(x, y, cam.rotation, map.slope[tile]!),
        flowerBedGroundZ(map.heights[tile]!, map.slope[tile]!, cam.rotation) - z,
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
  const [ux, uy] = unrotateTile(x, y, width, height, rotation);
  out[0] = ux;
  out[1] = uy;
}

import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import {
  SNAPSHOT_STRIDE,
  guestRowHeading,
  guestRowIdle,
  isRidingGuestRow,
} from '../worker/snapshot';
import type { Snapshot, SnapshotLayer } from '../worker/snapshot';
import { RideFlag, RideInfo, RIDE_INFO_STRIDE } from '../worker/snapshot';
import { PathFlag, Surface } from '../sim/map/tile-map';
import { FLOWER_BED } from '../sim/staff/grounds';
import { SCENERY_CATALOG } from '../sim/map/scenery';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import type { RideType } from '../sim/rides/ride-types';
import {
  tileBankDepth,
  tileWaterDepth,
  terrainEdgeFace,
  terrainContourViewEdges,
  terrainLightFactor,
  terrainShorelineSegments,
  terrainTileCorners,
  viewTerrainCornerHeights,
  waterIntersectsTerrainTile,
} from './terrain-geometry';
import type { Camera, MapData, PathPieceGhost, Renderer, SpriteGhost } from './renderer';
import { AMBIENT_TREE_BOX, FLOWER_BED_BOX, GUEST_BOX, PARK_GATE_BOX } from './sprite-layout';
import {
  adjustDepthForGroundZ,
  pathAdditionBox,
  pathAdditionPlacements,
  pathAdditionGroundZ,
  pathAdditionView,
  flowerBedGroundZ,
  sceneryBox,
  sceneryGroundZ,
} from './ground-anchor';
import { spriteAnchorScreenShift } from './ground-anchor';
import {
  TILE_H,
  TILE_W,
  Z_PIXELS,
  project,
  rotateDirection,
  rotateTile,
  unrotateTile,
} from './projection';
import { spritePages } from './sprite-pages';
import { peopleSpriteKey, walkingFrame } from './people-art';
import type { PageFrame, SpriteEntry } from './sprite-pages';
import { CoasterScene } from './coaster-scene';
import { buildTextureRuns } from './texture-runs';
import { chunkRange, LruCache, tileChunkRange } from './ground-chunks';
import type { ChunkRange } from './ground-chunks';
import { sortByDepth } from './painter-order';
import { TERRAIN_OCCLUDER_DEPTH_OFFSET, sceneryDepth } from './terrain-occlusion';
import { RideCellScene, isSlicedRide } from './ride-scene';
import {
  SOLID_BIAS,
  SurfaceDepths,
  pathSlabDepth,
  personDepth,
  queueRailDepth,
  rotatedPositionSum,
} from './depth-key';
import { OwnershipOverlay } from './ownership-overlay';
import { buildObjectPickTargets, pickTopmostObject } from '../input/object-picking';
import type { ObjectPickTarget } from '../input/object-picking';
import type { Rotation } from './projection';
import {
  pathElementSprite,
  queueRailSprites,
  flowerBedSpriteName,
  pathSpriteName,
  pathAdditionSpriteName,
  litterSpriteName,
  rideSpriteFrame,
  rideSpriteKey,
  facilityFacingFromPaths,
  facilitySpriteKey,
  LITTER_SPRITE_SIZE,
  rideHutFacingForFootprint,
  rideHutSpriteKey,
  spriteViewName,
  terrainCliffSpriteName,
  scenerySpriteName,
  shrubSpriteName,
  spriteAnchorWorldOffset,
  terrainSurfaceSpriteName,
  WATER_BANK,
  nativeSpriteWorldOffset,
  waterFrameIndex,
  waterSpriteName,
  ambientTreeName,
} from './world-art';

const CELL = 64;
/** Present in the atlas only once the generated coaster art has been packed. */
const ATLAS_COLUMNS = 8;
const ATLAS_ROWS = 7;
const FALLBACK_WIDTH = CELL * ATLAS_COLUMNS;
const FALLBACK_HEIGHT = CELL * ATLAS_ROWS;
const INSTANCE_FLOATS = 19;
/** Instance float holding the atlas page slot, then the ghost mode (0 none, 1 accepted, 2 refused). */
const SLOT_FLOAT = 17;
const GHOST_FLOAT = 18;
/** Opacity of footpath placement previews drawn in the world. */
const GHOST_ALPHA = 0.55;
/** Atlas pages sampled by one draw call; a frame needing more splits into several draws. */
const TEXTURE_SLOTS = 8;
const INITIAL_INSTANCE_CAPACITY = 16_384;
/** World pixels per side of a cached ground texture; one texel per world pixel. */
const GROUND_CHUNK_SIZE = 512;
const GROUND_CHUNK_CAPACITY = 48;
const BACKGROUND = [0.06, 0.08, 0.1, 1] as const;

function glslFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

type SpriteBlendContext = Pick<
  WebGL2RenderingContext,
  'BLEND' | 'SRC_ALPHA' | 'ONE_MINUS_SRC_ALPHA' | 'enable' | 'blendFunc'
>;

export function enableSpriteAlphaBlending(gl: SpriteBlendContext): void {
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

export function terrainSpriteIndex(surface: number, slopeMask: number): number {
  let flatSprite: number;
  switch (surface) {
    case 0:
      flatSprite = 0;
      break;
    case 1:
      flatSprite = 2;
      break;
    case 2:
      return 8;
    case 3:
      return 9;
    case 4:
      flatSprite = 4;
      break;
    case 5:
      flatSprite = 6;
      break;
    case 6:
      return 10;
    default:
      return 0;
  }
  return flatSprite + (slopeMask ? 1 : 0);
}

export function staffSpriteName(kind: number): string {
  return `people/staff-costumes#${(kind >= 0 && kind <= 3 ? kind : 0) * 4}`;
}

/** Animation frame for a guest: the walk cycle, or a slow weight shift while standing still. */
export function guestFrame(tick: number, idle: boolean): number {
  return idle ? 1 + 2 * ((tick >>> 5) & 1) : tick >>> 2;
}

/** Sprite index of a guest: `heading` is the world walking direction, shown as seen at `rotation`. */
export function guestSpriteIndex(
  tint: number,
  heading: number,
  frame: number,
  rotation: Rotation = 0,
): number {
  const palette = ((tint % 8) + 8) % 8;
  const direction =
    Number.isInteger(heading) && heading >= 0 && heading < 4
      ? rotateDirection(heading, rotation)
      : 0;
  const animationFrame = ((frame % 4) + 4) % 4;
  return 40 + palette * 16 + direction * 4 + animationFrame;
}

const vertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aWorld;
layout(location=2) in vec2 aSize;
layout(location=3) in vec4 aUvRect;
layout(location=4) in float aMeshMode;
layout(location=5) in vec4 aCornerHeights;
layout(location=6) in float aGridlines;
layout(location=7) in float aTerrainShade;
layout(location=8) in float aSlot;
layout(location=9) in float aAnchorShift;
layout(location=10) in float aGhost;
uniform vec2 uViewport;
uniform vec2 uMapSize;
uniform vec2 uCamera;
uniform float uZoom;
uniform float uRotation;
out vec2 vUv;
out vec2 vTileUv;
out float vMeshMode;
out float vGridlines;
out float vTerrainShade;
out float vWaterDepth;
flat out float vSlot;
flat out float vGhost;
void main() {
  bool tileMesh = aMeshMode > 0.5 && aMeshMode < 3.5;
  bool faceMesh = aMeshMode > 3.5;
  float cornerHeight = aWorld.z;
  if ((aMeshMode > 0.5 && aMeshMode < 2.5) || aMeshMode > 2.5) {
    if (aCorner.x < 0.5 && aCorner.y < 0.5) cornerHeight = aCornerHeights.x;
    else if (aCorner.x >= 0.5 && aCorner.y < 0.5) cornerHeight = aCornerHeights.y;
    else if (aCorner.x >= 0.5 && aCorner.y >= 0.5) cornerHeight = aCornerHeights.z;
    else cornerHeight = aCornerHeights.w;
  }
  vec2 world = aWorld.xy;
  if (faceMesh) {
    world += aSize * aCorner.x;
    float topHeight = mix(aCornerHeights.x, aCornerHeights.y, aCorner.x);
    cornerHeight = mix(topHeight, aWorld.z, aCorner.y);
  }
  float z = tileMesh ? aWorld.z : cornerHeight;
  float rx = world.x / ${TILE_UNITS.toFixed(1)};
  float ry = world.y / ${TILE_UNITS.toFixed(1)};
  if (!tileMesh && uRotation > 0.5 && uRotation < 1.5) {
    float next = uMapSize.y - ry;
    ry = rx;
    rx = next;
  } else if (!tileMesh && uRotation > 1.5 && uRotation < 2.5) {
    rx = uMapSize.x - rx;
    ry = uMapSize.y - ry;
  } else if (!tileMesh && uRotation > 2.5) {
    float next = ry;
    ry = uMapSize.x - rx;
    rx = next;
  }
  vec2 screen = vec2((rx - ry) * ${glslFloat(TILE_W / 2)},
                     (rx + ry) * ${glslFloat(TILE_H / 2)} - z * ${glslFloat(Z_PIXELS / Z_STEP)});
  screen = (screen - uCamera) * uZoom + uViewport * 0.5;
  if (tileMesh) {
    vec2 tileOffset = vec2((aCorner.x - aCorner.y) * ${glslFloat(TILE_W / 2)},
                           (aCorner.x + aCorner.y) * ${glslFloat(TILE_H / 2)});
    tileOffset = (tileOffset - vec2(0.0, ${glslFloat(TILE_H / 2)})) * 1.0 +
                 vec2(0.0, ${glslFloat(TILE_H / 2)});
    float baseZ = aWorld.z;
    screen += tileOffset * uZoom;
    if (aMeshMode < 2.5)
      screen.y -= (cornerHeight - baseZ) * ${glslFloat(Z_PIXELS / Z_STEP)} * uZoom;
  } else if (!faceMesh) {
    screen += (aCorner - 0.5) * aSize * uZoom;
    screen.x += aAnchorShift * uZoom;
  }
  gl_Position = vec4(screen.x / uViewport.x * 2.0 - 1.0,
                     1.0 - screen.y / uViewport.y * 2.0, 0.0, 1.0);
  vec2 spriteUv = vec2(aCorner.x, 1.0 - aCorner.y);
  vUv = mix(aUvRect.xy, aUvRect.zw, spriteUv);
  vTileUv = aCorner;
  vMeshMode = aMeshMode;
  vGridlines = aGridlines;
  vTerrainShade = aTerrainShade;
  vWaterDepth = aWorld.z - cornerHeight;
  vSlot = aSlot;
  vGhost = aGhost;
}`;

const fragmentSource = `#version 300 es
precision mediump float;
in vec2 vUv;
in vec2 vTileUv;
in float vMeshMode;
in float vGridlines;
in float vTerrainShade;
in float vWaterDepth;
flat in float vSlot;
flat in float vGhost;
${Array.from({ length: TEXTURE_SLOTS }, (_, slot) => `uniform sampler2D uAtlas${slot};`).join('\n')}
out vec4 outColor;
vec4 sampleAtlas(vec2 uv) {
  int slot = int(vSlot + 0.5);
${Array.from({ length: TEXTURE_SLOTS - 1 }, (_, slot) => `  if (slot == ${slot}) return texture(uAtlas${slot}, uv);`).join('\n')}
  return texture(uAtlas${TEXTURE_SLOTS - 1}, uv);
}
void main() {
  if (vMeshMode > 2.5 && vMeshMode < 3.5 && vWaterDepth < 0.0) discard;
  outColor = sampleAtlas(vUv);
  if (vMeshMode > 1.4 && vMeshMode < 2.0) outColor = vec4(0.26, 0.53, 1.0, 0.32);
  if (vMeshMode > 1.9 && vMeshMode < 2.5) outColor = vec4(0.96, 0.2, 0.16, 0.38);
  if (vMeshMode > 1.4 && vMeshMode < 2.5) {
    vec2 edge = min(vTileUv, 1.0 - vTileUv);
    float width = max(fwidth(vTileUv.x), fwidth(vTileUv.y)) * (vMeshMode < 1.6 ? 0.55 : 1.3);
    float line = 1.0 - smoothstep(width, width * 1.8, min(edge.x, edge.y));
    vec3 border = vMeshMode > 1.9
      ? vec3(1.0, 0.28, 0.22)
      : vMeshMode < 1.6
        ? vec3(0.65, 0.82, 1.0)
        : vec3(1.0);
    outColor.rgb = mix(outColor.rgb, border, line);
    outColor.a = max(outColor.a, line * 0.95);
  }
  if (vMeshMode > 4.5) outColor = vec4(0.37, 0.29, 0.18, 1.0);
  if (vMeshMode > 2.5 && vMeshMode < 3.5) {
    float depth = vWaterDepth;
    float foam = 1.0 - step(${glslFloat(WATER_BANK.foamDepth)}, depth);
    float shallow = 1.0 - smoothstep(${glslFloat(WATER_BANK.foamDepth)}, ${glslFloat(WATER_BANK.shallowDepth)}, depth);
    float deep = smoothstep(${glslFloat(WATER_BANK.shallowDepth)}, ${glslFloat(WATER_BANK.deepDepth)}, depth);
    outColor.rgb = mix(outColor.rgb, vec3(0.12, 0.31, 0.42), deep * 0.42);
    outColor.rgb = mix(outColor.rgb, vec3(0.25, 0.45, 0.52), shallow * 0.18);
    outColor.rgb = mix(outColor.rgb, vec3(0.63, 0.75, 0.75), foam * 0.2);
    outColor.a = 0.88;
  }
  if (vMeshMode > 0.5 && vMeshMode < 1.5) outColor.rgb *= vTerrainShade;
  if (vGhost > 0.5) {
    outColor.a *= ${glslFloat(GHOST_ALPHA)};
    if (vGhost > 1.5) outColor.rgb = mix(outColor.rgb, vec3(0.9, 0.16, 0.14), 0.6);
  }
  if (vGridlines > 0.5 && vMeshMode > 0.5 && vMeshMode < 1.5) {
    vec2 edge = min(vTileUv, 1.0 - vTileUv);
    float width = max(fwidth(vTileUv.x), fwidth(vTileUv.y)) * 1.2;
    float line = 1.0 - smoothstep(width, width * 1.8, min(edge.x, edge.y));
    outColor.rgb = mix(outColor.rgb, outColor.rgb * 0.9, line * 0.1);
    int contourEdges = int(vGridlines + 0.5) - 1;
    float contour = 0.0;
    float contourWidth = max(fwidth(vTileUv.x), fwidth(vTileUv.y)) * 1.1;
    if ((contourEdges & 1) != 0)
      contour = max(contour, 1.0 - smoothstep(contourWidth, contourWidth * 1.8, vTileUv.y));
    if ((contourEdges & 2) != 0)
      contour = max(contour, 1.0 - smoothstep(contourWidth, contourWidth * 1.8, 1.0 - vTileUv.x));
    if ((contourEdges & 4) != 0)
      contour = max(contour, 1.0 - smoothstep(contourWidth, contourWidth * 1.8, 1.0 - vTileUv.y));
    if ((contourEdges & 8) != 0)
      contour = max(contour, 1.0 - smoothstep(contourWidth, contourWidth * 1.8, vTileUv.x));
    outColor.rgb = mix(outColor.rgb, vec3(0.07, 0.1, 0.05), contour * 0.6);
  }
}`;

const groundVertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
uniform vec4 uRect;
uniform vec2 uViewport;
uniform vec2 uCamera;
uniform float uZoom;
out vec2 vUv;
void main() {
  vec2 world = mix(uRect.xy, uRect.zw, aCorner);
  vec2 screen = (world - uCamera) * uZoom + uViewport * 0.5;
  gl_Position = vec4(screen.x / uViewport.x * 2.0 - 1.0,
                     1.0 - screen.y / uViewport.y * 2.0, 0.0, 1.0);
  vUv = vec2(aCorner.x, 1.0 - aCorner.y);
}`;

const groundFragmentSource = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uGround;
out vec4 outColor;
void main() {
  outColor = texture(uGround, vUv);
}`;

interface TileLists {
  map: MapData;
  rotation: Rotation;
  /** Tile indices whose water plane intersects their terrain. */
  water: Int32Array;
  /** Tile indices whose terrain rises above the tiles behind them and so must overdraw sprites. */
  occluders: Int32Array;
  waterX: Float32Array;
  waterY: Float32Array;
  occluderX: Float32Array;
  occluderY: Float32Array;
}

interface GroundIndex {
  map: MapData;
  rotation: Rotation;
  minCx: number;
  minCy: number;
  columns: number;
  rows: number;
  /** CSR offsets into `tiles` per chunk cell, row-major from (minCx, minCy). */
  starts: Int32Array;
  tiles: Int32Array;
}

/** WebGL2 renderer drawing atlas pages through an instanced quad batch in painter order. */
export class WebGL2Renderer implements Renderer {
  private ownershipOverlay: OwnershipOverlay | null = null;
  readonly backend = 'WebGL2';
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private map: MapData | null = null;
  private pickCacheKey = '';
  private pickCacheSnapshot: Snapshot | null = null;
  private pickTargets: ObjectPickTarget[] = [];
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private fallbackTexture: WebGLTexture | null = null;
  private readonly pageTextures = new Map<number, WebGLTexture>();
  private syncedPageVersion = -1;
  private attributeBase = 0;
  private readonly coasterScene = new CoasterScene();
  private readonly rideCells = new RideCellScene();
  private uniforms: {
    atlas: (WebGLUniformLocation | null)[];
    viewport: WebGLUniformLocation | null;
    mapSize: WebGLUniformLocation | null;
    camera: WebGLUniformLocation | null;
    zoom: WebGLUniformLocation | null;
    rotation: WebGLUniformLocation | null;
  } | null = null;
  private instanceData = new Float32Array(INITIAL_INSTANCE_CAPACITY * INSTANCE_FLOATS);
  private depths = new Int32Array(INITIAL_INSTANCE_CAPACITY);
  private readonly surfaceDepths = new SurfaceDepths();
  private pageIds = new Int16Array(INITIAL_INSTANCE_CAPACITY);
  private readonly runs: { start: number; count: number; pages: number[] }[] = [];
  private orderedData = new Float32Array(INITIAL_INSTANCE_CAPACITY * INSTANCE_FLOATS);
  private readonly projected = new Float64Array(2);
  private readonly tileCoordinates = new Int32Array(2);
  private order = new Int32Array(INITIAL_INSTANCE_CAPACITY);
  private orderedPages = new Int16Array(INITIAL_INSTANCE_CAPACITY);
  private bufferCapacity = 0;
  private groundProgram: WebGLProgram | null = null;
  private groundUniforms: {
    ground: WebGLUniformLocation | null;
    rect: WebGLUniformLocation | null;
    viewport: WebGLUniformLocation | null;
    camera: WebGLUniformLocation | null;
    zoom: WebGLUniformLocation | null;
  } | null = null;
  private groundFramebuffer: WebGLFramebuffer | null = null;
  private readonly groundChunks = new LruCache<WebGLTexture>(GROUND_CHUNK_CAPACITY, (texture) =>
    this.gl?.deleteTexture(texture),
  );
  private groundIndex: GroundIndex | null = null;
  private groundRotation: Rotation = 0;
  private groundArtReady = false;
  private tileLists: TileLists | null = null;
  private count = 0;
  private ghosts: readonly PathPieceGhost[] = [];
  private spriteGhosts: readonly SpriteGhost[] = [];
  private patrolStaffId: number | null = null;
  private patrolPreview: readonly [number, number] | null = null;
  private patrolPreviewRemove = false;
  private ghostMode = 0;
  private visibleCount = 0;
  private gridlinesActive = false;
  private dpr = 1;
  private lost = false;
  private readonly onLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
  };
  private readonly onRestored = (): void => {
    this.lost = false;
    this.initializeResources();
  };

  get visibleSpriteCount(): number {
    return this.visibleCount;
  }

  objectTargets(
    snapshot: Snapshot | null,
    camera: Camera,
    viewport: { width: number; height: number },
  ): readonly ObjectPickTarget[] {
    if (!this.map) return [];
    const key = `${snapshot?.revision ?? -1}:${camera.x}:${camera.y}:${camera.zoom}:${camera.rotation}:${viewport.width}:${viewport.height}:${spritePages.version}`;
    if (key !== this.pickCacheKey || snapshot !== this.pickCacheSnapshot) {
      this.pickTargets = buildObjectPickTargets(snapshot, this.map, camera, viewport, spritePages);
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

  attach(canvas: HTMLCanvasElement): void {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.canvas = canvas;
    this.gl = gl;
    if (canvas.parentElement) this.ownershipOverlay = new OwnershipOverlay(canvas.parentElement);
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.initializeResources();
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    if (!this.canvas) return;
    this.dpr = devicePixelRatio;
    this.canvas.width = Math.max(1, Math.round(width * devicePixelRatio));
    this.canvas.height = Math.max(1, Math.round(height * devicePixelRatio));
    this.gl?.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.ownershipOverlay?.resize(width, height, devicePixelRatio);
  }

  setMap(map: MapData): void {
    this.invalidateGroundFor(this.map, map);
    this.map = map;
    this.pickCacheKey = '';
    this.pickCacheSnapshot = null;
  }

  setGhosts(ghosts: readonly PathPieceGhost[]): void {
    this.ghosts = ghosts;
  }

  setSpriteGhosts(ghosts: readonly SpriteGhost[]): void {
    this.spriteGhosts = ghosts;
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

  draw(snapshot: Snapshot | null, camera: Camera): void {
    this.resolveHeldSlots(snapshot);
    const gl = this.gl;
    const canvas = this.canvas;
    const map = this.map;
    if (!gl || !canvas || !map || this.lost || !this.program || !this.vao || !this.fallbackTexture)
      return;

    this.syncPageTextures();
    const viewportWidth = canvas.width / this.dpr;
    const viewportHeight = canvas.height / this.dpr;
    this.prepareGroundCache(map, camera);
    this.ensureGroundChunks(map, camera, viewportWidth, viewportHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    this.drawGroundChunks(camera, viewportWidth, viewportHeight);

    this.count = 0;
    if (snapshot) this.rideCells.build(snapshot, map, camera.rotation);
    else this.rideCells.reset();
    if (snapshot) this.appendPatrolAreas(snapshot, map, camera, viewportWidth, viewportHeight);
    this.appendWaterAndOccluders(map, camera, viewportWidth, viewportHeight, snapshot?.tick ?? 0);
    if (snapshot) {
      this.appendAmbientTrees(map, camera, viewportWidth, viewportHeight);
      this.appendGrounds(snapshot, map, camera, viewportWidth, viewportHeight);
      this.appendPathElements(map, camera, viewportWidth, viewportHeight);
      this.appendPathGhosts(map, camera, viewportWidth, viewportHeight);
      this.appendSceneryElements(map, camera, viewportWidth, viewportHeight);
      this.appendSpriteGhosts(map, camera, viewportWidth, viewportHeight);
      this.appendParkGate(snapshot, map, camera, viewportWidth, viewportHeight);
      this.appendRideMarkers(snapshot, map, camera, viewportWidth, viewportHeight);
      const coasterSprites = this.appendCoasters(
        snapshot,
        map,
        camera,
        viewportWidth,
        viewportHeight,
      );
      if (snapshot.tracks && !coasterSprites)
        this.appendLayer(
          snapshot.tracks,
          27,
          map,
          camera,
          viewportWidth,
          viewportHeight,
          40,
          28,
          1,
        );
      this.appendRides(snapshot, map, camera, viewportWidth, viewportHeight);
      this.appendVariantLayer(
        snapshot.litter,
        (kind) => litterSpriteName(kind, camera.rotation),
        map,
        camera,
        viewportWidth,
        viewportHeight,
        LITTER_SPRITE_SIZE.width,
        LITTER_SPRITE_SIZE.height,
      );
      this.appendLayer(
        snapshot.vehicles,
        23,
        map,
        camera,
        viewportWidth,
        viewportHeight,
        12,
        12,
        0,
        coasterSprites ? (word) => this.coasterScene.drawsRide(word >>> 16) : undefined,
      );
      this.surfaceDepths.prepare(map, camera.rotation);
      this.appendStaff(snapshot.staff, snapshot.tick, map, camera, viewportWidth, viewportHeight);
      this.appendGuests(snapshot.guests, snapshot.tick, map, camera, viewportWidth, viewportHeight);
    }
    this.uploadInPainterOrder();

    enableSpriteAlphaBlending(gl);
    this.drawRuns(
      viewportWidth,
      viewportHeight,
      map,
      camera.x,
      camera.y,
      camera.zoom,
      camera.rotation,
    );
    this.visibleCount = this.count;
    this.ownershipOverlay?.draw(map, camera);
  }

  /** Draws the uploaded instance runs, binding each run's atlas pages to the texture slots. */
  private drawRuns(
    viewportWidth: number,
    viewportHeight: number,
    map: MapData,
    cameraX: number,
    cameraY: number,
    zoom: number,
    rotation: number,
  ): void {
    const gl = this.gl;
    const uniforms = this.uniforms;
    if (!gl || !uniforms || !this.program || !this.vao || !this.fallbackTexture) return;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    for (let slot = 0; slot < TEXTURE_SLOTS; slot++) gl.uniform1i(uniforms.atlas[slot], slot);
    gl.uniform2f(uniforms.viewport, viewportWidth, viewportHeight);
    gl.uniform2f(uniforms.mapSize, map.width, map.height);
    gl.uniform2f(uniforms.camera, cameraX, cameraY);
    gl.uniform1f(uniforms.zoom, zoom);
    gl.uniform1f(uniforms.rotation, rotation);
    for (const run of this.runs) {
      for (let slot = 0; slot < TEXTURE_SLOTS; slot++) {
        const page = run.pages[slot];
        gl.activeTexture(gl.TEXTURE0 + slot);
        gl.bindTexture(
          gl.TEXTURE_2D,
          (page === undefined ? null : this.pageTextures.get(page)) ?? this.fallbackTexture,
        );
      }
      if (run.start !== this.attributeBase) this.pointInstanceAttributes(run.start);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, run.count);
    }
    if (this.attributeBase !== 0) this.pointInstanceAttributes(0);
  }

  dispose(): void {
    this.ownershipOverlay?.dispose();
    this.ownershipOverlay = null;
    this.canvas?.removeEventListener('webglcontextlost', this.onLost);
    this.canvas?.removeEventListener('webglcontextrestored', this.onRestored);
    const gl = this.gl;
    this.groundChunks.clear();
    if (gl) {
      if (this.groundProgram) gl.deleteProgram(this.groundProgram);
      if (this.groundFramebuffer) gl.deleteFramebuffer(this.groundFramebuffer);
      this.deleteTextures();
      if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.program) gl.deleteProgram(this.program);
    }
    this.canvas = null;
    this.gl = null;
    this.map = null;
  }

  private initializeResources(): void {
    const gl = this.gl;
    if (!gl) return;
    enableSpriteAlphaBlending(gl);
    const shaderProgram = gl.createProgram();
    if (!shaderProgram) throw new Error('Could not create WebGL program');
    const vertex = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragment = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(shaderProgram, vertex);
    gl.attachShader(shaderProgram, fragment);
    gl.linkProgram(shaderProgram);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
      const reason = gl.getProgramInfoLog(shaderProgram) ?? 'unknown program link error';
      gl.deleteProgram(shaderProgram);
      throw new Error(reason);
    }
    this.program = shaderProgram;
    this.uniforms = {
      atlas: Array.from({ length: TEXTURE_SLOTS }, (_, slot) =>
        gl.getUniformLocation(shaderProgram, `uAtlas${slot}`),
      ),
      viewport: gl.getUniformLocation(shaderProgram, 'uViewport'),
      mapSize: gl.getUniformLocation(shaderProgram, 'uMapSize'),
      camera: gl.getUniformLocation(shaderProgram, 'uCamera'),
      zoom: gl.getUniformLocation(shaderProgram, 'uZoom'),
      rotation: gl.getUniformLocation(shaderProgram, 'uRotation'),
    };

    this.groundChunks.clear();
    this.groundArtReady = false;
    this.bufferCapacity = 0;
    this.initializeGroundProgram();

    this.vao = gl.createVertexArray();
    this.instanceBuffer = gl.createBuffer();
    if (!this.vao || !this.instanceBuffer) throw new Error('Could not allocate sprite buffers');
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer();
    if (!quad) throw new Error('Could not allocate quad buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    this.bufferCapacity = this.depths.length;
    this.attributeBase = 0;
    this.pointInstanceAttributes(0);
    const fallbackAtlas = document.createElement('canvas');
    fallbackAtlas.width = FALLBACK_WIDTH;
    fallbackAtlas.height = FALLBACK_HEIGHT;
    const fallbackContext = fallbackAtlas.getContext('2d');
    if (!fallbackContext) throw new Error('Could not generate fallback sprite atlas');
    drawAtlas(fallbackContext);
    this.deleteTextures();
    this.fallbackTexture = this.createAtlasTexture(fallbackAtlas);
    this.syncedPageVersion = -1;
    spritePages.start();
    gl.bindVertexArray(null);
  }

  /** Points the per-instance attributes at the instance `base` entries into the buffer. */
  private pointInstanceAttributes(base: number): void {
    const gl = this.gl;
    if (!gl) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const layout = [
      [1, 3, 0],
      [2, 2, 3],
      [3, 4, 5],
      [4, 1, 9],
      [5, 4, 10],
      [6, 1, 14],
      [7, 1, 15],
      [8, 1, 17],
      [9, 1, 16],
      [10, 1, GHOST_FLOAT],
    ] as const;
    for (const [location, size, floatOffset] of layout) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(
        location,
        size,
        gl.FLOAT,
        false,
        INSTANCE_FLOATS * 4,
        (base * INSTANCE_FLOATS + floatOffset) * 4,
      );
      gl.vertexAttribDivisor(location, 1);
    }
    this.attributeBase = base;
  }

  private deleteTextures(): void {
    const gl = this.gl;
    if (gl) {
      if (this.fallbackTexture) gl.deleteTexture(this.fallbackTexture);
      for (const texture of this.pageTextures.values()) gl.deleteTexture(texture);
    }
    this.fallbackTexture = null;
    this.pageTextures.clear();
  }

  /** Uploads atlas pages that have arrived since the last frame. */
  private syncPageTextures(): void {
    if (this.syncedPageVersion === spritePages.version) return;
    for (const [page, image] of spritePages.loadedPages) {
      if (this.pageTextures.has(page)) continue;
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) continue;
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0);
      this.pageTextures.set(page, this.createAtlasTexture(canvas));
      canvas.width = 0;
    }
    this.syncedPageVersion = spritePages.version;
    const ready = spritePages.isLoaded('world');
    if (ready !== this.groundArtReady) {
      this.groundArtReady = ready;
      this.groundChunks.clear();
    }
  }

  private compileShader(kind: number, source: string): WebGLShader {
    const gl = this.gl;
    if (!gl) throw new Error('WebGL2 unavailable');
    const shader = gl.createShader(kind);
    if (!shader) throw new Error('Could not create WebGL shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const reason = gl.getShaderInfoLog(shader) ?? 'unknown shader compile error';
      gl.deleteShader(shader);
      throw new Error(reason);
    }
    return shader;
  }

  private createAtlasTexture(atlas: HTMLCanvasElement): WebGLTexture {
    const gl = this.gl;
    if (!gl) throw new Error('WebGL2 unavailable');
    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (atlas.width > maxSize || atlas.height > maxSize)
      throw new Error('Sprite atlas exceeds GPU limit');
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not allocate sprite atlas texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private initializeGroundProgram(): void {
    const gl = this.gl;
    if (!gl) return;
    const program = gl.createProgram();
    if (!program) throw new Error('Could not allocate ground cache resources');
    const vertex = this.compileShader(gl.VERTEX_SHADER, groundVertexSource);
    const fragment = this.compileShader(gl.FRAGMENT_SHADER, groundFragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const reason = gl.getProgramInfoLog(program) ?? 'unknown program link error';
      gl.deleteProgram(program);
      throw new Error(reason);
    }
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error('Could not allocate ground cache resources');
    this.groundProgram = program;
    this.groundFramebuffer = framebuffer;
    this.groundUniforms = {
      ground: gl.getUniformLocation(program, 'uGround'),
      rect: gl.getUniformLocation(program, 'uRect'),
      viewport: gl.getUniformLocation(program, 'uViewport'),
      camera: gl.getUniformLocation(program, 'uCamera'),
      zoom: gl.getUniformLocation(program, 'uZoom'),
    };
  }

  /** Drops cached ground whose orientation or appearance no longer matches the view. */
  private prepareGroundCache(map: MapData, camera: Camera): void {
    const gridlines = camera.showGridlines ?? false;
    if (gridlines !== this.gridlinesActive) {
      this.gridlinesActive = gridlines;
      this.groundChunks.clear();
    }
    if (camera.rotation !== this.groundRotation) {
      this.groundRotation = camera.rotation;
      this.groundChunks.clear();
    }
    if (
      this.groundIndex &&
      (this.groundIndex.map !== map || this.groundIndex.rotation !== camera.rotation)
    )
      this.groundIndex = null;
    if (
      this.tileLists &&
      (this.tileLists.map !== map || this.tileLists.rotation !== camera.rotation)
    )
      this.tileLists = null;
  }

  /** Invalidates only the chunks holding tiles whose terrain differs between two maps. */
  private invalidateGroundFor(previous: MapData | null, next: MapData): void {
    if (
      !previous ||
      previous.width !== next.width ||
      previous.height !== next.height ||
      previous.heights.length !== next.heights.length
    ) {
      this.groundChunks.clear();
      return;
    }
    const { width, height } = next;
    for (let index = 0; index < next.heights.length; index++) {
      if (
        previous.heights[index] === next.heights[index] &&
        previous.surface[index] === next.surface[index] &&
        previous.slope[index] === next.slope[index] &&
        (previous.waterLevel?.[index] ?? 0) === (next.waterLevel?.[index] ?? 0)
      )
        continue;
      const x = index % width;
      const y = (index - x) / width;
      this.dropChunksAround(
        x,
        y,
        previous.heights[index],
        width,
        height,
        previous.surface[index] === Surface.Rock || next.surface[index] === Surface.Rock,
      );
      this.dropChunksAround(
        x,
        y,
        next.heights[index],
        width,
        height,
        previous.surface[index] === Surface.Rock || next.surface[index] === Surface.Rock,
      );
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (previous.surface[neighbor] !== Surface.Rock && next.surface[neighbor] !== Surface.Rock)
          continue;
        this.dropChunksAround(nx, ny, previous.heights[neighbor]!, width, height, true);
        this.dropChunksAround(nx, ny, next.heights[neighbor]!, width, height, true);
      }
    }
  }

  private dropChunksAround(
    x: number,
    y: number,
    tileHeight: number,
    width: number,
    height: number,
    extendsToGround = false,
  ): void {
    const range = this.tileChunkRange(
      x,
      y,
      tileHeight,
      width,
      height,
      this.groundRotation,
      extendsToGround,
    );
    for (let cy = range.y0; cy <= range.y1; cy++)
      for (let cx = range.x0; cx <= range.x1; cx++) this.groundChunks.delete(chunkKey(cx, cy));
  }

  private tileChunkRange(
    x: number,
    y: number,
    tileHeight: number,
    width: number,
    height: number,
    rotation: Rotation,
    extendsToGround = false,
  ): ChunkRange {
    return tileChunkRange(
      x,
      y,
      tileHeight,
      width,
      height,
      rotation,
      GROUND_CHUNK_SIZE,
      this.projected,
      extendsToGround,
    );
  }

  private buildGroundIndex(map: MapData, rotation: Rotation): GroundIndex {
    const tileCount = map.width * map.height;
    const ranges = new Int16Array(tileCount * 4);
    let minCx = Infinity;
    let minCy = Infinity;
    let maxCx = -Infinity;
    let maxCy = -Infinity;
    for (let index = 0; index < tileCount; index++) {
      const x = index % map.width;
      const y = (index - x) / map.width;
      const r = this.tileChunkRange(
        x,
        y,
        map.heights[index]!,
        map.width,
        map.height,
        rotation,
        map.surface[index] === Surface.Rock,
      );
      ranges[index * 4] = r.x0;
      ranges[index * 4 + 1] = r.y0;
      ranges[index * 4 + 2] = r.x1;
      ranges[index * 4 + 3] = r.y1;
      if (r.x0 < minCx) minCx = r.x0;
      if (r.y0 < minCy) minCy = r.y0;
      if (r.x1 > maxCx) maxCx = r.x1;
      if (r.y1 > maxCy) maxCy = r.y1;
    }
    const columns = maxCx - minCx + 1;
    const rows = maxCy - minCy + 1;
    const starts = new Int32Array(columns * rows + 1);
    for (let index = 0; index < tileCount; index++)
      for (let cy = ranges[index * 4 + 1]; cy <= ranges[index * 4 + 3]; cy++)
        for (let cx = ranges[index * 4]; cx <= ranges[index * 4 + 2]; cx++)
          starts[(cy - minCy) * columns + (cx - minCx) + 1]++;
    for (let i = 1; i < starts.length; i++) starts[i] += starts[i - 1];
    const fill = starts.slice(0, columns * rows);
    const tiles = new Int32Array(starts[starts.length - 1]);
    for (let index = 0; index < tileCount; index++)
      for (let cy = ranges[index * 4 + 1]; cy <= ranges[index * 4 + 3]; cy++)
        for (let cx = ranges[index * 4]; cx <= ranges[index * 4 + 2]; cx++)
          tiles[fill[(cy - minCy) * columns + (cx - minCx)]++] = index;
    return { map, rotation, minCx, minCy, columns, rows, starts, tiles };
  }

  private visibleChunkRange(camera: Camera, viewportWidth: number, viewportHeight: number) {
    const halfWidth = viewportWidth / camera.zoom / 2;
    const halfHeight = viewportHeight / camera.zoom / 2;
    return chunkRange(
      camera.x - halfWidth,
      camera.y - halfHeight,
      camera.x + halfWidth,
      camera.y + halfHeight,
      GROUND_CHUNK_SIZE,
    );
  }

  /** Renders any visible ground chunk that is missing from the cache into its own texture. */
  private ensureGroundChunks(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const range = this.visibleChunkRange(camera, viewportWidth, viewportHeight);
    const visible = (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
    this.groundChunks.capacity = Math.max(GROUND_CHUNK_CAPACITY, visible + 8);
    let index = this.groundIndex;
    for (let cy = range.y0; cy <= range.y1; cy++) {
      for (let cx = range.x0; cx <= range.x1; cx++) {
        if (this.groundChunks.get(chunkKey(cx, cy))) continue;
        index ??= this.groundIndex = this.buildGroundIndex(map, camera.rotation);
        this.buildGroundChunk(map, index, cx, cy, camera.rotation);
      }
    }
  }

  private buildGroundChunk(
    map: MapData,
    index: GroundIndex,
    cx: number,
    cy: number,
    rotation: Rotation,
  ): void {
    const gl = this.gl;
    const framebuffer = this.groundFramebuffer;
    if (!gl || !framebuffer) return;
    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not allocate ground chunk texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      GROUND_CHUNK_SIZE,
      GROUND_CHUNK_SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.count = 0;
    const column = cx - index.minCx;
    const row = cy - index.minCy;
    if (column >= 0 && column < index.columns && row >= 0 && row < index.rows) {
      const cell = row * index.columns + column;
      for (let i = index.starts[cell]; i < index.starts[cell + 1]; i++)
        this.appendGroundTile(map, index.tiles[i], rotation);
    }
    this.uploadInPainterOrder();

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, GROUND_CHUNK_SIZE, GROUND_CHUNK_SIZE);
    gl.clearColor(...BACKGROUND);
    gl.clear(gl.COLOR_BUFFER_BIT);
    enableSpriteAlphaBlending(gl);
    this.drawRuns(
      GROUND_CHUNK_SIZE,
      GROUND_CHUNK_SIZE,
      map,
      cx * GROUND_CHUNK_SIZE + GROUND_CHUNK_SIZE / 2,
      cy * GROUND_CHUNK_SIZE + GROUND_CHUNK_SIZE / 2,
      1,
      rotation,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.count = 0;
    this.groundChunks.set(chunkKey(cx, cy), texture);
  }

  /** Draws the visible cached chunks, clearing first only when one is still missing. */
  private drawGroundChunks(camera: Camera, viewportWidth: number, viewportHeight: number): void {
    const gl = this.gl;
    const program = this.groundProgram;
    const uniforms = this.groundUniforms;
    if (!gl || !program || !uniforms || !this.vao) return;
    const range = this.visibleChunkRange(camera, viewportWidth, viewportHeight);
    let covered = true;
    for (let cy = range.y0; cy <= range.y1 && covered; cy++)
      for (let cx = range.x0; cx <= range.x1; cx++)
        if (!this.groundChunks.get(chunkKey(cx, cy))) {
          covered = false;
          break;
        }
    if (!covered) {
      gl.clearColor(...BACKGROUND);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(uniforms.ground, 0);
    gl.uniform2f(uniforms.viewport, viewportWidth, viewportHeight);
    gl.uniform2f(uniforms.camera, camera.x, camera.y);
    gl.uniform1f(uniforms.zoom, camera.zoom);
    for (let cy = range.y0; cy <= range.y1; cy++) {
      for (let cx = range.x0; cx <= range.x1; cx++) {
        const texture = this.groundChunks.get(chunkKey(cx, cy));
        if (!texture) continue;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform4f(
          uniforms.rect,
          cx * GROUND_CHUNK_SIZE,
          cy * GROUND_CHUNK_SIZE,
          (cx + 1) * GROUND_CHUNK_SIZE,
          (cy + 1) * GROUND_CHUNK_SIZE,
        );
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
  }

  private buildTileLists(map: MapData, rotation: Rotation): TileLists {
    const water: number[] = [];
    const occluders: number[] = [];
    const waterX: number[] = [];
    const waterY: number[] = [];
    const occluderX: number[] = [];
    const occluderY: number[] = [];
    const behind = new Int32Array(2);
    const peak = (index: number): number => map.heights[index] + (map.slope[index] !== 0 ? 1 : 0);
    for (let index = 0; index < map.width * map.height; index++) {
      const x = index % map.width;
      const y = (index - x) / map.width;
      const level = map.waterLevel?.[index] ?? 0;
      if (waterIntersectsTerrainTile(level, map.slope[index], map.heights[index])) {
        project(
          x * TILE_UNITS,
          y * TILE_UNITS,
          level * 64 - WATER_BANK.surfaceInset,
          map.width,
          map.height,
          rotation,
          this.projected,
        );
        water.push(index);
        waterX.push(this.projected[0]);
        waterY.push(this.projected[1]);
      }
      rotateForDraw(x, y, map.width, map.height, rotation, this.tileCoordinates);
      const viewX = this.tileCoordinates[0];
      const viewY = this.tileCoordinates[1];
      let rises = false;
      for (const [dx, dy] of [
        [-1, 0],
        [0, -1],
      ] as const) {
        const nx = viewX + dx;
        const ny = viewY + dy;
        const [vw, vh] = rotation % 2 === 0 ? [map.width, map.height] : [map.height, map.width];
        if (nx < 0 || ny < 0 || nx >= vw || ny >= vh) continue;
        unrotateForDraw(nx, ny, map.width, map.height, rotation, behind);
        if (peak(index) > peak(behind[1] * map.width + behind[0])) rises = true;
      }
      if (!rises) continue;
      project(
        x * TILE_UNITS,
        y * TILE_UNITS,
        map.heights[index] * 64,
        map.width,
        map.height,
        rotation,
        this.projected,
      );
      occluders.push(index);
      occluderX.push(this.projected[0]);
      occluderY.push(this.projected[1]);
    }
    return {
      map,
      rotation,
      water: Int32Array.from(water),
      occluders: Int32Array.from(occluders),
      waterX: Float32Array.from(waterX),
      waterY: Float32Array.from(waterY),
      occluderX: Float32Array.from(occluderX),
      occluderY: Float32Array.from(occluderY),
    };
  }

  /** Adds the on-screen water planes and the raised terrain that must hide sprites behind it. */
  /** Terrain no higher than a flat ride's floor must not be redrawn over the ride. */
  private hiddenByRide(map: MapData, tile: number): boolean {
    const floor = this.rideCells.floor[tile];
    return floor > 0 && map.heights[tile] + (map.slope[tile] !== 0 ? 1 : 0) <= floor - 1;
  }

  private appendWaterAndOccluders(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    tick: number,
  ): void {
    const lists = (this.tileLists ??= this.buildTileLists(map, camera.rotation));
    const halfWidth = viewportWidth / camera.zoom / 2 + TILE_W;
    const bottom = viewportHeight / camera.zoom / 2 + TILE_H + Z_PIXELS;
    const top = bottom + 31 * Z_PIXELS;
    for (let i = 0; i < lists.occluders.length; i++) {
      if (Math.abs(lists.occluderX[i] - camera.x) > halfWidth) continue;
      const dy = lists.occluderY[i] - camera.y;
      if (dy < -top || dy > bottom) continue;
      if (this.hiddenByRide(map, lists.occluders[i])) continue;
      this.appendGroundTile(
        map,
        lists.occluders[i],
        camera.rotation,
        TERRAIN_OCCLUDER_DEPTH_OFFSET,
      );
    }
    const frame = waterSpriteName(waterFrameIndex(tick));
    for (let i = 0; i < lists.water.length; i++) {
      if (Math.abs(lists.waterX[i] - camera.x) > halfWidth) continue;
      const dy = lists.waterY[i] - camera.y;
      if (dy < -top || dy > bottom) continue;
      const index = lists.water[i];
      const x = index % map.width;
      const y = (index - x) / map.width;
      rotateForDraw(x, y, map.width, map.height, camera.rotation, this.tileCoordinates);
      const level = map.waterLevel![index];
      const mask = map.slope[index];
      const height = map.heights[index];
      const corners = viewTerrainCornerHeights(
        [
          (height + (mask & 1)) * 64,
          (height + ((mask >> 1) & 1)) * 64,
          (height + ((mask >> 2) & 1)) * 64,
          (height + ((mask >> 3) & 1)) * 64,
        ],
        camera.rotation,
      );
      this.append(
        this.tileCoordinates[0] * TILE_UNITS,
        this.tileCoordinates[1] * TILE_UNITS,
        level * 64 - WATER_BANK.surfaceInset,
        TILE_W,
        TILE_H,
        frame,
        tileWaterDepth(this.tileCoordinates[0], this.tileCoordinates[1], level),
        3,
        corners,
      );
      const surface = map.surface[index];
      const terrainSurface =
        surface === 1 ? 'sand' : surface === 4 ? 'dirt' : surface === 5 ? 'rock' : 'grass';
      const waterHeight = level - WATER_BANK.surfaceInset / 64;
      const tileCorners = terrainTileCorners(x, y, height, mask);
      for (const [start, end] of terrainShorelineSegments(
        tileCorners,
        waterHeight,
        camera.rotation,
      ))
        this.append(
          start.x * TILE_UNITS,
          start.y * TILE_UNITS,
          waterHeight * 64,
          (end.x - start.x) * TILE_UNITS,
          (end.y - start.y) * TILE_UNITS,
          terrainCliffSpriteName(terrainSurface, 0),
          tileBankDepth(this.tileCoordinates[0], this.tileCoordinates[1], level),
          5,
          [level * 64, level * 64, level * 64, level * 64],
        );
    }
  }

  private appendPatrolAreas(
    snapshot: Snapshot,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    if (this.patrolStaffId === null) return;
    let area = 0;
    for (let slot = 0; slot < snapshot.staff.count; slot++)
      if (snapshot.staffIds[slot] === this.patrolStaffId) area = snapshot.patrolAreaIds[slot]!;
    const blocksWide = Math.ceil(map.width / 4);
    const blocksHigh = Math.ceil(map.height / 4);
    const maskStart = area > 0 ? (area - 1) * snapshot.patrolWordsPerArea : 0;
    for (let by = 0; by < blocksHigh; by++)
      for (let bx = 0; bx < blocksWide; bx++) {
        const block = by * blocksWide + bx;
        const marked =
          area > 0 &&
          (snapshot.patrolAreas[maskStart + (block >>> 5)]! & (1 << (block & 31))) !== 0;
        const previewed =
          this.patrolPreview !== null &&
          this.patrolPreview[0] >>> 2 === bx &&
          this.patrolPreview[1] >>> 2 === by;
        if (!marked && (!previewed || this.patrolPreviewRemove)) continue;
        const meshMode = marked ? (previewed && this.patrolPreviewRemove ? 2.1 : 1.5) : 1.6;
        for (let y = by * 4; y < Math.min(map.height, by * 4 + 4); y++)
          for (let x = bx * 4; x < Math.min(map.width, bx * 4 + 4); x++) {
            this.appendPatrolTile(map, camera, viewportWidth, viewportHeight, x, y, meshMode);
          }
      }
  }

  private appendPatrolTile(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    x: number,
    y: number,
    meshMode: number,
  ): void {
    const index = y * map.width + x;
    rotateForDraw(x, y, map.width, map.height, camera.rotation, this.tileCoordinates);
    const rx = this.tileCoordinates[0];
    const ry = this.tileCoordinates[1];
    const height = map.heights[index]!;
    project(
      (x + 0.5) * TILE_UNITS,
      (y + 0.5) * TILE_UNITS,
      height * 64,
      map.width,
      map.height,
      camera.rotation,
      this.projected,
    );
    if (
      Math.abs(this.projected[0]! - camera.x) > viewportWidth / camera.zoom / 2 + TILE_W ||
      Math.abs(this.projected[1]! - camera.y) >
        viewportHeight / camera.zoom / 2 + TILE_H + 32 * Z_PIXELS
    )
      return;
    const mask = map.slope[index]!;
    const worldCorners = [
      (height + (mask & 1)) * 64,
      (height + ((mask >> 1) & 1)) * 64,
      (height + ((mask >> 2) & 1)) * 64,
      (height + ((mask >> 3) & 1)) * 64,
    ] as const;
    const corners = viewTerrainCornerHeights(worldCorners, camera.rotation);
    this.append(
      rx * TILE_UNITS,
      ry * TILE_UNITS,
      height * 64,
      TILE_W,
      TILE_H,
      0,
      2 * (rx + ry) - height + 0.25,
      meshMode,
      corners,
    );
  }

  /** Appends one tile's terrain, boundary cliff faces and flat path fill. */
  private appendGroundTile(map: MapData, index: number, rotation: Rotation, depthOffset = 0): void {
    const x = index % map.width;
    const y = (index - x) / map.width;
    rotateForDraw(x, y, map.width, map.height, rotation, this.tileCoordinates);
    const rx = this.tileCoordinates[0];
    const ry = this.tileCoordinates[1];
    const height = map.heights[index];
    const surface = map.surface[index];
    const terrainSurface =
      surface === 1 ? 'sand' : surface === 4 ? 'dirt' : surface === 5 ? 'rock' : 'grass';
    const mask = map.slope[index];
    const worldCorners = [
      (height + (mask & 1)) * 64,
      (height + ((mask >> 1) & 1)) * 64,
      (height + ((mask >> 2) & 1)) * 64,
      (height + ((mask >> 3) & 1)) * 64,
    ] as const;
    const corners = viewTerrainCornerHeights(worldCorners, rotation);
    this.append(
      rx * TILE_UNITS,
      ry * TILE_UNITS,
      height * 64,
      TILE_W,
      TILE_H,
      terrainSurfaceSpriteName(terrainSurface),
      2 * (rx + ry) - height + depthOffset,
      1,
      corners,
      terrainLightFactor(corners),
      this.gridlinesActive ? terrainContourViewEdges(map, x, y, rotation) : 0,
    );
    const tileCorners = terrainTileCorners(x, y, height, mask);
    for (let direction = 0; direction < 4; direction++) {
      const onMapEdge =
        (direction === 0 && x === map.width - 1) ||
        (direction === 1 && y === map.height - 1) ||
        (direction === 2 && x === 0) ||
        (direction === 3 && y === 0);
      if (!onMapEdge && terrainSurface !== 'rock') continue;
      const neighbor = [
        [x + 1, y],
        [x, y + 1],
        [x - 1, y],
        [x, y - 1],
      ][direction]!;
      const neighborBase =
        onMapEdge ||
        neighbor[0] < 0 ||
        neighbor[0] >= map.width ||
        neighbor[1] < 0 ||
        neighbor[1] >= map.height
          ? 0
          : map.heights[neighbor[1] * map.width + neighbor[0]]!;
      const face = terrainEdgeFace(tileCorners, direction, neighborBase);
      if (!face) continue;
      const top = Math.max(face.start.height, face.end.height);
      const bottom = face.bottomHeight;
      if (top <= bottom) continue;
      this.append(
        face.start.x * TILE_UNITS,
        face.start.y * TILE_UNITS,
        bottom * 64,
        (face.end.x - face.start.x) * TILE_UNITS,
        (face.end.y - face.start.y) * TILE_UNITS,
        terrainCliffSpriteName(terrainSurface, (direction + rotation) & 3),
        2 * (rx + ry) - height - bottom + 0.25,
        4,
        [face.start.height * 64, face.end.height * 64, bottom * 64, bottom * 64],
      );
    }
    const waterLevel = map.waterLevel?.[index] ?? 0;
    if (!waterIntersectsTerrainTile(waterLevel, mask, height) && (surface === 3 || surface === 6))
      this.append(
        (x + 0.5) * TILE_UNITS,
        (y + 0.5) * TILE_UNITS,
        height * 64 + 1,
        44,
        24,
        pathSpriteName(surface === 6 ? 'queue' : 'tarmac', 0),
        2 * (rx + ry) - height + 1,
      );
  }

  private appendAmbientTrees(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const index = y * map.width + x;
        const tree = ambientTreeName(map.surface[index]!, x, y);
        if (!tree) continue;
        const sprite = scenerySpriteName(tree, camera.rotation);
        const z = sceneryGroundZ(map.heights[index]!, map.slope[index]!, camera.rotation);
        const worldX = x * TILE_UNITS + TILE_UNITS / 2;
        const worldY = y * TILE_UNITS + TILE_UNITS / 2;
        const depth = sceneryDepth(map, x, y, camera.rotation, z);
        project(worldX, worldY, z, map.width, map.height, camera.rotation, this.projected);
        if (
          inViewport(
            this.projected[0],
            this.projected[1],
            camera,
            viewportWidth,
            viewportHeight,
            AMBIENT_TREE_BOX.width,
            AMBIENT_TREE_BOX.height,
          )
        )
          this.append(
            worldX,
            worldY,
            z,
            AMBIENT_TREE_BOX.width,
            AMBIENT_TREE_BOX.height,
            sprite,
            depth,
          );
      }
    }
  }

  private appendGrounds(
    snapshot: Snapshot,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const count = Math.min(map.width * map.height, snapshot.grounds.length);
    for (let index = 0; index < count; index++) {
      if ((snapshot.grounds[index] & FLOWER_BED) === 0) continue;
      const x = index % map.width;
      const y = Math.floor(index / map.width);
      const baseHeight = map.heights[index]!;
      const z = flowerBedGroundZ(baseHeight, map.slope[index]!, camera.rotation);
      const worldX = x * TILE_UNITS + TILE_UNITS / 2;
      const worldY = y * TILE_UNITS + TILE_UNITS / 2;
      const depth =
        2 * rotatedPositionSum(worldX, worldY, map, camera.rotation) - z / Z_STEP + SOLID_BIAS;
      project(worldX, worldY, z, map.width, map.height, camera.rotation, this.projected);
      if (
        inViewport(
          this.projected[0],
          this.projected[1],
          camera,
          viewportWidth,
          viewportHeight,
          FLOWER_BED_BOX.width,
          FLOWER_BED_BOX.height,
        )
      )
        this.append(
          worldX,
          worldY,
          z,
          FLOWER_BED_BOX.width,
          FLOWER_BED_BOX.height,
          flowerBedSpriteName(x, y, camera.rotation, map.slope[index]!),
          depth,
        );
    }
  }

  private appendParkGate(
    snapshot: Snapshot,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const { entranceX, entranceY } = snapshot.park;
    if (entranceX < 0 || entranceY < 0 || entranceX >= map.width || entranceY >= map.height) return;
    const z = map.heights[entranceY * map.width + entranceX] * Z_STEP + 1;
    const worldX = entranceX * TILE_UNITS + TILE_UNITS / 2;
    const worldY = entranceY * TILE_UNITS + TILE_UNITS / 2;
    const depth =
      2 * rotatedPositionSum(worldX, worldY, map, camera.rotation) - z / Z_STEP + SOLID_BIAS;
    project(worldX, worldY, z, map.width, map.height, camera.rotation, this.projected);
    if (
      inViewport(
        this.projected[0],
        this.projected[1],
        camera,
        viewportWidth,
        viewportHeight,
        PARK_GATE_BOX.width,
        PARK_GATE_BOX.height,
      )
    )
      this.append(
        worldX,
        worldY,
        z,
        46,
        40,
        spriteViewName(scenerySpriteName('park-entrance'), camera.rotation),
        depth,
      );
  }

  private appendPathGhosts(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    for (const ghost of this.ghosts) {
      const z = ghost.level * Z_STEP;
      const worldX = ghost.x * TILE_UNITS + 128;
      const worldY = ghost.y * TILE_UNITS + 128;
      const depth =
        2 * rotatedPositionSum(ghost.x * TILE_UNITS, ghost.y * TILE_UNITS, map, camera.rotation) -
        ghost.level;
      project(worldX, worldY, z, map.width, map.height, camera.rotation, this.projected);
      if (
        !inViewport(
          this.projected[0],
          this.projected[1],
          camera,
          viewportWidth,
          viewportHeight,
          40,
          26,
        )
      )
        continue;
      this.ghostMode = ghost.tone === 'refused' ? 2 : 1;
      this.append(
        worldX,
        worldY,
        z,
        40,
        26,
        pathElementSprite(ghost.flags, ghost.surface, camera.rotation),
        depth + 1,
      );
      for (const rail of queueRailSprites(ghost.flags, camera.rotation))
        this.append(
          worldX,
          worldY,
          z,
          40,
          26,
          rail.sprite,
          queueRailDepth(map, camera.rotation, ghost.x, ghost.y, rail.worldDir, ghost.level) + 0.1,
        );
      this.ghostMode = 0;
    }
  }

  /** Ride and scenery previews, sorted with the built piece each one stands in for. */
  private appendSpriteGhosts(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    for (const ghost of this.spriteGhosts) {
      const z = ghost.level * Z_STEP;
      const worldX = ghost.x * TILE_UNITS + TILE_UNITS / 2;
      const worldY = ghost.y * TILE_UNITS + TILE_UNITS / 2;
      const rotated = rotatedPositionSum(worldX, worldY, map, camera.rotation);
      const depth =
        ghost.kind === 'ride'
          ? 2 * rotated - ghost.level + 1
          : 2 * rotated - ghost.level + (ghost.kind === 'scenery' ? 2 : 1);
      const [spriteName, frameSuffix] = ghost.sprite.split('#');
      const entry = spritePages.resolve(spriteName!);
      const frame = entry?.frames[Number(frameSuffix ?? 0)] ?? entry?.frames[0];
      project(worldX, worldY, z, map.width, map.height, camera.rotation, this.projected);
      if (
        !inViewport(
          this.projected[0],
          this.projected[1],
          camera,
          viewportWidth,
          viewportHeight,
          ghost.width ?? frame?.width ?? 12,
          ghost.height ?? frame?.height ?? 14,
        )
      )
        continue;
      this.ghostMode = ghost.tone === 'refused' ? 2 : 1;
      this.append(
        worldX,
        worldY,
        z,
        ghost.width ?? frame?.width ?? 12,
        ghost.height ?? frame?.height ?? 14,
        ghost.sprite,
        depth,
      );
      this.ghostMode = 0;
    }
  }

  private appendPathElements(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const paths = map.pathElements;
    const count = Math.min(map.pathCount ?? 0, paths ? paths.length / 6 : 0);
    if (!paths) return;
    for (let i = 0; i < count; i++) {
      const o = i * 6;
      const x = paths[o];
      const y = paths[o + 1];
      const baseHeight = paths[o + 2]!;
      const z = baseHeight * Z_STEP;
      const flags = paths[o + 3];
      const sprite = pathElementSprite(flags, paths[o + 5]!, camera.rotation);
      const worldX = x * TILE_UNITS + 128;
      const worldY = y * TILE_UNITS + 128;
      const depth = 2 * rotatedPositionSum(worldX, worldY, map, camera.rotation) - z / Z_STEP - 1;
      const slabDepth = pathSlabDepth(
        map,
        camera.rotation,
        x,
        y,
        baseHeight,
        flags,
        map.heights[y * map.width + x]!,
      );
      project(worldX, worldY, z, map.width, map.height, camera.rotation, this.projected);
      if (
        inViewport(
          this.projected[0],
          this.projected[1],
          camera,
          viewportWidth,
          viewportHeight,
          40,
          26,
        )
      ) {
        this.append(worldX, worldY, z, 40, 26, sprite, slabDepth);
        for (const rail of queueRailSprites(flags, camera.rotation))
          this.append(
            worldX,
            worldY,
            z,
            40,
            26,
            rail.sprite,
            queueRailDepth(map, camera.rotation, x, y, rail.worldDir, baseHeight),
          );
      }
      if ((flags & (PathFlag.Bin | PathFlag.Bench | PathFlag.Lamp | PathFlag.Shelter)) !== 0) {
        if (flags & PathFlag.Shelter) {
          const shelterZ = pathAdditionGroundZ(baseHeight, flags);
          const box = pathAdditionBox(flags);
          this.append(
            worldX,
            worldY,
            shelterZ,
            box.width,
            box.height,
            pathAdditionSpriteName(flags, camera.rotation, paths[o + 4]),
            adjustDepthForGroundZ(depth + 2, baseHeight, shelterZ),
          );
        } else
          for (const placement of pathAdditionPlacements(flags, baseHeight)) {
            const view = pathAdditionView(placement.edge, camera.rotation);
            const box = pathAdditionBox(flags, view);
            this.append(
              worldX + placement.x,
              worldY + placement.y,
              placement.groundZ,
              box.width,
              box.height,
              pathAdditionSpriteName(flags, view, paths[o + 4]),
              adjustDepthForGroundZ(
                2 *
                  rotatedPositionSum(
                    worldX + placement.x,
                    worldY + placement.y,
                    map,
                    camera.rotation,
                  ) -
                  baseHeight -
                  1 +
                  2,
                baseHeight,
                placement.groundZ,
              ),
            );
          }
      }
    }
  }

  private appendSceneryElements(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const items = map.sceneryElements;
    const count = Math.min(map.sceneryCount ?? 0, items ? items.length / 5 : 0);
    if (!items) return;
    for (let i = 0; i < count; i++) {
      const offset = i * 5;
      const x = items[offset];
      const y = items[offset + 1];
      const tile = y * map.width + x;
      const z = sceneryGroundZ(map.heights[tile]!, map.slope[tile]!, camera.rotation);
      const item = SCENERY_CATALOG[items[offset + 4]];
      if (!item) continue;
      const box = sceneryBox(item);
      const worldX = x * TILE_UNITS + TILE_UNITS / 2;
      const worldY = y * TILE_UNITS + TILE_UNITS / 2;
      const depth = sceneryDepth(map, x, y, camera.rotation, z);
      project(worldX, worldY, z, map.width, map.height, camera.rotation, this.projected);
      const spriteHeight = box.height;
      if (
        !inViewport(
          this.projected[0],
          this.projected[1],
          camera,
          viewportWidth,
          viewportHeight,
          box.width,
          spriteHeight,
        )
      )
        continue;
      this.append(
        worldX,
        worldY,
        z,
        box.width,
        spriteHeight,
        item.sprite === 'flower-bed'
          ? flowerBedSpriteName(x, y, camera.rotation, map.slope[tile]!)
          : item.sprite === 'shrub'
            ? shrubSpriteName(x, y, camera.rotation)
            : scenerySpriteName(item.sprite, camera.rotation),
        depth,
      );
    }
  }

  private appendRideMarkers(
    snapshot: Snapshot,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    for (let i = 0; i < snapshot.rides.count; i++) {
      const o = i * RIDE_INFO_STRIDE;
      const category = RIDE_CATALOG[snapshot.rideInfo[o + RideInfo.Type] as RideType]?.category;
      if (['shop', 'stall', 'facility'].includes(category ?? '')) continue;
      const flags = snapshot.rideInfo[o + RideInfo.Flags];
      const markers: [number, number, number, string][] = [
        [RideFlag.EntrancePlaced, RideInfo.EntranceX, RideInfo.EntranceY, 'entrance'],
        [RideFlag.ExitPlaced, RideInfo.ExitX, RideInfo.ExitY, 'exit'],
      ];
      for (const [flag, xField, yField, part] of markers) {
        if ((flags & flag) === 0) continue;
        const x = snapshot.rideInfo[o + xField];
        const y = snapshot.rideInfo[o + yField];
        const index = y * map.width + x;
        const z = map.heights[index] * Z_STEP + 1;
        const centerX = x * TILE_UNITS + 128;
        const centerY = y * TILE_UNITS + 128;
        const depth =
          2 * rotatedPositionSum(centerX, centerY, map, camera.rotation) - z / Z_STEP + SOLID_BIAS;
        project(centerX, centerY, z, map.width, map.height, camera.rotation, this.projected);
        if (
          inViewport(
            this.projected[0],
            this.projected[1],
            camera,
            viewportWidth,
            viewportHeight,
            10,
            14,
          )
        ) {
          const type = snapshot.rideInfo[o + RideInfo.Type] as RideType;
          const facing = rideHutFacingForFootprint(
            type,
            snapshot.rideInfo[o + RideInfo.RideX],
            snapshot.rideInfo[o + RideInfo.RideY],
            snapshot.rideInfo[o + RideInfo.Dir],
            x,
            y,
          );
          this.append(
            centerX,
            centerY,
            z,
            30,
            28,
            rideHutSpriteKey(type, part as 'entrance' | 'exit', facing, camera.rotation),
            depth,
          );
        }
      }
    }
  }

  private appendGuests(
    layer: SnapshotLayer,
    tick: number,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    for (let i = 0, offset = 0; i < layer.count; i++, offset += SNAPSHOT_STRIDE) {
      const metadata = layer.data[offset + 3];
      if (isRidingGuestRow(metadata) || i === this.heldGuestSlot) continue;
      const tint = metadata & 0xff;
      const heading = guestRowHeading(metadata);
      const depth = personDepth(
        map,
        camera.rotation,
        this.surfaceDepths,
        layer.data[offset],
        layer.data[offset + 1],
        layer.data[offset + 2],
      );
      this.appendLayerSprite(
        layer,
        offset,
        `people/guest-walk#${guestSpriteIndex(tint, heading, guestFrame(tick, guestRowIdle(metadata)), camera.rotation) - 40}`,
        map,
        camera,
        viewportWidth,
        viewportHeight,
        GUEST_BOX.width,
        GUEST_BOX.height,
        depth,
      );
    }
  }

  /** Draws coaster track, supports and cars from the atlas; false when the atlas has none. */
  private appendCoasters(
    snapshot: Snapshot,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): boolean {
    const scene = this.coasterScene;
    scene.build(snapshot, map, camera.rotation);
    const hasSprite = scene.items
      .slice(0, scene.length)
      .some((item) => spritePages.resolve(item.key.split('#')[0]));
    if (!hasSprite) return false;
    for (let i = 0; i < scene.length; i++) {
      const item = scene.items[i];
      const hash = item.key.lastIndexOf('#');
      const spriteName = hash < 0 ? item.key : item.key.slice(0, hash);
      const entry = spritePages.resolve(spriteName);
      const frameIndex = hash < 0 ? 0 : Number(item.key.slice(hash + 1));
      const frame = entry?.frames[frameIndex] ?? entry?.frames[0];
      if (!frame) {
        if (item.key.includes('/track/') || item.key.startsWith('track/'))
          this.append(item.x, item.y, item.z, 12, 12, 27, item.depth);
        continue;
      }
      project(item.x, item.y, item.z, map.width, map.height, camera.rotation, this.projected);
      if (
        inViewport(
          this.projected[0],
          this.projected[1],
          camera,
          viewportWidth,
          viewportHeight,
          frame.width,
          frame.height,
        )
      )
        this.append(item.x, item.y, item.z, frame.width, frame.height, item.key, item.depth);
    }
    return true;
  }

  private appendLayer(
    layer: SnapshotLayer,
    sprite: number | string,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    width: number,
    height: number,
    offset = 0,
    skip?: (word: number) => boolean,
  ): void {
    for (let i = 0; i < layer.count; i++) {
      const dataOffset = i * SNAPSHOT_STRIDE;
      if (skip?.(layer.data[dataOffset + 3])) continue;
      const depth =
        2 *
          rotatedPositionSum(
            layer.data[dataOffset],
            layer.data[dataOffset + 1],
            map,
            camera.rotation,
          ) -
        layer.data[dataOffset + 2] / 64 +
        offset;
      this.appendLayerSprite(
        layer,
        dataOffset,
        sprite,
        map,
        camera,
        viewportWidth,
        viewportHeight,
        width,
        height,
        depth,
      );
    }
  }

  private appendRideCells(
    snapshot: Snapshot,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const scene = this.rideCells;
    for (let i = 0; i < scene.length; i++) {
      const item = scene.items[i];
      const entry = spritePages.resolve(item.key);
      if (!entry) continue;
      const frameIndex = rideSpriteFrame(item.phase, snapshot.tick, entry.frames.length);
      const frame = entry.frames[frameIndex] ?? entry.frames[0];
      project(item.x, item.y, item.z, map.width, map.height, camera.rotation, this.projected);
      if (
        !inViewport(
          this.projected[0],
          this.projected[1],
          camera,
          viewportWidth,
          viewportHeight,
          frame.width,
          frame.height,
        )
      )
        continue;
      this.append(
        item.x,
        item.y,
        item.z,
        frame.width,
        frame.height,
        `${item.key}#${frameIndex}`,
        item.depth,
      );
    }
  }

  private appendRides(
    snapshot: Snapshot,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    this.appendRideCells(snapshot, map, camera, viewportWidth, viewportHeight);
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

      const worldX = tileX * TILE_UNITS + TILE_UNITS / 2;
      const worldY = tileY * TILE_UNITS + TILE_UNITS / 2;
      const z = map.heights[tileY * map.width + tileX] * Z_STEP;
      const isFacility = ['shop', 'stall', 'facility'].includes(definition.category);
      const key = isFacility
        ? facilitySpriteKey(type, facilityFacingFromPaths(tileX, tileY, map), camera.rotation)
        : rideSpriteKey(type, camera.rotation);
      const entry = spritePages.resolve(key);
      const frameIndex = rideSpriteFrame(
        snapshot.rideInfo[offset + RideInfo.Phase],
        snapshot.tick,
        entry?.frames.length ?? 1,
      );
      const frame = entry?.frames[frameIndex] ?? entry?.frames[0];
      const width = frame?.width ?? 12;
      const height = frame?.height ?? 14;
      const depth =
        2 * rotatedPositionSum(worldX, worldY, map, camera.rotation) - z / Z_STEP + SOLID_BIAS;
      project(worldX, worldY, z, map.width, map.height, camera.rotation, this.projected);
      if (
        !inViewport(
          this.projected[0],
          this.projected[1],
          camera,
          viewportWidth,
          viewportHeight,
          width,
          height,
        )
      )
        continue;
      this.append(worldX, worldY, z, width, height, entry ? `${key}#${frameIndex}` : 26, depth);
    }
  }

  private appendVariantLayer(
    layer: SnapshotLayer,
    spriteFor: (kind: number) => number | string,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    width: number,
    height: number,
  ): void {
    for (let i = 0; i < layer.count; i++) {
      const offset = i * SNAPSHOT_STRIDE;
      const dataOffset = offset + 3;
      const depth =
        2 * rotatedPositionSum(layer.data[offset], layer.data[offset + 1], map, camera.rotation) -
        layer.data[offset + 2] / 64;
      this.appendLayerSprite(
        layer,
        offset,
        spriteFor(layer.data[dataOffset] & 0xff),
        map,
        camera,
        viewportWidth,
        viewportHeight,
        width,
        height,
        depth,
      );
    }
  }

  private appendStaff(
    layer: SnapshotLayer,
    tick: number,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    for (let i = 0, offset = 0; i < layer.count; i++, offset += SNAPSHOT_STRIDE) {
      if (i === this.heldStaffSlot) continue;
      const metadata = layer.data[offset + 3];
      const kind = metadata & 0xff;
      const direction = (metadata >>> 8) & 3;
      const x = layer.data[offset];
      const y = layer.data[offset + 1];
      const z = layer.data[offset + 2];
      const key = `${peopleSpriteKey(kind, direction, camera.rotation)}#${walkingFrame(tick)}`;
      const entry = spritePages.resolve(key.split('#')[0]);
      const frame = entry?.frames[0];
      const width = frame?.width ?? 16;
      const height = frame?.height ?? 24;
      const depth = personDepth(map, camera.rotation, this.surfaceDepths, x, y, z);
      project(x, y, z, map.width, map.height, camera.rotation, this.projected);
      if (
        inViewport(
          this.projected[0],
          this.projected[1],
          camera,
          viewportWidth,
          viewportHeight,
          width,
          height,
        )
      )
        this.append(x, y, z, width, height, entry ? key : staffSpriteName(kind), depth);
    }
  }

  private appendLayerSprite(
    layer: SnapshotLayer,
    offset: number,
    sprite: number | string,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    width: number,
    height: number,
    depth: number,
  ): void {
    const x = layer.data[offset];
    const y = layer.data[offset + 1];
    const z = layer.data[offset + 2];
    project(x, y, z, map.width, map.height, camera.rotation, this.projected);
    if (
      !inViewport(
        this.projected[0],
        this.projected[1],
        camera,
        viewportWidth,
        viewportHeight,
        width,
        height,
      )
    )
      return;
    this.append(x, y, z, width, height, sprite, depth);
  }

  private append(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    sprite: number | string,
    depth: number,
    meshMode = 0,
    cornerHeights: readonly number[] = [z, z, z, z],
    terrainShade = 1,
    contourEdges = 0,
  ): void {
    if (this.count === this.depths.length) this.grow();
    const offset = this.count * INSTANCE_FLOATS;
    let frame: PageFrame | undefined;
    let entry: SpriteEntry | undefined;
    let frameIndex = 0;
    let fallbackIndex = -1;
    let anchorShift = 0;
    if (typeof sprite === 'string') {
      const match = /#(\d+)$/.exec(sprite);
      const spriteName = match ? sprite.slice(0, match.index) : sprite;
      frameIndex = match ? Number(match[1]) : 0;
      entry = spritePages.resolve(spriteName);
      frame = entry?.frames[frameIndex] ?? entry?.frames[0];
    } else {
      fallbackIndex = sprite;
    }
    let u0: number;
    let v0: number;
    let u1: number;
    let v1: number;
    if (frame && !this.pageTextures.has(frame.page)) frame = undefined;
    let page = -1;
    if (frame) {
      page = frame.page;
      const { width: pageWidth, height: pageHeight } = spritePages.pageInfos[page];
      u0 = (frame.x + 0.5) / pageWidth;
      v0 = 1 - (frame.y + frame.height - 0.5) / pageHeight;
      u1 = (frame.x + frame.width - 0.5) / pageWidth;
      v1 = 1 - (frame.y + 0.5) / pageHeight;
      if (!meshMode && entry?.native) {
        width = frame.width;
        height = frame.height;
        z += nativeSpriteWorldOffset(frame.height, entry.anchor.y);
        anchorShift = spriteAnchorScreenShift(frame.width, entry.anchor.x, width);
      } else if (!meshMode && entry) {
        z += spriteAnchorWorldOffset(frame.height, entry.anchor.y, height);
        anchorShift = spriteAnchorScreenShift(frame.width, entry.anchor.x, width);
      }
      if (meshMode === 2) {
        const insetX = 0.28;
        const oldU0 = u0;
        const oldV0 = v0;
        u0 = oldU0 + (u1 - oldU0) * insetX;
        u1 = oldU0 + (u1 - oldU0) * (1 - insetX);
        v0 = oldV0 + (v1 - oldV0) * 0.28;
        v1 = oldV0 + (v1 - oldV0) * 0.72;
      }
    } else {
      if (fallbackIndex < 0) {
        fallbackIndex = 0;
        if (typeof sprite === 'string') {
          if (sprite.startsWith('paths/')) fallbackIndex = sprite.includes('/queue/') ? 10 : 9;
          else if (sprite.startsWith('water/')) fallbackIndex = 8;
          else if (sprite.includes('/bench'))
            fallbackIndex = sprite.includes('/view-')
              ? 40 + Number(sprite.match(/view-(\d)/)?.[1] ?? 0)
              : 29;
          else if (sprite.includes('/bin'))
            fallbackIndex = sprite.includes('/view-')
              ? 44 + Number(sprite.match(/view-(\d)/)?.[1] ?? 0)
              : 28;
          else if (sprite.includes('/lamp'))
            fallbackIndex = sprite.includes('/view-')
              ? 48 + Number(sprite.match(/view-(\d)/)?.[1] ?? 0)
              : 30;
          else if (sprite.includes('/park-entrance')) fallbackIndex = 31;
          else if (sprite.includes('/flower-bed')) fallbackIndex = 0;
          else if (sprite.startsWith('people/guest-walk'))
            fallbackIndex = 11 + Math.floor(frameIndex / 16);
          else if (sprite.startsWith('people/staff-costumes'))
            fallbackIndex = 19 + Math.floor(frameIndex / 4);
        }
      }
      const x = (fallbackIndex % ATLAS_COLUMNS) * CELL;
      const y = Math.floor(fallbackIndex / ATLAS_COLUMNS) * CELL;
      u0 = x / FALLBACK_WIDTH;
      v0 = 1 - (y + CELL) / FALLBACK_HEIGHT;
      u1 = (x + CELL) / FALLBACK_WIDTH;
      v1 = 1 - y / FALLBACK_HEIGHT;
    }
    this.instanceData[offset] = x;
    this.instanceData[offset + 1] = y;
    this.instanceData[offset + 2] = z;
    this.instanceData[offset + 3] = width;
    this.instanceData[offset + 4] = height;
    this.instanceData[offset + 5] = u0;
    this.instanceData[offset + 6] = v0;
    this.instanceData[offset + 7] = u1;
    this.instanceData[offset + 8] = v1;
    this.instanceData[offset + 9] = meshMode;
    this.instanceData[offset + 10] = cornerHeights[0] ?? z;
    this.instanceData[offset + 11] = cornerHeights[1] ?? z;
    this.instanceData[offset + 12] = cornerHeights[2] ?? z;
    this.instanceData[offset + 13] = cornerHeights[3] ?? z;
    this.instanceData[offset + 14] = meshMode === 1 && this.gridlinesActive ? 1 + contourEdges : 0;
    this.instanceData[offset + 15] = terrainShade;
    this.instanceData[offset + 16] = anchorShift;
    this.instanceData[offset + GHOST_FLOAT] = this.ghostMode;
    this.depths[this.count] = Math.round(depth * 2);
    this.pageIds[this.count] = page;
    this.count++;
  }

  private grow(): void {
    const nextCapacity = this.depths.length * 2;
    const nextData = new Float32Array(nextCapacity * INSTANCE_FLOATS);
    nextData.set(this.instanceData);
    this.instanceData = nextData;
    const nextDepths = new Int32Array(nextCapacity);
    nextDepths.set(this.depths);
    this.depths = nextDepths;
    const nextPages = new Int16Array(nextCapacity);
    nextPages.set(this.pageIds);
    this.pageIds = nextPages;
    this.orderedData = new Float32Array(nextCapacity * INSTANCE_FLOATS);
    this.order = new Int32Array(nextCapacity);
    this.orderedPages = new Int16Array(nextCapacity);
  }

  private uploadInPainterOrder(): void {
    const gl = this.gl;
    const buffer = this.instanceBuffer;
    if (!gl || !buffer) return;
    sortByDepth(this.depths, this.count, this.order);
    for (let i = 0; i < this.count; i++) {
      const source = this.order[i];
      const from = source * INSTANCE_FLOATS;
      const to = i * INSTANCE_FLOATS;
      for (let j = 0; j < INSTANCE_FLOATS; j++)
        this.orderedData[to + j] = this.instanceData[from + j];
      this.orderedPages[i] = this.pageIds[source];
    }
    const batches = buildTextureRuns(this.orderedPages.subarray(0, this.count), TEXTURE_SLOTS);
    this.runs.length = 0;
    this.runs.push(...batches.runs);
    for (let i = 0; i < this.count; i++)
      this.orderedData[i * INSTANCE_FLOATS + SLOT_FLOAT] = batches.slots[i];
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    if (this.depths.length > this.bufferCapacity) {
      gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
      this.bufferCapacity = this.depths.length;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.orderedData, 0, this.count * INSTANCE_FLOATS);
  }
}

function drawAtlas(ctx: CanvasRenderingContext2D): void {
  for (let i = 0; i < ATLAS_COLUMNS * ATLAS_ROWS; i++) {
    const x = (i % ATLAS_COLUMNS) * CELL;
    const y = Math.floor(i / ATLAS_COLUMNS) * CELL;
    ctx.save();
    ctx.translate(x, y);
    if (i <= 8) drawTerrain(ctx, i);
    else if (i === 9 || i === 10) drawPath(ctx, i === 10);
    else if (i >= 11 && i <= 18) drawGuest(ctx, i - 11);
    else if (i >= 19 && i <= 22) drawStaff(ctx, i - 19);
    else if (i === 23) drawTrain(ctx);
    else if (i === 24 || i === 25) drawLitter(ctx, i === 25);
    else if (i === 26) drawRide(ctx);
    else if (i === 27) drawTrack(ctx);
    else if (i === 28) drawPathAddition(ctx, 'bin');
    else if (i === 29) drawPathAddition(ctx, 'bench');
    else if (i === 30) drawPathAddition(ctx, 'lamp');
    else if (i === 31) drawMarker(ctx, 'in');
    else if (i === 32) drawMarker(ctx, 'out');
    else if (i >= 33 && i <= 36) drawRamp(ctx, i - 33);
    else if (i === 37) drawPathAddition(ctx, 'shelter');
    else if (i >= 40 && i <= 43) drawPathAddition(ctx, 'bench', i - 40);
    else if (i >= 44 && i <= 47) drawPathAddition(ctx, 'bin', i - 44);
    else if (i >= 48 && i <= 51) drawPathAddition(ctx, 'lamp', i - 48);
    ctx.restore();
  }
}

function drawTerrain(ctx: CanvasRenderingContext2D, sprite: number): void {
  const colors = [
    '#56a84f',
    '#62ad55',
    '#d5c184',
    '#c7ad6a',
    '#987044',
    '#a0784b',
    '#8b8c91',
    '#777980',
    '#4388bb',
  ];
  ctx.fillStyle = colors[sprite];
  ctx.beginPath();
  ctx.moveTo(32, 8);
  ctx.lineTo(60, 32);
  ctx.lineTo(32, 56);
  ctx.lineTo(4, 32);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = sprite === 8 ? '#75b8da' : '#3c7139';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (sprite % 2 === 1 && sprite < 8) {
    ctx.fillStyle = 'rgba(255,255,255,0.24)';
    ctx.beginPath();
    ctx.moveTo(32, 8);
    ctx.lineTo(60, 32);
    ctx.lineTo(32, 32);
    ctx.closePath();
    ctx.fill();
  }
}

function drawPath(ctx: CanvasRenderingContext2D, queue: boolean): void {
  ctx.fillStyle = queue ? '#b77d9d' : '#b59a70';
  ctx.fillRect(24, 14, 16, 36);
  ctx.fillRect(14, 24, 36, 16);
  ctx.strokeStyle = '#715b3f';
  ctx.strokeRect(24, 14, 16, 36);
}

function drawGuest(ctx: CanvasRenderingContext2D, variant: number): void {
  const colors = [
    '#e7474d',
    '#edc53b',
    '#3cb66d',
    '#4194d0',
    '#a46bc6',
    '#eee9db',
    '#e58c43',
    '#34b9a3',
  ];
  ctx.fillStyle = '#252a31';
  ctx.beginPath();
  ctx.arc(32, 27, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colors[variant];
  ctx.fillRect(23, 35, 18, 15);
  ctx.fillStyle = '#f3d7ad';
  ctx.beginPath();
  ctx.arc(32, 25, 6, 0, Math.PI * 2);
  ctx.fill();
}

function drawStaff(ctx: CanvasRenderingContext2D, kind: number): void {
  const coats = ['#4ca95b', '#397cb3', '#855ea8', '#de8840'];
  ctx.fillStyle = coats[kind] ?? coats[0];
  ctx.fillRect(22, 18, 20, 33);
  if (kind === 0) {
    ctx.fillStyle = '#dfd6ad';
    ctx.fillRect(18, 21, 28, 4);
  } else if (kind === 1) {
    ctx.fillStyle = '#d0d8e2';
    ctx.fillRect(28, 29, 10, 7);
  } else if (kind === 2) {
    ctx.fillStyle = '#e7d45d';
    ctx.fillRect(27, 29, 10, 7);
  } else {
    ctx.fillStyle = '#f0d5a5';
    ctx.fillRect(25, 10, 14, 4);
  }
  ctx.fillStyle = '#f6d6ac';
  ctx.beginPath();
  ctx.arc(32, 17, 7, 0, Math.PI * 2);
  ctx.fill();
}

function drawTrain(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#d8483d';
  ctx.fillRect(10, 26, 44, 17);
  ctx.fillStyle = '#f2d987';
  ctx.fillRect(16, 20, 10, 8);
  ctx.fillRect(32, 20, 10, 8);
  ctx.fillStyle = '#34383e';
  ctx.beginPath();
  ctx.arc(20, 46, 5, 0, Math.PI * 2);
  ctx.arc(45, 46, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawLitter(ctx: CanvasRenderingContext2D, vomit: boolean): void {
  ctx.fillStyle = vomit ? '#91b84b' : '#6b4f2a';
  ctx.beginPath();
  ctx.ellipse(32, 42, vomit ? 4 : 3, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!vomit) {
    ctx.fillStyle = '#b2a47d';
    ctx.fillRect(29, 39, 6, 2);
  }
}

function drawRide(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#6f75bd';
  ctx.fillRect(13, 19, 38, 28);
  ctx.fillStyle = '#c9d7ec';
  ctx.fillRect(18, 24, 28, 4);
  ctx.fillStyle = '#f2bf42';
  ctx.fillRect(25, 31, 14, 12);
}

function drawTrack(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = '#cf5650';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(10, 45);
  ctx.lineTo(22, 23);
  ctx.lineTo(40, 37);
  ctx.lineTo(54, 16);
  ctx.stroke();
  ctx.strokeStyle = '#453e3b';
  ctx.lineWidth = 2;
  for (let i = 14; i < 53; i += 10) {
    ctx.beginPath();
    ctx.moveTo(i, 46);
    ctx.lineTo(i + 4, 50);
    ctx.stroke();
  }
}

function drawPathAddition(
  ctx: CanvasRenderingContext2D,
  kind: 'bin' | 'bench' | 'lamp' | 'shelter',
  view = 0,
): void {
  if (view !== 0) {
    ctx.translate(32, 32);
    ctx.rotate((view * Math.PI) / 2);
    ctx.translate(-32, -32);
  }
  if (kind === 'bin') {
    ctx.fillStyle = '#547d58';
    ctx.fillRect(23, 23, 18, 27);
    ctx.fillStyle = '#bbc3aa';
    ctx.fillRect(21, 22, 22, 5);
    ctx.fillStyle = '#29392d';
    ctx.fillRect(27, 30, 10, 3);
  } else if (kind === 'bench') {
    ctx.fillStyle = '#805535';
    ctx.fillRect(17, 33, 30, 7);
    ctx.fillRect(21, 40, 4, 10);
    ctx.fillRect(39, 40, 4, 10);
    ctx.fillRect(17, 28, 30, 4);
  } else if (kind === 'lamp') {
    ctx.fillStyle = '#424951';
    ctx.fillRect(30, 25, 4, 28);
    ctx.fillStyle = '#e9d784';
    ctx.beginPath();
    ctx.arc(32, 21, 7, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#5c6fa1';
    ctx.beginPath();
    ctx.moveTo(12, 30);
    ctx.quadraticCurveTo(32, 8, 52, 30);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#554b44';
    ctx.fillRect(29, 29, 6, 24);
  }
}

function drawMarker(ctx: CanvasRenderingContext2D, kind: 'in' | 'out'): void {
  ctx.fillStyle = kind === 'in' ? '#46ae72' : '#d36355';
  ctx.beginPath();
  ctx.moveTo(32, 8);
  ctx.lineTo(53, 20);
  ctx.lineTo(32, 32);
  ctx.lineTo(11, 20);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff4cf';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(kind === 'in' ? 'IN' : 'OUT', 32, 26);
}

function drawRamp(ctx: CanvasRenderingContext2D, direction: number): void {
  ctx.fillStyle = '#b59a70';
  ctx.beginPath();
  const offsets = [
    [-14, 9],
    [14, 9],
    [14, -9],
    [-14, -9],
  ][direction & 3];
  ctx.moveTo(32 - offsets[0], 32 - offsets[1]);
  ctx.lineTo(32 + offsets[0], 32 + offsets[1]);
  ctx.lineTo(48, 32);
  ctx.lineTo(32, 48);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#715b3f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(32 - offsets[0], 32 - offsets[1]);
  ctx.lineTo(32 + offsets[0], 32 + offsets[1]);
  ctx.stroke();
}

/** Maps a tile to its view-space coordinates for the given quarter-turn count. */
function rotateForDraw(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: Rotation,
  out: Int32Array,
): void {
  const [rx, ry] = rotateTile(x, y, width, height, rotation);
  out[0] = rx;
  out[1] = ry;
}

function chunkKey(cx: number, cy: number): number {
  return (cy + 4096) * 8192 + (cx + 4096);
}

function unrotateForDraw(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: Rotation,
  out: Int32Array,
): void {
  const [ux, uy] = unrotateTile(x, y, width, height, rotation);
  out[0] = ux;
  out[1] = uy;
}

function inViewport(
  x: number,
  y: number,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  width: number,
  height: number,
): boolean {
  const halfWidth = viewportWidth / camera.zoom / 2 + width;
  const halfHeight = viewportHeight / camera.zoom / 2 + height;
  return Math.abs(x - camera.x) <= halfWidth && Math.abs(y - camera.y) <= halfHeight;
}

export { rotatedPositionSum };

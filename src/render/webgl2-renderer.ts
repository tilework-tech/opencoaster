import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import {
  SNAPSHOT_STRIDE,
  guestRowHeading,
  guestRowIdle,
  isRidingGuestRow,
} from '../worker/snapshot';
import type { Snapshot, SnapshotLayer } from '../worker/snapshot';
import { RideFlag, RideInfo, RIDE_INFO_STRIDE } from '../worker/snapshot';
import { PathFlag, SALE_LAND, SALE_RIGHTS } from '../sim/map/tile-map';
import { FLOWER_BED } from '../sim/staff/grounds';
import { SCENERY_CATALOG, isWallScenery } from '../sim/map/scenery';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import type { RideType } from '../sim/rides/ride-types';
import {
  terrainEdgeFace,
  terrainEdgeFacesViewer,
  terrainNeighborEdgeBase,
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
  PATH_SURFACE_Z,
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
  worldToScreen,
} from './projection';
import type { Direction, MapExtent } from './projection';
import {
  FIRST_INSTANCE_OBJECT_ID,
  GROUND_OBJECT_ID,
  LAND_OVERLAY_OBJECT_ID,
  WATER_OBJECT_ID,
  objectKind,
} from './object-kinds';
import type { OracleSprite } from './occlusion-oracle';
import { HEIGHT_OFFSET, HEIGHT_RESOLUTION } from './height-encoding';
import { spritePages } from './sprite-pages';
import { PARK_FENCE, landOverlayTiles, parkBoundaryEdges } from './park-boundary';
import { peopleSpriteKey, walkingFrame } from './people-art';
import type { PageFrame, SpriteEntry } from './sprite-pages';
import { CoasterScene } from './coaster-scene';
import { TrenchIndex } from './trench-index';
import {
  TRENCH_ARCH_LEVELS,
  TRENCH_EDGE_OVERLAP,
  TRENCH_HALF_WIDTH,
  TRENCH_HEAD_DARK,
  TRENCH_HEAD_LIT,
  TRENCH_WALL_DARK,
  TRENCH_WALL_LIT,
  TRENCH_WALL_TEXTURE_HEIGHT,
  trenchFaceFacing,
  trenchFaces,
  wallStrips,
} from './trench-geometry';
import type { TrenchTile } from '../sim/track/trench';
import type { TrenchFace } from './trench-geometry';
import { buildTextureRuns } from './texture-runs';
import { chunkRange, LruCache, tileChunkRange } from './ground-chunks';
import type { ChunkRange } from './ground-chunks';
import { sortByDepth } from './painter-order';
import { RideCellScene, isSlicedRide } from './ride-scene';
import { anchorKey, rotatedPositionSum } from './depth-key';
import { buildObjectPickTargets, pickTopmostObject } from '../input/object-picking';
import type { ObjectPickTarget } from '../input/object-picking';
import type { Rotation } from './projection';
import { LampLightBuffer, collectLitLamps, darknessAt, lampsLit } from './night-lighting';
import { WebGLNightPass } from './night-pass-webgl';
import {
  pathElementSprite,
  lowestPathBases,
  pathElementSurface,
  pathSupports,
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
  wallSpriteName,
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
const INSTANCE_FLOATS = 23;
/** Instance float holding the atlas page slot, then the ghost mode (0 none, 1 accepted, 2 refused). */
const SLOT_FLOAT = 17;
/** Instance float holding the horizontal anchor shift of a sprite quad, in sprite pixels. */
const ANCHOR_SHIFT_FLOAT = 16;
const GHOST_FLOAT = 18;
/** Instance float holding the object id written in ID mode (see object-kinds.ts). */
const OBJECT_ID_FLOAT = 19;
/** Instance float holding the world height of the sprite's ground anchor, before quad offsets. */
const ANCHOR_Z_FLOAT = 20;
/** Instance float scaling a sprite's baked heights: drawn height over atlas frame height. */
const HEIGHT_SCALE_FLOAT = 21;
/** Instance float selecting which strip of a terrain tile mesh is cut away or kept (see `holeDiscard`). */
const HOLE_FLOAT = 22;
/**
 * Window depth per level of world height. Every point on one pixel's view ray has a distinct
 * height, so higher is nearer: depth = 0.5 - height * DEPTH_PER_LEVEL (see docs.md, "Occlusion
 * model").
 */
export const DEPTH_PER_LEVEL = 1 / 1024;
/**
 * Mesh mode of a land-overlay tile. The overlay is drawn as part of the ground, before every
 * sprite and without writing depth, so anything standing on the surface wins its depth ties.
 */
const LAND_OVERLAY_MODE = 2.3;
const PASS_OPAQUE = 0;
const PASS_TRANSLUCENT = 1;
const PASS_GROUND_OVERLAY = 2;
/** Screen length, in world pixels, of a tile edge: the period base of sale-border dashes. */
const TILE_EDGE_PIXELS = Math.hypot(TILE_W / 2, TILE_H / 2);
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

/** Object-ID image of one frame, drawn with the same instances and order as `draw`. */
export interface ObjectIdCapture {
  /** Backing-buffer pixels. */
  width: number;
  height: number;
  /** Object id per pixel, row-major with the top row first; 0 where nothing is drawn. */
  ids: Int32Array;
  /** Every atlas sprite instance drawn this frame, in painter order, in backing-buffer pixels. */
  sprites: OracleSprite[];
  /** Object kind of every id in the frame, ground and water included. */
  kinds: Map<number, string>;
  /** Atlas pages referenced by `sprites`. */
  pages: number[];
}

/** A sprite quad as the instance buffer holds it: world anchor after the quad-centre offset. */
interface SpriteQuad {
  x: number;
  y: number;
  /** Height of the quad centre (fixed point, Z_STEP per level). */
  z: number;
  width: number;
  height: number;
  /** Horizontal screen shift in sprite pixels. */
  anchorShift: number;
}

/**
 * Screen rectangle of a sprite quad exactly as the WebGL2 vertex shader places it, in backing
 * pixels (CSS pixels times `devicePixelRatio`).
 */
function spriteScreenRect(
  quad: SpriteQuad,
  map: MapExtent,
  camera: Pick<Camera, 'x' | 'y' | 'zoom' | 'rotation'>,
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
): { left: number; top: number; width: number; height: number } {
  const [sx, sy] = worldToScreen(
    quad.x / TILE_UNITS,
    quad.y / TILE_UNITS,
    quad.z / Z_STEP,
    camera.rotation,
    map,
  );
  const centreX = (sx - camera.x) * camera.zoom + viewportWidth / 2;
  const centreY = (sy - camera.y) * camera.zoom + viewportHeight / 2;
  return {
    left: (centreX + (quad.anchorShift - quad.width / 2) * camera.zoom) * devicePixelRatio,
    top: (centreY - (quad.height / 2) * camera.zoom) * devicePixelRatio,
    width: quad.width * camera.zoom * devicePixelRatio,
    height: quad.height * camera.zoom * devicePixelRatio,
  };
}

/**
 * The oracle sprite of instance `index` of a WebGL2 instance buffer drawn with atlas `frame`:
 * its on-screen rectangle in backing pixels and the world height of its ground anchor.
 */
export function instanceOracleSprite(
  instanceData: Float32Array,
  index: number,
  id: number,
  frame: PageFrame,
  map: MapExtent,
  camera: Pick<Camera, 'x' | 'y' | 'zoom' | 'rotation'>,
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
): OracleSprite {
  const at = index * INSTANCE_FLOATS;
  const quad: SpriteQuad = {
    x: instanceData[at],
    y: instanceData[at + 1],
    z: instanceData[at + 2],
    width: instanceData[at + 3],
    height: instanceData[at + 4],
    anchorShift: instanceData[at + ANCHOR_SHIFT_FLOAT],
  };
  return {
    id,
    page: frame.page,
    frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
    ...spriteScreenRect(quad, map, camera, viewportWidth, viewportHeight, devicePixelRatio),
    anchorHeight: instanceData[at + ANCHOR_Z_FLOAT] / Z_STEP,
    heightScale: quad.height / frame.height,
  };
}

/** Extra per-instance mesh parameters: the tile strip a trench cuts, or the part of a texture shown. */
interface MeshExtras {
  /** See `holeDiscard`. */
  hole?: number;
  /** Fractions of the sprite frame shown: left, right, top, bottom. */
  crop?: readonly [number, number, number, number];
}
const NO_MESH_EXTRAS: MeshExtras = {};

/** What `captureObjectIds` needs to know about an instance beyond the instance buffer. */
interface CaptureRecord {
  id: number;
  kind: string;
  /** Atlas frame of a sprite instance; absent for meshes and fallback-atlas instances. */
  frame?: PageFrame;
}

/** GLSL helper writing an object id as RGB bytes (low byte in red) with alpha 1. */
const encodeObjectIdSource = `highp vec4 encodeObjectId(highp float id) {
  highp float value = floor(id + 0.5);
  highp float low = mod(value, 256.0);
  highp float mid = mod(floor(value / 256.0), 256.0);
  highp float high = floor(value / 65536.0);
  return vec4(low, mid, high, 255.0) / 255.0;
}`;

/** GLSL decoder for the RGBA8 height encoding of height-encoding.ts. */
const heightCodecSource = `highp float decodeHeight(highp vec4 texel) {
  highp float value = floor(texel.r * 255.0 + 0.5) * 256.0 + floor(texel.g * 255.0 + 0.5);
  return (value - ${glslFloat(HEIGHT_OFFSET)}) / ${glslFloat(HEIGHT_RESOLUTION)};
}
`;

/**
 * GLSL for the cut a trench makes in a terrain tile mesh. Tile-space `uv` runs across the tile in
 * view space; `hole` 1/2 discards the strip along u/v (the ground above the cut), 3/4 keeps only
 * that strip, slightly wider (the floor, which hides under the walls and the ground).
 */
const holeSource = `bool holeDiscard(float hole, vec2 uv) {
  if (hole < 0.5) return false;
  bool alongU = hole < 1.5 || (hole > 2.5 && hole < 3.5);
  float across = abs((alongU ? uv.y : uv.x) - 0.5);
  if (hole < 2.5) return across < ${glslFloat(TRENCH_HALF_WIDTH)};
  return across >= ${glslFloat(TRENCH_HALF_WIDTH + 2 * TRENCH_EDGE_OVERLAP)};
}`;

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
layout(location=11) in float aObjectId;
layout(location=12) in float aAnchorZ;
layout(location=13) in float aHeightScale;
layout(location=14) in float aHole;
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
flat out float vObjectId;
flat out float vAnchorZ;
flat out float vHeightScale;
flat out float vHole;
out float vHeight;
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
  vec2 spriteUv = vec2(aCorner.x, 1.0 - aCorner.y);
  vUv = mix(aUvRect.xy, aUvRect.zw, spriteUv);
  vTileUv = aCorner;
  vMeshMode = aMeshMode;
  vGridlines = aGridlines;
  vTerrainShade = aTerrainShade;
  vWaterDepth = aWorld.z - cornerHeight;
  vSlot = aSlot;
  vGhost = aGhost;
  vObjectId = aObjectId;
  vAnchorZ = aAnchorZ / ${glslFloat(Z_STEP)};
  vHeightScale = aHeightScale;
  vHole = aHole;
  // Meshes carry their true height per vertex; a sprite without a baked height map stands as an
  // upright card whose height rises with its rows.
  if (aMeshMode > 2.5 && aMeshMode < 3.5) vHeight = aWorld.z / ${glslFloat(Z_STEP)};
  else if (aMeshMode > 0.5) vHeight = cornerHeight / ${glslFloat(Z_STEP)};
  else vHeight = vAnchorZ + (1.0 - aCorner.y) * aSize.y / ${glslFloat(Z_PIXELS)};
  // Meshes are planar per triangle, so their depth interpolates exactly from the vertices; sprite
  // fragments replace it with their baked per-pixel height.
  float depth = clamp(0.5 - vHeight * ${glslFloat(DEPTH_PER_LEVEL)}, 0.0, 1.0);
  gl_Position = vec4(screen.x / uViewport.x * 2.0 - 1.0,
                     1.0 - screen.y / uViewport.y * 2.0, depth * 2.0 - 1.0, 1.0);
}`;

const fragmentSource = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vTileUv;
in float vMeshMode;
in float vGridlines;
in float vTerrainShade;
in float vWaterDepth;
flat in float vSlot;
flat in float vGhost;
flat in highp float vObjectId;
flat in highp float vAnchorZ;
flat in float vHeightScale;
flat in float vHole;
in float vHeight;
uniform float uIdMode;
${Array.from({ length: TEXTURE_SLOTS }, (_, slot) => `uniform sampler2D uAtlas${slot};`).join('\n')}
${Array.from({ length: TEXTURE_SLOTS }, (_, slot) => `uniform sampler2D uHeights${slot};`).join('\n')}
out vec4 outColor;
${encodeObjectIdSource}
${heightCodecSource}
${holeSource}
vec4 sampleHeights(vec2 uv) {
  int slot = int(vSlot + 0.5);
${Array.from({ length: TEXTURE_SLOTS - 1 }, (_, slot) => `  if (slot == ${slot}) return texture(uHeights${slot}, uv);`).join('\n')}
  return texture(uHeights${TEXTURE_SLOTS - 1}, uv);
}
vec4 sampleAtlas(vec2 uv) {
  int slot = int(vSlot + 0.5);
${Array.from({ length: TEXTURE_SLOTS - 1 }, (_, slot) => `  if (slot == ${slot}) return texture(uAtlas${slot}, uv);`).join('\n')}
  return texture(uAtlas${TEXTURE_SLOTS - 1}, uv);
}
/**
 * The land overlay on one tile: a dark wash over land the park does not own, with dashed sale
 * borders. vGridlines holds the bordered view edges (bit 0 v = 0, 1 u = 1, 2 v = 1, 3 u = 0) plus
 * 16 * the offer (1 land, 2 construction rights, 3 both).
 */
vec4 landOverlay() {
  int code = int(vGridlines + 0.5);
  int sale = code / 16;
  vec4 colour = vec4(0.04, 0.055, 0.04, 0.58);
  float width = max(fwidth(vTileUv.x), fwidth(vTileUv.y)) * 2.5;
  vec2 dash = sale == 1 ? vec2(8.0, 5.0) : sale == 2 ? vec2(4.0, 2.0) : vec2(5.0, 1.0);
  vec3 ink = sale == 2 ? vec3(0.39, 0.76, 0.91) : vec3(0.95, 0.81, 0.34);
  float edges[4] = float[4](vTileUv.y, 1.0 - vTileUv.x, 1.0 - vTileUv.y, vTileUv.x);
  float along[4] = float[4](vTileUv.x, vTileUv.y, vTileUv.x, vTileUv.y);
  for (int edge = 0; edge < 4; edge++) {
    if ((code & (1 << edge)) == 0 || edges[edge] > width) continue;
    if (mod(along[edge] * ${glslFloat(TILE_EDGE_PIXELS)}, dash.x) < dash.y) colour = vec4(ink, 1.0);
  }
  return colour;
}
void main() {
  if (holeDiscard(vHole, vTileUv)) discard;
  if (vMeshMode > 2.5 && vMeshMode < 3.5 && vWaterDepth < 0.0) discard;
  outColor = sampleAtlas(vUv);
  float height = vHeight;
  if (vMeshMode < 0.5) {
    if (outColor.a < 0.5) discard;
    vec4 baked = sampleHeights(vUv);
    if (baked.a > 0.5) height = vAnchorZ + decodeHeight(baked) * vHeightScale;
  }
  gl_FragDepth = clamp(0.5 - height * ${glslFloat(DEPTH_PER_LEVEL)}, 0.0, 1.0);
  if (vGhost > 2.5) gl_FragDepth = 0.0;
  if (vMeshMode > 1.4 && vMeshMode < 2.0) outColor = vec4(0.26, 0.53, 1.0, 0.32);
  if (vMeshMode > 1.9 && vMeshMode < 2.2) outColor = vec4(0.96, 0.2, 0.16, 0.38);
  if (vMeshMode > 2.2 && vMeshMode < 2.5) outColor = landOverlay();
  if (vMeshMode > 1.4 && vMeshMode < 2.2) {
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
  if ((vMeshMode > 0.5 && vMeshMode < 1.5) || (vMeshMode > 3.5 && vMeshMode < 4.5))
    outColor.rgb *= vTerrainShade;
  if (vGhost > 0.5) {
    outColor.a *= ${glslFloat(GHOST_ALPHA)};
    if (vGhost > 1.5 && vGhost < 2.5) outColor.rgb = mix(outColor.rgb, vec3(0.9, 0.16, 0.14), 0.6);
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
    outColor.rgb = mix(outColor.rgb, vec3(0.07, 0.1, 0.05), contour * 0.45);
  }
  if (uIdMode > 0.5) {
    if (vGhost > 0.5 || (vMeshMode > 1.4 && vMeshMode < 2.2)) discard;
    outColor = encodeObjectId(vObjectId);
  }
}`;

/** Depth-only pass over terrain meshes: depth comes from the vertex shader. */
const depthFragmentSource = `#version 300 es
precision highp float;
in vec2 vTileUv;
flat in float vHole;
out vec4 outColor;
${holeSource}
void main() {
  if (holeDiscard(vHole, vTileUv)) discard;
  outColor = vec4(0.0);
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
precision highp float;
in vec2 vUv;
uniform sampler2D uGround;
uniform float uIdMode;
out vec4 outColor;
${encodeObjectIdSource}
void main() {
  outColor = texture(uGround, vUv);
  if (uIdMode > 0.5) {
    vec3 background = vec3(${BACKGROUND.slice(0, 3).map(glslFloat).join(', ')});
    if (all(lessThan(abs(outColor.rgb - background), vec3(0.5 / 255.0)))) discard;
    outColor = encodeObjectId(${glslFloat(GROUND_OBJECT_ID)});
  }
}`;

interface TileLists {
  map: MapData;
  rotation: Rotation;
  /** Tile indices whose water plane intersects their terrain. */
  water: Int32Array;
  waterX: Float32Array;
  waterY: Float32Array;
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
  readonly backend = 'WebGL2';
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private map: MapData | null = null;
  private pickCacheKey = '';
  private pickCacheSnapshot: Snapshot | null = null;
  private pickTargets: ObjectPickTarget[] = [];
  private program: WebGLProgram | null = null;
  private depthProgram: WebGLProgram | null = null;
  private depthUniforms: {
    viewport: WebGLUniformLocation | null;
    mapSize: WebGLUniformLocation | null;
    camera: WebGLUniformLocation | null;
    zoom: WebGLUniformLocation | null;
    rotation: WebGLUniformLocation | null;
  } | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private fallbackTexture: WebGLTexture | null = null;
  private readonly pageTextures = new Map<number, WebGLTexture>();
  private readonly pageHeightTextures = new Map<number, WebGLTexture>();
  /** Bound for pages without heights: alpha 0, so sprites fall back to an upright card. */
  private fallbackHeightTexture: WebGLTexture | null = null;
  private syncedPageVersion = -1;
  private attributeBase = 0;
  private readonly coasterScene = new CoasterScene();
  private readonly trenches = new TrenchIndex();
  private readonly rideCells = new RideCellScene();
  private uniforms: {
    atlas: (WebGLUniformLocation | null)[];
    heights: (WebGLUniformLocation | null)[];
    viewport: WebGLUniformLocation | null;
    mapSize: WebGLUniformLocation | null;
    camera: WebGLUniformLocation | null;
    zoom: WebGLUniformLocation | null;
    rotation: WebGLUniformLocation | null;
    idMode: WebGLUniformLocation | null;
  } | null = null;
  private idMode = false;
  private nextObjectId = FIRST_INSTANCE_OBJECT_ID;
  /** Per-instance capture data, indexed like `instanceData`, while `captureObjectIds` runs. */
  private captureRecords: (CaptureRecord | undefined)[] | null = null;
  private instanceData = new Float32Array(INITIAL_INSTANCE_CAPACITY * INSTANCE_FLOATS);
  private depths = new Int32Array(INITIAL_INSTANCE_CAPACITY);
  private pageIds = new Int16Array(INITIAL_INSTANCE_CAPACITY);
  /**
   * Draw pass per instance: `PASS_OPAQUE`, `PASS_GROUND_OVERLAY` for the land overlay, or
   * `PASS_TRANSLUCENT` for water, patrol overlays and previews.
   */
  private translucent = new Uint8Array(INITIAL_INSTANCE_CAPACITY);
  /** Index in `runs` of the first opaque run, after the ground-overlay runs. */
  private opaqueRun = 0;
  /** Index in `runs` of the first translucent run. */
  private translucentRun = 0;
  private readonly runs: { start: number; count: number; pages: number[] }[] = [];
  private orderedData = new Float32Array(INITIAL_INSTANCE_CAPACITY * INSTANCE_FLOATS);
  private readonly projected = new Float64Array(2);
  private readonly tileCoordinates = new Int32Array(2);
  private order = new Int32Array(INITIAL_INSTANCE_CAPACITY);
  private partition = new Int32Array(INITIAL_INSTANCE_CAPACITY);
  private orderedPages = new Int16Array(INITIAL_INSTANCE_CAPACITY);
  private bufferCapacity = 0;
  private groundProgram: WebGLProgram | null = null;
  private groundUniforms: {
    ground: WebGLUniformLocation | null;
    rect: WebGLUniformLocation | null;
    viewport: WebGLUniformLocation | null;
    camera: WebGLUniformLocation | null;
    zoom: WebGLUniformLocation | null;
    idMode: WebGLUniformLocation | null;
  } | null = null;
  private groundFramebuffer: WebGLFramebuffer | null = null;
  private readonly groundChunks = new LruCache<WebGLTexture>(GROUND_CHUNK_CAPACITY, (texture) =>
    this.gl?.deleteTexture(texture),
  );
  /** Frame stamp per tile, so the terrain depth pass draws each visible tile once. */
  private groundStamps = new Uint32Array(0);
  private groundStamp = 0;
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
  private landOverlay = false;
  private undergroundView = false;
  private visibleCount = 0;
  private gridlinesActive = false;
  private dpr = 1;
  private nightPass: WebGLNightPass | null = null;
  private readonly lampLights = new LampLightBuffer();
  private lost = false;
  private readonly onLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
  };
  private readonly onRestored = (): void => {
    this.lost = false;
    this.nightPass?.reset();
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
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.canvas = canvas;
    this.gl = gl;
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
  }

  setMap(map: MapData): void {
    this.invalidateGroundFor(this.map, map);
    this.map = map;
    this.pickCacheKey = '';
    this.pickCacheSnapshot = null;
  }

  setUndergroundView(visible: boolean): void {
    this.undergroundView = visible;
  }

  setLandOverlay(visible: boolean): void {
    this.landOverlay = visible;
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
    if (!this.renderFrame(snapshot, camera, null)) return;
    this.visibleCount = this.count;
  }

  /**
   * Draws one frame exactly like `draw` in ID mode: every pixel holds the id of the object drawn
   * last over it (see object-kinds.ts), read back top row first.
   */
  captureObjectIds(snapshot: Snapshot | null, camera: Camera): ObjectIdCapture {
    const gl = this.gl;
    const canvas = this.canvas;
    const map = this.map;
    if (!gl || !canvas || !map) throw new Error('WebGL2 renderer has no canvas or map');
    const { width, height } = canvas;
    const framebuffer = gl.createFramebuffer();
    const renderbuffer = gl.createRenderbuffer();
    if (!framebuffer || !renderbuffer) throw new Error('Could not allocate object-ID target');
    gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer);
    const depthbuffer = gl.createRenderbuffer();
    if (!depthbuffer) throw new Error('Could not allocate object-ID depth target');
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthbuffer);
    const records: (CaptureRecord | undefined)[] = [];
    this.captureRecords = records;
    const pixels = new Uint8Array(width * height * 4);
    let drawn: boolean;
    try {
      drawn = this.renderFrame(snapshot, camera, framebuffer);
      if (drawn) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      }
    } finally {
      this.captureRecords = null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteRenderbuffer(renderbuffer);
      gl.deleteRenderbuffer(depthbuffer);
    }
    if (!drawn) throw new Error('WebGL2 renderer could not draw the object-ID frame');

    const ids = new Int32Array(width * height);
    for (let row = 0; row < height; row++) {
      const source = (height - 1 - row) * width * 4;
      const target = row * width;
      for (let column = 0; column < width; column++) {
        const at = source + column * 4;
        ids[target + column] = pixels[at] | (pixels[at + 1] << 8) | (pixels[at + 2] << 16);
      }
    }
    const kinds = new Map<number, string>([
      [GROUND_OBJECT_ID, 'ground'],
      [WATER_OBJECT_ID, 'water'],
      [LAND_OVERLAY_OBJECT_ID, 'land-overlay'],
    ]);
    const sprites: OracleSprite[] = [];
    const pages = new Set<number>();
    const viewportWidth = width / this.dpr;
    const viewportHeight = height / this.dpr;
    for (let i = 0; i < this.count; i++) {
      const source = this.order[i];
      const record = records[source];
      if (!record) continue;
      kinds.set(record.id, record.kind);
      const frame = record.frame;
      if (!frame) continue;
      sprites.push(
        instanceOracleSprite(
          this.instanceData,
          source,
          record.id,
          frame,
          map,
          camera,
          viewportWidth,
          viewportHeight,
          this.dpr,
        ),
      );
      pages.add(frame.page);
    }
    return { width, height, ids, sprites, kinds, pages: [...pages].sort((a, b) => a - b) };
  }

  /**
   * Draws one frame into `target` (the canvas when null). A non-null target draws in ID mode.
   * Returns false when the renderer is not ready to draw.
   */
  private renderFrame(
    snapshot: Snapshot | null,
    camera: Camera,
    target: WebGLFramebuffer | null,
  ): boolean {
    this.resolveHeldSlots(snapshot);
    const gl = this.gl;
    const canvas = this.canvas;
    const map = this.map;
    if (!gl || !canvas || !map || this.lost || !this.program || !this.vao || !this.fallbackTexture)
      return false;
    const idMode = target !== null;

    this.syncPageTextures();
    const viewportWidth = canvas.width / this.dpr;
    const viewportHeight = canvas.height / this.dpr;
    if (snapshot) this.trenches.update(snapshot, map);
    else this.trenches.clear();
    this.prepareGroundCache(map, camera);
    this.ensureGroundChunks(map, camera, viewportWidth, viewportHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    this.drawGroundChunks(camera, viewportWidth, viewportHeight, idMode);
    this.drawGroundDepth(map, camera, viewportWidth, viewportHeight);

    this.count = 0;
    this.nextObjectId = FIRST_INSTANCE_OBJECT_ID;
    if (this.captureRecords) this.captureRecords.length = 0;
    if (snapshot) this.rideCells.build(snapshot, map, camera.rotation);
    else this.rideCells.reset();
    if (snapshot) this.appendPatrolAreas(snapshot, map, camera, viewportWidth, viewportHeight);
    this.appendWater(map, camera, viewportWidth, viewportHeight, snapshot?.tick ?? 0);
    if (snapshot) {
      this.appendAmbientTrees(map, camera, viewportWidth, viewportHeight);
      this.appendGrounds(snapshot, map, camera, viewportWidth, viewportHeight);
      this.appendPathElements(map, camera, viewportWidth, viewportHeight);
      this.appendPathGhosts(map, camera, viewportWidth, viewportHeight);
      this.appendSceneryElements(map, camera, viewportWidth, viewportHeight);
      this.appendParkFence(map, camera, viewportWidth, viewportHeight);
      this.appendTrenches(map, camera, viewportWidth, viewportHeight);
      this.appendLandOverlay(map, camera, viewportWidth, viewportHeight);
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
      this.appendStaff(snapshot.staff, snapshot.tick, map, camera, viewportWidth, viewportHeight);
      this.appendGuests(snapshot.guests, snapshot.tick, map, camera, viewportWidth, viewportHeight);
    }
    this.uploadInPainterOrder();

    if (idMode) gl.disable(gl.BLEND);
    else enableSpriteAlphaBlending(gl);
    this.idMode = idMode;
    this.drawRuns(
      viewportWidth,
      viewportHeight,
      map,
      camera.x,
      camera.y,
      camera.zoom,
      camera.rotation,
    );
    this.idMode = false;
    gl.disable(gl.DEPTH_TEST);
    if (!idMode) this.drawNight(snapshot, map, camera, viewportWidth, viewportHeight);
    return true;
  }

  /** Dims the finished frame with the time of day and lights the lamps once it is dark enough. */
  private drawNight(
    snapshot: Snapshot | null,
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    if (!snapshot || !camera.dayNight || !this.gl) return;
    const darkness = darknessAt(snapshot.tick);
    const lampCount =
      camera.lampLights && lampsLit(darkness)
        ? collectLitLamps(map, camera, viewportWidth, viewportHeight, this.lampLights)
        : 0;
    this.nightPass ??= new WebGLNightPass(this.gl);
    this.nightPass.draw(
      darkness,
      this.lampLights,
      lampCount,
      camera.zoom,
      this.dpr,
      this.canvas!.width,
      this.canvas!.height,
    );
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
    for (let slot = 0; slot < TEXTURE_SLOTS; slot++) {
      gl.uniform1i(uniforms.atlas[slot], slot);
      gl.uniform1i(uniforms.heights[slot], TEXTURE_SLOTS + slot);
    }
    gl.uniform2f(uniforms.viewport, viewportWidth, viewportHeight);
    gl.uniform2f(uniforms.mapSize, map.width, map.height);
    gl.uniform2f(uniforms.camera, cameraX, cameraY);
    gl.uniform1f(uniforms.zoom, zoom);
    gl.uniform1f(uniforms.rotation, rotation);
    gl.uniform1f(uniforms.idMode, this.idMode ? 1 : 0);
    for (let index = 0; index < this.runs.length; index++) {
      const run = this.runs[index];
      // The ground overlay and translucent surfaces are depth tested but never hide what is drawn
      // after them. In ID mode the translucent surfaces are scored as surfaces, so they keep
      // writing depth; the ground overlay never does, as it stands for the ground it lies on.
      if (index === 0 && this.opaqueRun > 0) gl.depthMask(false);
      if (index === this.opaqueRun) gl.depthMask(true);
      if (index === this.translucentRun && !this.idMode) gl.depthMask(false);
      for (let slot = 0; slot < TEXTURE_SLOTS; slot++) {
        const page = run.pages[slot];
        gl.activeTexture(gl.TEXTURE0 + slot);
        gl.bindTexture(
          gl.TEXTURE_2D,
          (page === undefined ? null : this.pageTextures.get(page)) ?? this.fallbackTexture,
        );
        gl.activeTexture(gl.TEXTURE0 + TEXTURE_SLOTS + slot);
        gl.bindTexture(
          gl.TEXTURE_2D,
          (page === undefined ? null : this.pageHeightTextures.get(page)) ??
            this.fallbackHeightTexture,
        );
      }
      if (run.start !== this.attributeBase) this.pointInstanceAttributes(run.start);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, run.count);
    }
    gl.depthMask(true);
    if (this.attributeBase !== 0) this.pointInstanceAttributes(0);
  }

  dispose(): void {
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
      if (this.depthProgram) gl.deleteProgram(this.depthProgram);
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
    const depthProgram = this.linkProgram(vertexSource, depthFragmentSource);
    this.depthProgram = depthProgram;
    this.depthUniforms = {
      viewport: gl.getUniformLocation(depthProgram, 'uViewport'),
      mapSize: gl.getUniformLocation(depthProgram, 'uMapSize'),
      camera: gl.getUniformLocation(depthProgram, 'uCamera'),
      zoom: gl.getUniformLocation(depthProgram, 'uZoom'),
      rotation: gl.getUniformLocation(depthProgram, 'uRotation'),
    };
    this.uniforms = {
      atlas: Array.from({ length: TEXTURE_SLOTS }, (_, slot) =>
        gl.getUniformLocation(shaderProgram, `uAtlas${slot}`),
      ),
      heights: Array.from({ length: TEXTURE_SLOTS }, (_, slot) =>
        gl.getUniformLocation(shaderProgram, `uHeights${slot}`),
      ),
      viewport: gl.getUniformLocation(shaderProgram, 'uViewport'),
      mapSize: gl.getUniformLocation(shaderProgram, 'uMapSize'),
      camera: gl.getUniformLocation(shaderProgram, 'uCamera'),
      zoom: gl.getUniformLocation(shaderProgram, 'uZoom'),
      rotation: gl.getUniformLocation(shaderProgram, 'uRotation'),
      idMode: gl.getUniformLocation(shaderProgram, 'uIdMode'),
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
    this.fallbackHeightTexture = this.createHeightTexture(null);
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
      [9, 1, ANCHOR_SHIFT_FLOAT],
      [10, 1, GHOST_FLOAT],
      [11, 1, OBJECT_ID_FLOAT],
      [12, 1, ANCHOR_Z_FLOAT],
      [13, 1, HEIGHT_SCALE_FLOAT],
      [14, 1, HOLE_FLOAT],
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
      for (const texture of this.pageHeightTextures.values()) gl.deleteTexture(texture);
      if (this.fallbackHeightTexture) gl.deleteTexture(this.fallbackHeightTexture);
    }
    this.fallbackTexture = null;
    this.fallbackHeightTexture = null;
    this.pageTextures.clear();
    this.pageHeightTextures.clear();
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
      const heights = spritePages.pageHeights(page);
      if (heights) {
        // Through a canvas like the colour page: WebGL ignores UNPACK_FLIP_Y for ImageBitmaps.
        canvas.width = heights.width;
        canvas.height = heights.height;
        context.drawImage(heights, 0, 0);
        this.pageHeightTextures.set(page, this.createHeightTexture(canvas));
        canvas.width = 0;
      }
    }
    this.syncedPageVersion = spritePages.version;
    const ready = spritePages.isLoaded('world');
    if (ready !== this.groundArtReady) {
      this.groundArtReady = ready;
      this.groundChunks.clear();
    }
  }

  private linkProgram(vertex: string, fragment: string): WebGLProgram {
    const gl = this.gl;
    if (!gl) throw new Error('WebGL2 unavailable');
    const program = gl.createProgram();
    if (!program) throw new Error('Could not create WebGL program');
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertex);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const reason = gl.getProgramInfoLog(program) ?? 'unknown program link error';
      gl.deleteProgram(program);
      throw new Error(reason);
    }
    return program;
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

  /** Uploads a height page byte-exact: no colour conversion or alpha premultiplication. */
  private createHeightTexture(image: TexImageSource | null, width = 1, height = 1): WebGLTexture {
    const gl = this.gl;
    if (!gl) throw new Error('WebGL2 unavailable');
    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not allocate sprite height texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    else
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array(width * height * 4),
      );
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
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
      idMode: gl.getUniformLocation(program, 'uIdMode'),
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
      this.dropChunksAround(x, y, previous.heights[index], width, height, true);
      this.dropChunksAround(x, y, next.heights[index], width, height, true);
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
        true,
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
    const texture = this.createChunkTexture();

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
    // Ground tiles within a chunk are painted back to front; the chunk has no depth buffer.
    gl.disable(gl.DEPTH_TEST);
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

  private createChunkTexture(): WebGLTexture {
    const gl = this.gl;
    if (!gl) throw new Error('WebGL2 unavailable');
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
    return texture;
  }

  /** Draws the visible cached chunks, clearing first only when one is still missing. */
  private drawGroundChunks(
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    idMode = false,
  ): void {
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
    if (idMode) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    } else if (!covered) {
      gl.clearColor(...BACKGROUND);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.disable(gl.BLEND);
    // The cached chunks only paint colour; drawGroundDepth lays the ground's depth exactly.
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(program);
    gl.uniform1f(uniforms.idMode, idMode ? 1 : 0);
    gl.bindVertexArray(this.vao);
    gl.uniform1i(uniforms.ground, 0);
    gl.uniform2f(uniforms.viewport, viewportWidth, viewportHeight);
    gl.uniform2f(uniforms.camera, camera.x, camera.y);
    gl.uniform1f(uniforms.zoom, camera.zoom);
    for (let cy = range.y0; cy <= range.y1; cy++) {
      for (let cx = range.x0; cx <= range.x1; cx++) {
        const texture = this.groundChunks.get(chunkKey(cx, cy));
        if (!texture) continue;
        gl.activeTexture(gl.TEXTURE0);
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

  /**
   * Lays the depth of every visible tile's terrain and cliff faces, with colour writes off. The
   * meshes carry their true height per vertex, so ground depth is exact at every zoom, unlike the
   * zoom-1 colour cache drawn under it. All ground is needed, not only raised tiles: track,
   * supports and other objects may reach below the surface of flat ground.
   */
  private drawGroundDepth(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const gl = this.gl;
    if (!gl) return;
    const index = (this.groundIndex ??= this.buildGroundIndex(map, camera.rotation));
    if (this.groundStamps.length !== map.width * map.height) {
      this.groundStamps = new Uint32Array(map.width * map.height);
      this.groundStamp = 0;
    }
    const stamp = ++this.groundStamp;
    const range = this.visibleChunkRange(camera, viewportWidth, viewportHeight);
    this.count = 0;
    for (let cy = range.y0; cy <= range.y1; cy++)
      for (let cx = range.x0; cx <= range.x1; cx++) {
        const column = cx - index.minCx;
        const row = cy - index.minCy;
        if (column < 0 || column >= index.columns || row < 0 || row >= index.rows) continue;
        const cell = row * index.columns + column;
        for (let i = index.starts[cell]; i < index.starts[cell + 1]; i++) {
          const tile = index.tiles[i];
          if (this.groundStamps[tile] === stamp) continue;
          this.groundStamps[tile] = stamp;
          this.appendGroundTile(map, tile, camera.rotation, true);
        }
      }
    const uniforms = this.depthUniforms;
    if (!this.depthProgram || !uniforms || !this.vao || !this.instanceBuffer) return;
    // Depth does not depend on draw order, so the instances go up as appended.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    if (this.depths.length > this.bufferCapacity) {
      gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
      this.bufferCapacity = this.depths.length;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData, 0, this.count * INSTANCE_FLOATS);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.colorMask(false, false, false, false);
    // Ground loses an exact tie with whatever rests on it, as in the oracle and Canvas2D, where
    // ground is composited first and a later surface wins an equal height.
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    gl.useProgram(this.depthProgram);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(uniforms.viewport, viewportWidth, viewportHeight);
    gl.uniform2f(uniforms.mapSize, map.width, map.height);
    gl.uniform2f(uniforms.camera, camera.x, camera.y);
    gl.uniform1f(uniforms.zoom, camera.zoom);
    gl.uniform1f(uniforms.rotation, camera.rotation);
    if (this.attributeBase !== 0) this.pointInstanceAttributes(0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.colorMask(true, true, true, true);
    this.count = 0;
  }

  private buildTileLists(map: MapData, rotation: Rotation): TileLists {
    const water: number[] = [];
    const waterX: number[] = [];
    const waterY: number[] = [];
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
    }
    return {
      map,
      rotation,
      water: Int32Array.from(water),
      waterX: Float32Array.from(waterX),
      waterY: Float32Array.from(waterY),
    };
  }

  /** Adds the on-screen water planes and their bank faces. */
  private appendWater(
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
        anchorKey(
          map,
          camera.rotation,
          (x + 0.5) * TILE_UNITS,
          (y + 0.5) * TILE_UNITS,
          level * Z_STEP,
        ),
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
          anchorKey(
            map,
            camera.rotation,
            (x + 0.5) * TILE_UNITS,
            (y + 0.5) * TILE_UNITS,
            level * Z_STEP,
          ),
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
            this.appendSurfaceTile(map, camera, viewportWidth, viewportHeight, x, y, meshMode);
          }
      }
  }

  /**
   * The land overlay on every tile the park does not own, while land tools are open: a translucent
   * surface on the terrain, so anything in front of it hides it.
   */
  private appendLandOverlay(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    if (!this.landOverlay) return;
    for (const tile of landOverlayTiles(map)) {
      let viewBorders = 0;
      for (let edge = 0; edge < 4; edge++)
        if (tile.borders & (1 << edge))
          viewBorders |= 1 << ((rotateDirection(edge as Direction, camera.rotation) + 1) & 3);
      const offer = tile.sale === SALE_LAND ? 1 : tile.sale === SALE_RIGHTS ? 2 : tile.sale ? 3 : 0;
      this.appendSurfaceTile(
        map,
        camera,
        viewportWidth,
        viewportHeight,
        tile.x,
        tile.y,
        LAND_OVERLAY_MODE,
        viewBorders + offer * 16,
      );
    }
  }

  private appendSurfaceTile(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    x: number,
    y: number,
    meshMode: number,
    data = 0,
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
      2 * (rx + ry) - height,
      meshMode,
      corners,
      1,
      data,
    );
  }

  /**
   * Appends one tile's terrain, edge cliff faces and flat path fill; `meshesOnly` leaves out the
   * path fill sprite, for the terrain depth pass.
   */
  private appendGroundTile(
    map: MapData,
    index: number,
    rotation: Rotation,
    meshesOnly = false,
  ): void {
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
    if (meshesOnly) {
      const trench = this.trenches.tiles.get(index);
      this.appendDepthInstance(
        rx * TILE_UNITS,
        ry * TILE_UNITS,
        height * 64,
        TILE_W,
        TILE_H,
        corners,
        1,
        trench ? 1 + ((trench.axis + rotation) & 1) : 0,
      );
    } else
      this.append(
        rx * TILE_UNITS,
        ry * TILE_UNITS,
        height * 64,
        TILE_W,
        TILE_H,
        terrainSurfaceSpriteName(terrainSurface),
        2 * (rx + ry) - height,
        1,
        corners,
        terrainLightFactor(corners),
        this.gridlinesActive ? terrainContourViewEdges(map, x, y, rotation) : 0,
      );
    const tileCorners = terrainTileCorners(x, y, height, mask);
    for (let direction = 0; direction < 4; direction++) {
      if (!terrainEdgeFacesViewer(direction, rotation)) continue;
      const neighborBase = terrainNeighborEdgeBase(map, x, y, direction);
      const face = terrainEdgeFace(tileCorners, direction, neighborBase);
      if (!face) continue;
      const top = Math.max(face.start.height, face.end.height);
      const bottom = face.bottomHeight;
      if (top <= bottom) continue;
      const cliffCorners = [face.start.height * 64, face.end.height * 64, bottom * 64, bottom * 64];
      if (meshesOnly)
        this.appendDepthInstance(
          face.start.x * TILE_UNITS,
          face.start.y * TILE_UNITS,
          bottom * 64,
          (face.end.x - face.start.x) * TILE_UNITS,
          (face.end.y - face.start.y) * TILE_UNITS,
          cliffCorners,
          4,
        );
      else
        this.append(
          face.start.x * TILE_UNITS,
          face.start.y * TILE_UNITS,
          bottom * 64,
          (face.end.x - face.start.x) * TILE_UNITS,
          (face.end.y - face.start.y) * TILE_UNITS,
          terrainCliffSpriteName(terrainSurface, (direction + rotation) & 3),
          // Cliff faces paint over the tile tops behind them in the ground cache.
          2 * (rx + ry) - height - bottom + 0.25,
          4,
          cliffCorners,
        );
    }
    const waterLevel = map.waterLevel?.[index] ?? 0;
    if (
      !meshesOnly &&
      !waterIntersectsTerrainTile(waterLevel, mask, height) &&
      (surface === 3 || surface === 6)
    )
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

  /** Adds the floor, retaining walls and headwalls of every trench tile in view. */
  private appendTrenches(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const rotation = camera.rotation;
    for (const trench of this.trenches.tiles.values()) {
      const x = trench.index % map.width;
      const y = (trench.index - x) / map.width;
      const base = map.heights[trench.index]!;
      project(
        (x + 0.5) * TILE_UNITS,
        (y + 0.5) * TILE_UNITS,
        base * 64,
        map.width,
        map.height,
        rotation,
        this.projected,
      );
      if (
        Math.abs(this.projected[0]! - camera.x) > viewportWidth / camera.zoom / 2 + TILE_W ||
        Math.abs(this.projected[1]! - camera.y) >
          viewportHeight / camera.zoom / 2 + TILE_H + 32 * Z_PIXELS
      )
        continue;
      rotateForDraw(x, y, map.width, map.height, rotation, this.tileCoordinates);
      const key = 2 * (this.tileCoordinates[0] + this.tileCoordinates[1]) - base;
      for (const face of trenchFaces(trench, x, y, base, map.slope[trench.index]!, rotation)) {
        if (face.kind === 'floor') this.appendTrenchFloor(trench, face, map, rotation, base, key);
        else if (face.kind === 'wall') this.appendTrenchWall(trench, face, rotation, key);
        else this.appendTrenchHead(trench, face, rotation, key);
      }
    }
  }

  private appendTrenchFloor(
    trench: TrenchTile,
    face: TrenchFace,
    map: MapData,
    rotation: Rotation,
    base: number,
    key: number,
  ): void {
    const low = face.top[0].height * 64;
    const high = face.bottom[0].height * 64;
    const lowCorner = trench.axis === 0 ? [true, false, false, true] : [true, true, false, false];
    const corners = viewTerrainCornerHeights(
      lowCorner.map((isLow) => (isLow ? low : high)) as [number, number, number, number],
      rotation,
    );
    const x = trench.index % map.width;
    const y = (trench.index - x) / map.width;
    rotateForDraw(x, y, map.width, map.height, rotation, this.tileCoordinates);
    this.append(
      this.tileCoordinates[0] * TILE_UNITS,
      this.tileCoordinates[1] * TILE_UNITS,
      base * 64,
      TILE_W,
      TILE_H,
      'terrain/trench/floor',
      key,
      1,
      corners,
      terrainLightFactor(corners),
      0,
      { hole: 3 + ((trench.axis + rotation) & 1) },
    );
  }

  private appendTrenchWall(
    trench: TrenchTile,
    wall: TrenchFace,
    rotation: Rotation,
    key: number,
  ): void {
    const facing = (trenchFaceFacing(trench, wall) + rotation) & 3;
    if (facing >= 2) return;
    const shade = facing === 0 ? TRENCH_WALL_LIT : TRENCH_WALL_DARK;
    const out = wall.side * TRENCH_EDGE_OVERLAP;
    const strips = wallStrips(wall);
    for (let i = 0; i < strips.length; i++) {
      const strip = strips[i]!;
      const [start, end] = strip.top;
      const bottom = strip.bottom[0].height;
      const top = (start.height + end.height) / 2;
      const shown = Math.min(1, ((top - bottom) * Z_PIXELS) / TRENCH_WALL_TEXTURE_HEIGHT);
      this.append(
        (start.x + (trench.axis === 1 ? out : 0)) * TILE_UNITS,
        (start.y + (trench.axis === 0 ? out : 0)) * TILE_UNITS,
        bottom * 64,
        (end.x - start.x) * TILE_UNITS,
        (end.y - start.y) * TILE_UNITS,
        'terrain/trench/wall',
        key,
        4,
        [start.height * 64, end.height * 64, bottom * 64, bottom * 64],
        shade,
        0,
        { crop: [i / strips.length, (i + 1) / strips.length, 0, shown] },
      );
    }
  }

  private appendTrenchHead(
    trench: TrenchTile,
    face: TrenchFace,
    rotation: Rotation,
    key: number,
  ): void {
    const facing = (trenchFaceFacing(trench, face) + rotation) & 3;
    if (facing >= 2) return;
    const shade = facing === 0 ? TRENCH_HEAD_LIT : TRENCH_HEAD_DARK;
    const [start, end] = face.top;
    const floor = face.bottom[0].height;
    const archLevels = TRENCH_ARCH_LEVELS;
    const archStart = Math.min(start.height, floor + archLevels);
    const archEnd = Math.min(end.height, floor + archLevels);
    const shown = Math.min(1, (archStart + archEnd) / 2 - floor);
    this.append(
      start.x * TILE_UNITS,
      start.y * TILE_UNITS,
      floor * 64,
      (end.x - start.x) * TILE_UNITS,
      (end.y - start.y) * TILE_UNITS,
      'terrain/trench/arch',
      key,
      4,
      [archStart * 64, archEnd * 64, floor * 64, floor * 64],
      shade,
      0,
      { crop: [0, 1, 1 - shown / archLevels, 1] },
    );
    const above = (start.height + end.height) / 2 - (floor + archLevels);
    if (above <= 0.02) return;
    this.append(
      start.x * TILE_UNITS,
      start.y * TILE_UNITS,
      (floor + archLevels) * 64,
      (end.x - start.x) * TILE_UNITS,
      (end.y - start.y) * TILE_UNITS,
      'terrain/trench/wall',
      key,
      4,
      [start.height * 64, end.height * 64, (floor + archLevels) * 64, (floor + archLevels) * 64],
      shade,
      0,
      { crop: [0, 1, 0, Math.min(1, (above * Z_PIXELS) / TRENCH_WALL_TEXTURE_HEIGHT)] },
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
        const depth = anchorKey(map, camera.rotation, worldX, worldY, z);
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
      const depth = anchorKey(map, camera.rotation, worldX, worldY, z);
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
    const depth = anchorKey(map, camera.rotation, worldX, worldY, z);
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
      const depth = anchorKey(map, camera.rotation, worldX, worldY, z);
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
        depth,
      );
      for (const rail of queueRailSprites(ghost.flags, camera.rotation))
        this.append(
          worldX,
          worldY,
          z,
          40,
          26,
          rail.sprite,
          anchorKey(map, camera.rotation, worldX, worldY, z),
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
      const depth = anchorKey(map, camera.rotation, worldX, worldY, z);
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
    const lowest = lowestPathBases(map);
    for (let i = 0; i < count; i++) {
      const o = i * 6;
      const x = paths[o];
      const y = paths[o + 1];
      const baseHeight = paths[o + 2]!;
      const z = baseHeight * Z_STEP;
      for (const support of pathSupports(
        map.heights[y * map.width + x]!,
        baseHeight,
        lowest[y * map.width + x]!,
        pathElementSurface(paths[o + 3]!, paths[o + 5]!),
      )) {
        const entry = spritePages.resolve(support.sprite);
        const frame = entry?.frames[0];
        if (!frame) continue;
        const supportZ = support.level * Z_STEP;
        const supportX = x * TILE_UNITS + 128;
        const supportY = y * TILE_UNITS + 128;
        project(
          supportX,
          supportY,
          supportZ,
          map.width,
          map.height,
          camera.rotation,
          this.projected,
        );
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
          supportX,
          supportY,
          supportZ,
          frame.width,
          frame.height,
          support.sprite,
          anchorKey(map, camera.rotation, supportX, supportY, supportZ) - 0.01,
        );
      }
      const flags = paths[o + 3];
      const sprite = pathElementSprite(flags, paths[o + 5]!, camera.rotation);
      const worldX = x * TILE_UNITS + 128;
      const worldY = y * TILE_UNITS + 128;
      const depth = anchorKey(map, camera.rotation, worldX, worldY, z);
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
        this.append(worldX, worldY, z, 40, 26, sprite, depth);
        for (const rail of queueRailSprites(flags, camera.rotation))
          this.append(worldX, worldY, z, 40, 26, rail.sprite, depth);
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
            anchorKey(map, camera.rotation, worldX, worldY, shelterZ),
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
              anchorKey(
                map,
                camera.rotation,
                worldX + placement.x,
                worldY + placement.y,
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
      const flags = items[offset + 3]!;
      const wall = isWallScenery(items[offset + 4]!);
      const z = wall
        ? map.heights[tile]! * Z_STEP
        : sceneryGroundZ(map.heights[tile]!, map.slope[tile]!, camera.rotation);
      const item = SCENERY_CATALOG[items[offset + 4]];
      if (!item) continue;
      const box = sceneryBox(item);
      const worldX = x * TILE_UNITS + TILE_UNITS / 2;
      const worldY = y * TILE_UNITS + TILE_UNITS / 2;
      const depth = anchorKey(map, camera.rotation, worldX, worldY, z);
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
        wall
          ? wallSpriteName(item.sprite, flags, map.slope[tile]!, camera.rotation)
          : item.sprite === 'flower-bed'
            ? flowerBedSpriteName(x, y, camera.rotation, map.slope[tile]!)
            : item.sprite === 'shrub'
              ? shrubSpriteName(x, y, camera.rotation)
              : scenerySpriteName(item.sprite, camera.rotation),
        depth,
      );
    }
  }

  /** The park boundary fence: a wall-style sprite on every edge of owned land. */
  private appendParkFence(
    map: MapData,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const edges = parkBoundaryEdges(map);
    for (let i = 0; i < edges.length; i += 3) {
      const x = edges[i]!;
      const y = edges[i + 1]!;
      const tile = y * map.width + x;
      const z = map.heights[tile]! * Z_STEP;
      const worldX = x * TILE_UNITS + TILE_UNITS / 2;
      const worldY = y * TILE_UNITS + TILE_UNITS / 2;
      project(worldX, worldY, z, map.width, map.height, camera.rotation, this.projected);
      if (
        !inViewport(
          this.projected[0],
          this.projected[1],
          camera,
          viewportWidth,
          viewportHeight,
          64,
          48,
        )
      )
        continue;
      this.append(
        worldX,
        worldY,
        z,
        64,
        48,
        wallSpriteName(PARK_FENCE, edges[i + 2]!, map.slope[tile]!, camera.rotation),
        anchorKey(map, camera.rotation, worldX, worldY, z),
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
        const depth = anchorKey(map, camera.rotation, centerX, centerY, z);
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
      const depth = anchorKey(
        map,
        camera.rotation,
        layer.data[offset],
        layer.data[offset + 1],
        layer.data[offset + 2] + PATH_SURFACE_Z,
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
        PATH_SURFACE_Z,
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
    scene.build(snapshot, map, camera.rotation, this.undergroundView, this.trenches.tiles);
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
      ) {
        this.ghostMode = item.xray ? 3 : 0;
        this.append(item.x, item.y, item.z, frame.width, frame.height, item.key, item.depth);
        this.ghostMode = 0;
      }
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
      const frameIndex = rideSpriteFrame(
        item.phase,
        snapshot.tick,
        entry.frames.length,
        item.phaseProgress,
      );
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
        snapshot.rideInfo[offset + RideInfo.PhaseProgress],
      );
      const frame = entry?.frames[frameIndex] ?? entry?.frames[0];
      const width = frame?.width ?? 12;
      const height = frame?.height ?? 14;
      const depth = anchorKey(map, camera.rotation, worldX, worldY, z);
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
      const depth = anchorKey(
        map,
        camera.rotation,
        layer.data[offset],
        layer.data[offset + 1],
        layer.data[offset + 2] + PATH_SURFACE_Z,
      );
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
        PATH_SURFACE_Z,
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
      const z = layer.data[offset + 2] + PATH_SURFACE_Z;
      const key = `${peopleSpriteKey(kind, direction, camera.rotation)}#${walkingFrame(tick)}`;
      const entry = spritePages.resolve(key.split('#')[0]);
      const frame = entry?.frames[0];
      const width = frame?.width ?? 16;
      const height = frame?.height ?? 24;
      const depth = anchorKey(map, camera.rotation, x, y, z);
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
    lift = 0,
  ): void {
    const x = layer.data[offset];
    const y = layer.data[offset + 1];
    const z = layer.data[offset + 2] + lift;
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
    mesh: MeshExtras = NO_MESH_EXTRAS,
  ): void {
    if (this.count === this.depths.length) this.grow();
    const anchorZ = z;
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
      if (mesh.crop) {
        const [left, right, top, bottom] = mesh.crop;
        const cropU0 = u0 + (u1 - u0) * left;
        const cropU1 = u0 + (u1 - u0) * right;
        const cropV1 = v1 - (v1 - v0) * top;
        const cropV0 = v1 - (v1 - v0) * bottom;
        u0 = cropU0;
        u1 = cropU1;
        v0 = cropV0;
        v1 = cropV1;
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
    this.instanceData[offset + 14] =
      meshMode === LAND_OVERLAY_MODE
        ? contourEdges
        : meshMode === 1 && this.gridlinesActive
          ? 1 + contourEdges
          : 0;
    this.instanceData[offset + 15] = terrainShade;
    this.instanceData[offset + ANCHOR_SHIFT_FLOAT] = anchorShift;
    this.instanceData[offset + GHOST_FLOAT] = this.ghostMode;
    const objectId = this.objectIdFor(meshMode);
    this.instanceData[offset + OBJECT_ID_FLOAT] = objectId;
    this.instanceData[offset + ANCHOR_Z_FLOAT] = anchorZ;
    this.instanceData[offset + HEIGHT_SCALE_FLOAT] = frame && !meshMode ? height / frame.height : 1;
    this.instanceData[offset + HOLE_FLOAT] = mesh.hole ?? 0;
    this.translucent[this.count] =
      meshMode === LAND_OVERLAY_MODE
        ? PASS_GROUND_OVERLAY
        : this.ghostMode !== 0 || meshMode === 3 || (meshMode > 1.4 && meshMode < 2.5)
          ? PASS_TRANSLUCENT
          : PASS_OPAQUE;
    if (this.captureRecords)
      this.captureRecords[this.count] =
        objectId < FIRST_INSTANCE_OBJECT_ID
          ? undefined
          : {
              id: objectId,
              kind: frame && typeof sprite === 'string' ? objectKind(sprite) : 'other',
              frame: frame && meshMode === 0 ? frame : undefined,
            };
    this.depths[this.count] = Math.round(depth * 2);
    this.pageIds[this.count] = page;
    this.count++;
  }

  /** Adds terrain geometry for the depth pass without resolving atlas and painter-order data. */
  private appendDepthInstance(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    corners: readonly number[],
    meshMode: number,
    hole = 0,
  ): void {
    if (this.count === this.depths.length) this.grow();
    const offset = this.count * INSTANCE_FLOATS;
    this.instanceData[offset] = x;
    this.instanceData[offset + 1] = y;
    this.instanceData[offset + 2] = z;
    this.instanceData[offset + 3] = width;
    this.instanceData[offset + 4] = height;
    this.instanceData[offset + 5] = 0;
    this.instanceData[offset + 6] = 0;
    this.instanceData[offset + 7] = 1;
    this.instanceData[offset + 8] = 1;
    this.instanceData[offset + 9] = meshMode;
    this.instanceData[offset + 10] = corners[0] ?? z;
    this.instanceData[offset + 11] = corners[1] ?? z;
    this.instanceData[offset + 12] = corners[2] ?? z;
    this.instanceData[offset + 13] = corners[3] ?? z;
    this.instanceData[offset + 14] = 0;
    this.instanceData[offset + 15] = 1;
    this.instanceData[offset + 16] = 0;
    this.instanceData[offset + 17] = 0;
    this.instanceData[offset + 18] = 0;
    this.instanceData[offset + 19] = 0;
    this.instanceData[offset + 20] = z;
    this.instanceData[offset + 21] = 1;
    this.instanceData[offset + HOLE_FLOAT] = hole;
    this.count++;
  }

  /**
   * Ground meshes share one id, water another and the land overlay a third; patrol overlays and
   * placement previews have none; every other instance gets its own.
   */
  private objectIdFor(meshMode: number): number {
    if (meshMode === 1 || meshMode === 4 || meshMode === 5) return GROUND_OBJECT_ID;
    if (meshMode === 3) return WATER_OBJECT_ID;
    if (meshMode === LAND_OVERLAY_MODE) return LAND_OVERLAY_OBJECT_ID;
    if (meshMode !== 0 || this.ghostMode !== 0) return 0;
    return this.nextObjectId++;
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
    const nextTranslucent = new Uint8Array(nextCapacity);
    nextTranslucent.set(this.translucent);
    this.translucent = nextTranslucent;
    this.orderedData = new Float32Array(nextCapacity * INSTANCE_FLOATS);
    this.order = new Int32Array(nextCapacity);
    this.partition = new Int32Array(nextCapacity);
    this.orderedPages = new Int16Array(nextCapacity);
  }

  private uploadInPainterOrder(): void {
    const gl = this.gl;
    const buffer = this.instanceBuffer;
    if (!gl || !buffer) return;
    sortByDepth(this.depths, this.count, this.order);
    // Ground overlay first, then opaque instances, then the translucent pass, each keeping its
    // back-to-front order.
    const partition = this.partition;
    let next = 0;
    for (const pass of [PASS_GROUND_OVERLAY, PASS_OPAQUE, PASS_TRANSLUCENT])
      for (let i = 0; i < this.count; i++)
        if (this.translucent[this.order[i]] === pass) partition[next++] = this.order[i];
    let underlay = 0;
    let opaque = 0;
    for (let i = 0; i < this.count; i++)
      if (this.translucent[i] === PASS_GROUND_OVERLAY) underlay++;
      else if (this.translucent[i] === PASS_OPAQUE) opaque++;
    opaque += underlay;
    this.partition = this.order;
    this.order = partition;
    for (let i = 0; i < this.count; i++) {
      const source = this.order[i];
      const from = source * INSTANCE_FLOATS;
      const to = i * INSTANCE_FLOATS;
      for (let j = 0; j < INSTANCE_FLOATS; j++)
        this.orderedData[to + j] = this.instanceData[from + j];
      this.orderedPages[i] = this.pageIds[source];
    }
    const sections = [
      { from: 0, to: underlay },
      { from: underlay, to: opaque },
      { from: opaque, to: this.count },
    ];
    this.runs.length = 0;
    const runStarts: number[] = [];
    for (const { from, to } of sections) {
      runStarts.push(this.runs.length);
      const built = buildTextureRuns(this.orderedPages.subarray(from, to), TEXTURE_SLOTS);
      for (const run of built.runs) this.runs.push({ ...run, start: run.start + from });
      for (let i = from; i < to; i++)
        this.orderedData[i * INSTANCE_FLOATS + SLOT_FLOAT] = built.slots[i - from];
    }
    this.opaqueRun = runStarts[1];
    this.translucentRun = runStarts[2];
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

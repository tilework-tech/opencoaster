import { Z_STEP } from '../../src/sim/core/constants';
import { PIECES, pieceByName } from '../../src/sim/track/catalog';
import { pieceExit } from '../../src/sim/track/construction';
import type { TrackPieceDef } from '../../src/sim/track/track-types';
import { PieceMode } from '../../src/sim/track/track-types';
import { artPieces, trackCellSprites, transportTrackCells } from '../../src/render/coaster-art';
import type { TrackArt, TrackRideFamily, TransportFamily } from '../../src/render/coaster-art';
import { project, Z_PIXELS } from '../../src/render/projection';
import { nativeSpriteAnchorShift, nativeSpriteWorldOffset } from '../../src/render/world-art';
import type { Rotation } from '../../src/render/projection';
import { rotateMesh, translateMesh } from './mesh';
import type { Mesh } from './mesh';
import { alignFrames } from './output';
import type { SpriteDef } from './output';
import { TRANSPARENT, renderMesh } from './raster';
import type { Sprite } from './raster';
import { trackPieceMesh } from './models/coaster/track';
import { TRANSPORT_STYLES } from './models/transport';
import { waterTrackMesh } from './models/water-track';

/** Side of the square map the pieces are laid out on; large enough for any rotation. */
export const MAP_SIZE = 64;

/** A ride family whose track pieces are drawn as per-tile cell sprites. */
export interface TrackKind {
  name: string;
  pieces: TrackPieceDef[];
  /** The whole-piece model in height levels, entering along +x through the centre of its origin tile. */
  mesh: (piece: TrackPieceDef) => Mesh;
  /** Cell sprites of a piece placed with `dir` and viewed from `rotation`. */
  cells: (
    piece: TrackPieceDef,
    dir: number,
    rotation: number,
  ) => Array<{ key: string; dx: number; dy: number }>;
}

export function coasterKind(art: TrackArt, family: TrackRideFamily): TrackKind {
  return {
    name: `coaster-${art}`,
    pieces: artPieces(art),
    mesh: (piece) => trackPieceMesh(piece, art),
    cells: (piece, dir, rotation) =>
      trackCellSprites(piece.id, dir, rotation, family, PieceMode.Normal, 0),
  };
}

export function waterKind(
  family: 'log-flume' | 'river-rapids',
  pieces: TrackPieceDef[],
): TrackKind {
  return {
    name: `water-${family}`,
    pieces,
    mesh: (piece) => waterTrackMesh(piece, (piece.flags & 256) !== 0),
    cells: (piece, dir, rotation) =>
      trackCellSprites(piece.id, dir, rotation, family, PieceMode.Normal, 0),
  };
}

export function transportKind(style: TransportFamily, pieces: TrackPieceDef[]): TrackKind {
  const transport = TRANSPORT_STYLES.find((s) => s.style === style)!;
  return {
    name: `transport-${style}`,
    pieces,
    mesh: (piece) => transport.track(piece),
    cells: (piece, dir, rotation) => transportTrackCells(piece.id, dir, rotation, style),
  };
}

export interface Placement {
  piece: TrackPieceDef;
  x: number;
  y: number;
  /** Entry height in height levels. */
  z: number;
  dir: number;
}

/** Lays pieces end to end from the start point using the simulation's own exit rule. */
export function chain(
  names: readonly string[],
  start: { x: number; y: number; z: number; dir: number },
): Placement[] {
  const out: Placement[] = [];
  let at = { ...start };
  for (const name of names) {
    const piece = pieceByName(name);
    if (!piece) throw new Error(`unknown piece ${name}`);
    out.push({ piece, ...at });
    at = pieceExit(piece.id, at.x, at.y, at.z, at.dir);
  }
  return out;
}

/** A paletted raster with an explicit offset of its top-left pixel from the map origin. */
export interface Canvas {
  left: number;
  top: number;
  width: number;
  height: number;
  pixels: Uint8Array;
}

export function newCanvas(left: number, top: number, width: number, height: number): Canvas {
  return { left, top, width, height, pixels: new Uint8Array(width * height).fill(TRANSPARENT) };
}

function blit(canvas: Canvas, sprite: Sprite, originX: number, originY: number): void {
  const ox = originX - sprite.anchor.x - canvas.left;
  const oy = originY - sprite.anchor.y - canvas.top;
  blitAt(canvas, sprite, ox, oy);
}

function blitAt(canvas: Canvas, sprite: Sprite, ox: number, oy: number): void {
  for (let y = 0; y < sprite.height; y++)
    for (let x = 0; x < sprite.width; x++) {
      const p = sprite.pixels[y * sprite.width + x];
      if (p === TRANSPARENT) continue;
      const cx = x + ox;
      const cy = y + oy;
      if (cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) continue;
      canvas.pixels[cy * canvas.width + cx] = p;
    }
}

const out2 = new Float64Array(2);

/** Screen position the renderer gives a world point (tile units) for a camera rotation. */
function screenOf(tx: number, ty: number, level: number, rotation: Rotation): [number, number] {
  project(tx * 256, ty * 256, level * Z_STEP, MAP_SIZE, MAP_SIZE, rotation, out2);
  return [out2[0], out2[1]];
}

/** Painter order of a tile in a rotated view: far tiles first. */
function tileDepth(x: number, y: number, rotation: Rotation): number {
  const tx = x + 0.5;
  const ty = y + 0.5;
  switch (rotation) {
    case 0:
      return tx + ty;
    case 1:
      return MAP_SIZE - ty + tx;
    case 2:
      return 2 * MAP_SIZE - tx - ty;
    default:
      return ty + MAP_SIZE - tx;
  }
}

export interface SpriteLookup {
  get(key: string): SpriteDef | undefined;
}

/** A frame as the atlas stores it: transparent borders trimmed, anchor moved with the trim. */
function packedFrame(def: SpriteDef): Sprite {
  const frames = alignFrames(def.frames);
  const { width, height } = frames[0];
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (const frame of frames)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (frame.pixels[y * width + x] !== TRANSPARENT) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
  const trimmedWidth = right - left + 1;
  const trimmedHeight = bottom - top + 1;
  const pixels = new Uint8Array(trimmedWidth * trimmedHeight);
  for (let y = 0; y < trimmedHeight; y++)
    for (let x = 0; x < trimmedWidth; x++)
      pixels[y * trimmedWidth + x] = frames[0].pixels[(y + top) * width + x + left];
  return {
    width: trimmedWidth,
    height: trimmedHeight,
    anchor: { x: frames[0].anchor.x - left, y: frames[0].anchor.y - top },
    pixels,
  };
}

const packedCache = new WeakMap<SpriteDef, Sprite>();
function frameOf(def: SpriteDef): Sprite {
  let sprite = packedCache.get(def);
  if (!sprite) {
    sprite = packedFrame(def);
    packedCache.set(def, sprite);
  }
  return sprite;
}

/**
 * Top-left pixel of a packed sprite whose quad the renderer centres on the projected point and
 * then moves by the anchor shift and height offset.
 */
function placedOrigin(sprite: Sprite, x: number, y: number): [number, number] {
  const centreX = x + nativeSpriteAnchorShift(sprite.width, sprite.anchor.x);
  const centreY = y - nativeSpriteWorldOffset(sprite.height, sprite.anchor.y) * (Z_PIXELS / Z_STEP);
  return [Math.round(centreX - sprite.width / 2), Math.round(centreY - sprite.height / 2)];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Cell sprites drawn exactly as the renderer places and orders them. */
export function composeCells(
  kind: TrackKind,
  placements: readonly Placement[],
  rotation: Rotation,
  sprites: SpriteLookup,
  margin = 40,
): Canvas {
  const drawn: Array<{ sprite: Sprite; x: number; y: number; depth: number }> = [];
  for (const placement of placements) {
    for (const cell of kind.cells(placement.piece, placement.dir, rotation)) {
      const def = sprites.get(cell.key);
      if (!def) continue;
      const tileX = placement.x + cell.dx;
      const tileY = placement.y + cell.dy;
      const [x, y] = screenOf(tileX + 0.5, tileY + 0.5, placement.z, rotation);
      drawn.push({ sprite: frameOf(def), x, y, depth: tileDepth(tileX, tileY, rotation) });
    }
  }
  return paint(drawn, margin);
}

function paint(
  drawn: Array<{ sprite: Sprite; x: number; y: number; depth: number }>,
  margin: number,
): Canvas {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of drawn) {
    const [x, y] = placedOrigin(d.sprite, d.x, d.y);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + d.sprite.width);
    maxY = Math.max(maxY, y + d.sprite.height);
  }
  const left = Math.floor(minX) - margin;
  const top = Math.floor(minY) - margin;
  const canvas = newCanvas(
    left,
    top,
    Math.ceil(maxX) + margin - left,
    Math.ceil(maxY) + margin - top,
  );
  drawn.sort((a, b) => a.depth - b.depth);
  for (const d of drawn) {
    const [x, y] = placedOrigin(d.sprite, d.x, d.y);
    blitAt(canvas, d.sprite, x - canvas.left, y - canvas.top);
  }
  return canvas;
}

/**
 * The whole models of the placed pieces, unclipped, rendered in one pass: what the cell sprites
 * should add up to.
 */
export function composeModels(
  kind: TrackKind,
  placements: readonly Placement[],
  rotation: Rotation,
  like: Canvas,
): Canvas {
  const mesh: Mesh = [];
  for (const placement of placements) {
    const view = (placement.dir + rotation) & 3;
    const [vx, vy] = viewTile(placement.x + 0.5, placement.y + 0.5, rotation);
    mesh.push(...translateMesh(rotateMesh(kind.mesh(placement.piece), view), vx, vy, placement.z));
  }
  const sprite = renderMesh(mesh);
  const canvas = newCanvas(like.left, like.top, like.width, like.height);
  blit(canvas, sprite, 0, 0);
  return canvas;
}

/** Continuous view-space tile position of a world tile position (see `project`). */
export function viewTile(tx: number, ty: number, rotation: Rotation): [number, number] {
  switch (rotation) {
    case 0:
      return [tx, ty];
    case 1:
      return [MAP_SIZE - ty, tx];
    case 2:
      return [MAP_SIZE - tx, MAP_SIZE - ty];
    default:
      return [ty, MAP_SIZE - tx];
  }
}

export { PIECES };

/** Straight pieces of `pool` that continue a piece's entry and exit slope and bank classes. */
export function neighbours(
  piece: TrackPieceDef,
  pool: readonly TrackPieceDef[] = PIECES,
): { before?: TrackPieceDef; after?: TrackPieceDef } {
  const straights = pool.filter((p) => p.shape === 'straight' && p.dx === 1 && p.dy === 0);
  return {
    before: straights.find(
      (p) => p.exitSlope === piece.entrySlope && p.exitBank === piece.entryBank,
    ),
    after: straights.find(
      (p) => p.entrySlope === piece.exitSlope && p.entryBank === piece.exitBank,
    ),
  };
}

import { Z_STEP } from '../../src/sim/core/constants';
import { PIECES, pieceByName } from '../../src/sim/track/catalog';
import { pieceExit } from '../../src/sim/track/construction';
import type { TrackPieceDef } from '../../src/sim/track/track-types';
import { PieceMode } from '../../src/sim/track/track-types';
import { artPieces, trackCellSprites, transportTrackCells } from '../../src/render/coaster-art';
import type { TrackArt, TrackRideFamily, TransportFamily } from '../../src/render/coaster-art';
import { project } from '../../src/render/projection';
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

const alignedCache = new WeakMap<SpriteDef, Sprite>();
function frameOf(def: SpriteDef): Sprite {
  let sprite = alignedCache.get(def);
  if (!sprite) {
    sprite = alignFrames(def.frames)[0];
    alignedCache.set(def, sprite);
  }
  return sprite;
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
    minX = Math.min(minX, d.x - d.sprite.anchor.x);
    minY = Math.min(minY, d.y - d.sprite.anchor.y);
    maxX = Math.max(maxX, d.x - d.sprite.anchor.x + d.sprite.width);
    maxY = Math.max(maxY, d.y - d.sprite.anchor.y + d.sprite.height);
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
  for (const d of drawn) blit(canvas, d.sprite, Math.round(d.x), Math.round(d.y));
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

/** Straight pieces that continue a piece's entry and exit slope and bank classes. */
export function neighbours(piece: TrackPieceDef): {
  before?: TrackPieceDef;
  after?: TrackPieceDef;
} {
  const straights = PIECES.filter((p) => p.shape === 'straight' && p.dx === 1 && p.dy === 0);
  return {
    before: straights.find(
      (p) => p.exitSlope === piece.entrySlope && p.exitBank === piece.entryBank,
    ),
    after: straights.find(
      (p) => p.entrySlope === piece.exitSlope && p.entryBank === piece.exitBank,
    ),
  };
}

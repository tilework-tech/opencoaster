import { RIDE_CATALOG } from '../sim/rides/ride-types';
import type { RideType } from '../sim/rides/ride-types';
import { pieceByName } from '../sim/track/catalog';
import { pieceExit } from '../sim/track/construction';
import type { TrackPoint } from '../sim/track/construction';
import { worldToScreen } from '../render/projection';
import type { Rotation } from '../render/projection';
import {
  carSpriteKey,
  trackCellSprites,
  trackedRideFamily,
  transportCarSpriteKey,
  transportFamily,
  transportTrackCells,
} from '../render/coaster-art';
import { isSlicedRide } from '../render/ride-scene';
import type { SpritePages } from '../render/sprite-pages';
import {
  facilitySpriteKey,
  ridePreviewSpriteKey,
  rideSpriteFrame,
  rideSpriteKey,
} from '../render/world-art';

/** Largest magnification of a preview, in CSS pixels per sprite pixel. */
export const PREVIEW_MAX_SCALE = 3;
/** Margin kept clear around the artwork, in CSS pixels. */
const PREVIEW_MARGIN = 4;

/** Tiles of the virtual map the track loop is projected on; only offsets between tiles matter. */
const LOOP_MAP = { width: 16, height: 16 } as const;
const LOOP_ORIGIN = { x: 4, y: 4 } as const;
/** A station, then four right-hand turns joined by straights: a closed oval a car can circle. */
const LOOP_PIECES = [
  'station',
  'smallRight',
  'flat',
  'smallRight',
  'flat',
  'smallRight',
  'flat',
  'smallRight',
] as const;

export interface RidePreviewRequest {
  type: RideType;
  /** Quarter turns the ride is built at. */
  dir: number;
  /** Camera rotation, 0-3. */
  rotation: number;
  /** Ride phase; selects the animation frame of animated art. */
  phase: number;
  phaseTicks?: number;
  tick: number;
}

/** One sprite of a preview: its atlas key anchored `x`, `y` pixels from the preview origin. */
export interface PreviewItem {
  key: string;
  x: number;
  y: number;
  /** Painter order, later items draw over earlier ones. */
  order: number;
}

interface LoopPiece {
  pieceType: number;
  x: number;
  y: number;
  dir: number;
}

/** Pieces of the preview loop, each starting where the previous one ends. */
export function previewLoop(): LoopPiece[] {
  const pieces: LoopPiece[] = [];
  let cursor: TrackPoint = { x: LOOP_ORIGIN.x, y: LOOP_ORIGIN.y, z: 0, dir: 0 };
  for (const name of LOOP_PIECES) {
    const piece = pieceByName(name)!;
    pieces.push({ pieceType: piece.id, x: cursor.x, y: cursor.y, dir: cursor.dir });
    cursor = pieceExit(piece.id, cursor.x, cursor.y, cursor.z, cursor.dir);
  }
  return pieces;
}

function projectTile(tileX: number, tileY: number, rotation: number): [number, number] {
  return worldToScreen(tileX + 0.5, tileY + 0.5, 0, rotation as Rotation, LOOP_MAP);
}

/** A track ride drawn as its station and a short closed loop of its own track with one car. */
function trackLoopItems(req: RidePreviewRequest): PreviewItem[] {
  const family = trackedRideFamily(req.type);
  const transport = transportFamily(req.type);
  const items: PreviewItem[] = [];
  const push = (key: string, tileX: number, tileY: number, order: number): void => {
    const [x, y] = projectTile(tileX, tileY, req.rotation);
    items.push({ key, x, y, order });
  };
  const loop = previewLoop();
  for (const { pieceType, x, y, dir } of loop) {
    const cells = family
      ? trackCellSprites(pieceType, dir, req.rotation, family, 0, req.tick)
      : transportTrackCells(pieceType, dir, req.rotation, transport!);
    for (const cell of cells) push(cell.key, x + cell.dx, y + cell.dy, 0);
  }
  const station = loop[0];
  const heading = (station.dir & 3) * 2;
  const car = family
    ? carSpriteKey(family, heading, 0, 0, req.rotation)
    : transportCarSpriteKey(transport!, heading, 0, req.rotation);
  push(car, station.x, station.y, 1);
  return items;
}

/**
 * The sprites that make up a ride's preview, in painter order. Flat rides use their whole-ride
 * view, stalls and facilities their shopfront, and track rides a loop of their own track.
 */
export function ridePreviewItems(req: RidePreviewRequest): PreviewItem[] {
  const def = RIDE_CATALOG[req.type];
  if (!def) return [];
  if (trackedRideFamily(req.type) || transportFamily(req.type)) {
    return trackLoopItems(req).sort((a, b) => a.order - b.order || a.y - b.y || a.x - b.x);
  }
  if (isSlicedRide(req.type))
    return [{ key: ridePreviewSpriteKey(req.type, req.dir, req.rotation), x: 0, y: 0, order: 0 }];
  if (def.category === 'stall' || def.category === 'shop' || def.category === 'facility')
    return [{ key: facilitySpriteKey(req.type, 1, req.rotation), x: 0, y: 0, order: 0 }];
  return [{ key: rideSpriteKey(req.type, req.rotation), x: 0, y: 0, order: 0 }];
}

export interface PreviewFit {
  /** Sprite pixels to canvas pixels; a whole number whenever the art fits at 1x or larger. */
  scale: number;
  /** Canvas position of the preview origin. */
  originX: number;
  originY: number;
}

/**
 * Scale and placement that centre `bounds` (in preview pixels) on a canvas. The scale is a whole
 * number when the art fits at 1x or more, so nearest-neighbour drawing stays crisp, and never
 * exceeds `maxScale`; art larger than the canvas is reduced just enough to fit.
 */
export function fitPreview(
  bounds: { left: number; top: number; right: number; bottom: number },
  canvas: { width: number; height: number },
  margin: number,
  maxScale: number,
): PreviewFit {
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const fit = Math.min((canvas.width - 2 * margin) / width, (canvas.height - 2 * margin) / height);
  const scale = fit >= 1 ? Math.min(Math.floor(fit), maxScale) : fit;
  const centreX = (bounds.left + bounds.right) / 2;
  const centreY = (bounds.top + bounds.bottom) / 2;
  return {
    scale,
    originX: Math.round(canvas.width / 2 - centreX * scale),
    originY: Math.round(canvas.height / 2 - centreY * scale),
  };
}

export type PreviewResult = 'drawn' | 'pending' | 'hidden';

interface ResolvedItem {
  item: PreviewItem;
  frame: { page: number; x: number; y: number; width: number; height: number };
  anchor: { x: number; y: number };
  image: ImageBitmap;
}

function resolveItems(
  atlas: SpritePages,
  items: PreviewItem[],
  frame: number,
): ResolvedItem[] | null {
  const resolved: ResolvedItem[] = [];
  let missing = false;
  for (const item of items) {
    const hash = item.key.lastIndexOf('#');
    const name = hash < 0 ? item.key : item.key.slice(0, hash);
    const entry = atlas.resolve(name);
    const index = hash < 0 ? (items.length === 1 ? frame : 0) : Number(item.key.slice(hash + 1));
    const sprite = entry?.frames[index] ?? entry?.frames[0];
    const image = sprite && atlas.pageImage(sprite.page);
    if (!entry || !sprite || !image) {
      // A lookup in an unloaded category starts loading it; the caller redraws when pages arrive.
      missing = true;
      continue;
    }
    resolved.push({ item, frame: sprite, anchor: entry.anchor, image });
  }
  return missing ? null : resolved;
}

/** Number of animation frames a single-sprite preview has, for choosing the running frame. */
function frameCount(atlas: SpritePages, items: PreviewItem[]): number {
  if (items.length !== 1) return 1;
  return atlas.resolve(items[0].key)?.frames.length ?? 1;
}

/**
 * Draws a ride preview centred in `canvas` at an integer scale with nearest-neighbour sampling,
 * sizing the canvas backing store to its on-screen size. Returns `pending` while atlas pages are
 * still loading (the lookups themselves start the load) and `hidden` while the canvas has no layout.
 */
export function drawRidePreview(
  canvas: HTMLCanvasElement,
  atlas: SpritePages,
  req: RidePreviewRequest,
  pixelRatio = window.devicePixelRatio || 1,
): PreviewResult {
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  if (cssWidth === 0 || cssHeight === 0) return 'hidden';
  const width = Math.round(cssWidth * pixelRatio);
  const height = Math.round(cssHeight * pixelRatio);
  const items = ridePreviewItems(req);
  const frame = rideSpriteFrame(req.phase, req.tick, frameCount(atlas, items), req.phaseTicks);
  const resolved = resolveItems(atlas, items, frame);
  if (!resolved || resolved.length === 0) return 'pending';
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return 'hidden';
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const { item, frame: sprite, anchor } of resolved) {
    bounds.left = Math.min(bounds.left, item.x - anchor.x);
    bounds.top = Math.min(bounds.top, item.y - anchor.y);
    bounds.right = Math.max(bounds.right, item.x - anchor.x + sprite.width);
    bounds.bottom = Math.max(bounds.bottom, item.y - anchor.y + sprite.height);
  }
  const fit = fitPreview(
    bounds,
    { width, height },
    PREVIEW_MARGIN * pixelRatio,
    Math.max(1, Math.floor(PREVIEW_MAX_SCALE * pixelRatio)),
  );
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;
  for (const { item, frame: sprite, anchor, image } of resolved) {
    context.drawImage(
      image,
      sprite.x,
      sprite.y,
      sprite.width,
      sprite.height,
      Math.round(fit.originX + (item.x - anchor.x) * fit.scale),
      Math.round(fit.originY + (item.y - anchor.y) * fit.scale),
      Math.round(sprite.width * fit.scale),
      Math.round(sprite.height * fit.scale),
    );
  }
  return 'drawn';
}

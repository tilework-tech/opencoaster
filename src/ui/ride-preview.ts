import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { PIECES, SAMPLES, pieceByName } from '../sim/track/catalog';
import { TILE_UNITS, TRACK_STEPS_PER_LEVEL, TRACK_Z_STEP, Z_STEP } from '../sim/core/constants';
import { CAR_LENGTH_Q8 } from '../sim/vehicles/vehicle-system';
import { pieceExit } from '../sim/track/construction';
import type { TrackPoint } from '../sim/track/construction';
import { viewDepth, worldToScreen, Z_PIXELS } from '../render/projection';
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
  observationTowerPartSpriteKey,
} from '../render/world-art';
import { DEFAULT_TOWER_HEIGHT, observationTowerCabinLevel } from '../sim/rides/observation-tower';

/** Largest magnification of a preview, in CSS pixels per sprite pixel. */
export const PREVIEW_MAX_SCALE = 3;
/** Margin kept clear around the artwork, in CSS pixels. */
const PREVIEW_MARGIN = 4;
/** Facing whose shopfront the stall sprites show at camera rotation 0. */
const SHOPFRONT_FACING = 1;

/** Tiles of the virtual map the track loop is projected on; only offsets between tiles matter. */
const LOOP_MAP = { width: 16, height: 16 } as const;
const LOOP_ORIGIN = { x: 4, y: 4 } as const;
/** A station, then four right-hand turns joined by straights: a closed oval a car can circle. */
const FLAT_LEG = ['flat', 'flat', 'flat', 'flat', 'flat', 'flat'] as const;
/** The same leg with a hill: up, over a rounded crest, and back down to the entry height. */
const HILL_LEG = [
  'flatToUp25',
  'up25',
  'up25ToFlat',
  'flatToDown25',
  'down25',
  'down25ToFlat',
] as const;
/** Cars in the preview train. */
const TRAIN_CARS = 6;
/** Arclength of the track the train's head has covered when drawn, in tiles from the station. */
const TRAIN_HEAD_TILES = 5.2;

function loopNames(hill: boolean): string[] {
  return [
    'station',
    'smallRight',
    ...(hill ? HILL_LEG : FLAT_LEG),
    'smallRight',
    'flat',
    'smallRight',
    ...FLAT_LEG,
    'smallRight',
  ];
}

export interface RidePreviewRequest {
  type: RideType;
  /** Quarter turns the ride is built at. */
  dir: number;
  /** Camera rotation, 0-3. */
  rotation: number;
  /** Ride phase; selects the animation frame of animated art. */
  phase: number;
  phaseProgress?: number;
  towerHeight?: number;
  towerCabinLevel?: number;
  tick: number;
}

/** One sprite of a preview: its atlas key anchored `x`, `y` pixels from the preview origin. */
export interface PreviewItem {
  key: string;
  x: number;
  y: number;
  /** Painter order, later items draw over earlier ones. */
  order: number;
  /** Distance from the camera plane; nearer sprites draw later within an order. */
  depth?: number;
}

interface LoopPiece {
  pieceType: number;
  x: number;
  y: number;
  /** Entry height in track steps. */
  z: number;
  dir: number;
}

function canBuild(type: RideType, names: readonly string[]): boolean {
  const allowed = RIDE_CATALOG[type]?.trackRules?.allowedPieces;
  return !allowed || names.every((name) => allowed.includes(pieceByName(name)!.id));
}

/**
 * Pieces of the preview loop, each starting where the previous one ends. Rides whose track
 * vocabulary has the slopes get a hill on one side of the oval; the rest keep it level.
 */
export function previewLoop(type: RideType): LoopPiece[] {
  const pieces: LoopPiece[] = [];
  let cursor: TrackPoint = { x: LOOP_ORIGIN.x, y: LOOP_ORIGIN.y, z: 0, dir: 0 };
  for (const name of loopNames(canBuild(type, HILL_LEG))) {
    const piece = pieceByName(name)!;
    pieces.push({ pieceType: piece.id, x: cursor.x, y: cursor.y, z: cursor.z, dir: cursor.dir });
    cursor = pieceExit(piece.id, cursor.x, cursor.y, cursor.z, cursor.dir);
  }
  return pieces;
}

/** A point of a piece's centre line in tile units (height in land levels), with its slope. */
interface TrackSample {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
}

/** Centre-line samples of one placed piece, rotated into the world like the vehicle track is. */
function pieceSamples(piece: LoopPiece): TrackSample[] {
  const def = PIECES[piece.pieceType];
  const half = TILE_UNITS / 2;
  const out: TrackSample[] = [];
  for (let k = def.sampleStart; k < def.sampleStart + def.sampleCount; k++) {
    const lx = SAMPLES.x[k] - half;
    const ly = SAMPLES.y[k] - half;
    const tx = SAMPLES.tx[k];
    const ty = SAMPLES.ty[k];
    const turns = piece.dir & 3;
    const [px, py] = rotateQuarter(lx, ly, turns);
    const [qx, qy] = rotateQuarter(tx, ty, turns);
    const horizontal = Math.hypot(qx, qy);
    const angle = (Math.atan2(Math.abs(SAMPLES.tz[k]), horizontal) * 180) / Math.PI;
    const magnitude = angle < 13 ? 0 : angle < 45 ? 1 : 2;
    out.push({
      x: (piece.x * TILE_UNITS + half + px) / TILE_UNITS,
      y: (piece.y * TILE_UNITS + half + py) / TILE_UNITS,
      z: (piece.z * TRACK_Z_STEP + SAMPLES.z[k]) / Z_STEP,
      heading: (((Math.round((Math.atan2(qy, qx) / (Math.PI * 2)) * 8) % 8) + 8) % 8) as number,
      pitch: SAMPLES.tz[k] < 0 ? -magnitude : magnitude,
    });
  }
  return out;
}

function rotateQuarter(x: number, y: number, turns: number): [number, number] {
  switch (turns) {
    case 1:
      return [-y, x];
    case 2:
      return [-x, -y];
    case 3:
      return [y, -x];
    default:
      return [x, y];
  }
}

/** The loop as a polyline of samples with the arclength at each, in tiles. */
function loopTrack(pieces: LoopPiece[]): { samples: TrackSample[]; arc: number[] } {
  const samples: TrackSample[] = [];
  for (const piece of pieces) {
    const next = pieceSamples(piece);
    samples.push(...(samples.length ? next.slice(1) : next));
  }
  const arc = [0];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    arc.push(arc[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, (b.z - a.z) * (Z_STEP / TILE_UNITS)));
  }
  return { samples, arc };
}

/** The sample at arclength `s` tiles along the loop, interpolated between its neighbours. */
function sampleAt(track: { samples: TrackSample[]; arc: number[] }, s: number): TrackSample {
  const { samples, arc } = track;
  const wrapped = ((s % arc[arc.length - 1]) + arc[arc.length - 1]) % arc[arc.length - 1];
  let i = 1;
  while (i < arc.length - 1 && arc[i] < wrapped) i++;
  const a = samples[i - 1];
  const b = samples[i];
  const t = arc[i] > arc[i - 1] ? (wrapped - arc[i - 1]) / (arc[i] - arc[i - 1]) : 0;
  const near = t < 0.5 ? a : b;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    heading: near.heading,
    pitch: near.pitch,
  };
}

function projectPoint(
  tileX: number,
  tileY: number,
  level: number,
  rotation: number,
): [number, number] {
  return worldToScreen(tileX, tileY, level, rotation as Rotation, LOOP_MAP);
}

function depthOf(tileX: number, tileY: number, rotation: number): number {
  return viewDepth(tileX, tileY, rotation as Rotation, LOOP_MAP);
}

/** A track ride drawn as a short closed loop of its own track with a hill and a train. */
function trackLoopItems(req: RidePreviewRequest): PreviewItem[] {
  const family = trackedRideFamily(req.type);
  const transport = transportFamily(req.type);
  const items: PreviewItem[] = [];
  const loop = previewLoop(req.type);
  for (const piece of loop) {
    const cells = family
      ? trackCellSprites(piece.pieceType, piece.dir, req.rotation, family, 0, req.tick)
      : transportTrackCells(piece.pieceType, piece.dir, req.rotation, transport!);
    for (const cell of cells) {
      const tileX = piece.x + cell.dx;
      const tileY = piece.y + cell.dy;
      const [x, y] = projectPoint(
        tileX + 0.5,
        tileY + 0.5,
        piece.z / TRACK_STEPS_PER_LEVEL,
        req.rotation,
      );
      items.push({
        key: cell.key,
        x,
        y,
        order: 0,
        depth: depthOf(tileX + 0.5, tileY + 0.5, req.rotation),
      });
    }
  }
  const track = loopTrack(loop);
  for (let car = 0; car < TRAIN_CARS; car++) {
    const at = sampleAt(track, TRAIN_HEAD_TILES - (car * CAR_LENGTH_Q8) / 256 / TILE_UNITS);
    const key = family
      ? carSpriteKey(family, at.heading, at.pitch, 0, req.rotation)
      : transportCarSpriteKey(transport!, at.heading, at.pitch, req.rotation);
    const [x, y] = projectPoint(at.x, at.y, at.z, req.rotation);
    items.push({ key, x, y, order: 1, depth: depthOf(at.x, at.y, req.rotation) });
  }
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
    return trackLoopItems(req).sort(
      (a, b) => a.order - b.order || (a.depth ?? 0) - (b.depth ?? 0) || a.y - b.y || a.x - b.x,
    );
  }
  if (req.type === RideType.ObservationTower) {
    const height = req.towerHeight ?? DEFAULT_TOWER_HEIGHT;
    const cabinLevel =
      req.towerCabinLevel ?? observationTowerCabinLevel(height, req.phase, req.phaseProgress ?? 0);
    const parts: Array<['base' | 'shaft' | 'top' | 'cabin', number]> = [
      ['base', 0],
      ...Array.from({ length: Math.max(0, height - 4) }, (_, section) =>
        ['shaft', section + 1] as ['shaft', number],
      ),
      ['top', height - 3],
      ['cabin', cabinLevel],
    ];
    return parts.map(([part, level], order) => ({
      key: observationTowerPartSpriteKey(part, req.rotation),
      x: 0,
      y: -level * Z_PIXELS,
      order,
    }));
  }
  if (isSlicedRide(req.type))
    return [{ key: ridePreviewSpriteKey(req.type, req.dir, req.rotation), x: 0, y: 0, order: 0 }];
  if (def.category === 'stall' || def.category === 'shop' || def.category === 'facility') {
    // The sprite turns with the camera, so counter-rotating the facing keeps the shopfront in view.
    const facing = (SHOPFRONT_FACING - req.rotation + 4) & 3;
    return [{ key: facilitySpriteKey(req.type, facing, req.rotation), x: 0, y: 0, order: 0 }];
  }
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
  const frame = rideSpriteFrame(req.phase, req.tick, frameCount(atlas, items), req.phaseProgress);
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

import type { World } from '../core/world';
import { TRACK_Z_STEP, Z_STEP } from '../core/constants';
import { PIECES } from './catalog';
import { MAX_PIECES_PER_RIDE, MAX_TRACK_LEVEL, MAX_TRACK_RIDES } from './track-store';
import { PieceFlag, PieceMode, TrackResult } from './track-types';
import type { Bank, Direction, Slope } from './track-types';
import { firstOccupancyBlocker, trackClearanceForRide, worldOccupancies } from '../map/occupancy';
import type { OccupancyVolume } from '../map/occupancy';

export interface PlaceRequest {
  rideId: number;
  pieceType: number;
  /** Origin tile and entry height of the piece, in track steps (TRACK_Z_STEP). */
  x: number;
  y: number;
  z: number;
  dir: Direction;
  mode: PieceMode;
}

export interface TrackPoint {
  x: number;
  y: number;
  z: number;
  dir: Direction;
}

/** Where the next piece of a ride attaches, and what it must match. */
export interface ConstructionCursor extends TrackPoint {
  hasTrack: boolean;
  closed: boolean;
  slope: Slope;
  bank: Bank;
}

export interface CircuitStatus {
  pieces: number;
  closed: boolean;
  stations: number;
  /** A closed circuit with at least one station: the minimum for testing the ride. */
  complete: boolean;
  /** Centre-line length in TILE_UNITS. */
  length: number;
}

/** Rotates a local tile offset by `dir` quarter turns about the origin tile. */
export function rotateTile(i: number, j: number, dir: number): [number, number] {
  switch (dir & 3) {
    case 0:
      return [i, j];
    case 1:
      return [-j, i];
    case 2:
      return [-i, -j];
    default:
      return [j, -i];
  }
}

export function pieceExit(
  pieceType: number,
  x: number,
  y: number,
  z: number,
  dir: number,
): TrackPoint {
  const p = PIECES[pieceType];
  const [rx, ry] = rotateTile(p.dx, p.dy, dir);
  return { x: x + rx, y: y + ry, z: z + p.dz, dir: ((dir + p.headingDelta) & 3) as Direction };
}

function validRide(world: World, rideId: number): boolean {
  return (
    Number.isInteger(rideId) &&
    rideId >= 0 &&
    rideId < MAX_TRACK_RIDES &&
    world.rides.isAlive(rideId)
  );
}

function modeAllowed(flags: number, mode: number): boolean {
  switch (mode) {
    case PieceMode.Normal:
      return true;
    case PieceMode.ChainLift:
    case PieceMode.WaterLift:
      return (flags & PieceFlag.LiftOk) !== 0;
    case PieceMode.Brake:
    case PieceMode.BlockBrake:
      return (flags & PieceFlag.BrakeOk) !== 0;
    case PieceMode.Launch:
      return (flags & PieceFlag.LaunchOk) !== 0;
    default:
      return false;
  }
}

export function getConstructionCursor(world: World, rideId: number): ConstructionCursor {
  const t = world.track;
  const none: ConstructionCursor = {
    hasTrack: false,
    closed: false,
    x: 0,
    y: 0,
    z: 0,
    dir: 0,
    slope: 0 as Slope,
    bank: 0 as Bank,
  };
  if (rideId < 0 || rideId >= MAX_TRACK_RIDES || t.tail[rideId] < 0) return none;
  const c = t.pieces.cols;
  const s = t.pieces.idToSlot[t.tail[rideId]];
  const def = PIECES[c.pieceType[s]];
  const exit = pieceExit(def.id, c.x[s], c.y[s], c.z[s], c.dir[s]);
  return {
    hasTrack: true,
    closed: t.closed[rideId] === 1,
    ...exit,
    slope: def.exitSlope,
    bank: def.exitBank,
  };
}

/** Piece types that can be appended at the cursor (every piece when the ride has no track). */
export function connectablePieces(cursor: ConstructionCursor): number[] {
  const out: number[] = [];
  for (const p of PIECES) {
    if (!cursor.hasTrack || (p.entrySlope === cursor.slope && p.entryBank === cursor.bank)) {
      out.push(p.id);
    }
  }
  return out;
}

/** The open ends a new piece joins: the piece it follows and the piece it leads into (-1 = none). */
export interface Attach {
  after: number;
  before: number;
}

/** Whether the piece in `slot` ends exactly where `req` begins, in position, heading, slope and bank. */
function endsAt(world: World, slot: number, req: PlaceRequest): boolean {
  const c = world.track.pieces.cols;
  const def = PIECES[c.pieceType[slot]];
  const next = PIECES[req.pieceType];
  const exit = pieceExit(def.id, c.x[slot], c.y[slot], c.z[slot], c.dir[slot]);
  return (
    exit.x === req.x &&
    exit.y === req.y &&
    exit.z === req.z &&
    exit.dir === req.dir &&
    def.exitSlope === next.entrySlope &&
    def.exitBank === next.entryBank
  );
}

/** Whether the piece in `slot` begins exactly where `req` ends. */
function beginsAt(world: World, slot: number, req: PlaceRequest): boolean {
  const c = world.track.pieces.cols;
  const def = PIECES[c.pieceType[slot]];
  const prev = PIECES[req.pieceType];
  const exit = pieceExit(prev.id, req.x, req.y, req.z, req.dir);
  return (
    exit.x === c.x[slot] &&
    exit.y === c.y[slot] &&
    exit.z === c.z[slot] &&
    exit.dir === c.dir[slot] &&
    prev.exitSlope === def.entrySlope &&
    prev.exitBank === def.entryBank
  );
}

/**
 * The open ends of the ride's track that a placement meets. A ride's track is one or more
 * sections; a new piece may continue any section's last piece and lead into any section's first
 * piece, preferring the end of the section being built.
 */
export function attachPoint(world: World, req: PlaceRequest): Attach | TrackResult {
  const t = world.track;
  const r = req.rideId;
  if (t.tail[r] < 0) return { after: -1, before: -1 };
  const p = t.pieces;
  const c = p.cols;
  const activeTail = p.idToSlot[t.tail[r]];
  let after = c.next[activeTail] < 0 && endsAt(world, activeTail, req) ? t.tail[r] : -1;
  let before = -1;
  for (let slot = 0; slot < p.count; slot++) {
    if (c.rideId[slot] !== r) continue;
    if (after < 0 && c.next[slot] < 0 && endsAt(world, slot, req)) after = p.slotToId[slot];
    if (before < 0 && c.prev[slot] < 0 && beginsAt(world, slot, req)) before = p.slotToId[slot];
  }
  if (after < 0 && before < 0) return TrackResult.NotConnected;
  return { after, before };
}

/** Checks terrain, height and bounds, then clearance against all placed track. */
function checkSpace(world: World, req: PlaceRequest): TrackResult {
  const def = PIECES[req.pieceType];
  const map = world.map;
  const baseZ = req.z * TRACK_Z_STEP;
  const tunnelOk = (def.flags & PieceFlag.TunnelOk) !== 0;
  for (const cell of def.footprint) {
    const [rx, ry] = rotateTile(cell.i, cell.j, req.dir);
    const tx = req.x + rx;
    const ty = req.y + ry;
    if (!map.inBounds(tx, ty)) return TrackResult.OutOfBounds;
    const low = baseZ + cell.zMin;
    if (low < 0) return TrackResult.BelowGround;
    if (low < map.heights[map.index(tx, ty)] * Z_STEP && !tunnelOk) return TrackResult.BelowGround;
    if (baseZ + cell.zMax > MAX_TRACK_LEVEL * Z_STEP) return TrackResult.TooHigh;
  }

  const trackClearance = trackClearanceForRide(world, req.rideId);
  const candidates: OccupancyVolume[] = def.footprint.map((cell) => {
    const [rx, ry] = rotateTile(cell.i, cell.j, req.dir);
    return {
      tileX: req.x + rx,
      tileY: req.y + ry,
      base: baseZ + cell.zMin,
      clearance: baseZ + cell.zMax + trackClearance,
      kind: def.shape === 'station' ? 'station' : 'track',
      name: 'Track',
      levelCrossing: def.shape === 'straight' && cell.zMin === 0,
    };
  });
  const blocker = firstOccupancyBlocker(candidates, worldOccupancies(world));
  world.track.lastBlockerName = blocker ? describeBlocker(blocker, candidates) : '';
  if (blocker) return TrackResult.Blocked;
  return TrackResult.Ok;
}

function describeBlocker(blocker: OccupancyVolume, candidates: readonly OccupancyVolume[]): string {
  const candidate = candidates.find(
    (volume) => volume.tileX === blocker.tileX && volume.tileY === blocker.tileY,
  );
  if (!candidate) return blocker.name;

  const location = `(${blocker.tileX}, ${blocker.tileY})`;
  if (blocker.kind !== 'track' && blocker.kind !== 'station')
    return `${blocker.name} at ${location}`;

  const relation =
    blocker.base === candidate.base
      ? 'at this height'
      : blocker.base > candidate.base
        ? 'above'
        : blocker.clearance <= candidate.clearance
          ? 'below'
          : 'at this height';
  const separation =
    relation === 'above'
      ? candidate.clearance - blocker.base
      : relation === 'below'
        ? blocker.clearance - candidate.base
        : Math.min(candidate.clearance, blocker.clearance) - Math.max(candidate.base, blocker.base);
  const levels = Math.max(1, Math.ceil(separation / Z_STEP));
  const levelWord = levels === 1 ? 'level' : 'levels';
  return `${blocker.name} track ${relation} at ${location}; needs ${levels} more ${levelWord}`;
}

export function validatePlacement(world: World, req: PlaceRequest): TrackResult {
  if (!validRide(world, req.rideId)) return TrackResult.NoSuchRide;
  const def = PIECES[req.pieceType];
  if (!def || !Number.isInteger(req.pieceType)) return TrackResult.NoSuchPiece;
  if (!Number.isInteger(req.x) || !Number.isInteger(req.y) || !Number.isInteger(req.z)) {
    return TrackResult.OutOfBounds;
  }
  if (!(req.dir >= 0 && req.dir <= 3) || !Number.isInteger(req.dir))
    return TrackResult.NotConnected;
  if (!modeAllowed(def.flags, req.mode)) return TrackResult.BadMode;
  const t = world.track;
  if (t.closed[req.rideId] === 1) return TrackResult.CircuitClosed;
  if (t.count[req.rideId] >= MAX_PIECES_PER_RIDE) return TrackResult.TooManyPieces;
  if (t.pieces.freeCount === 0) return TrackResult.StoreFull;
  const attach = attachPoint(world, req);
  if (typeof attach === 'number') return attach;
  return checkSpace(world, req);
}

/**
 * Makes the section holding `id` the one the construction cursor builds on: `head` and `tail` become
 * its first and last piece. In a ring, `id` becomes the tail.
 */
function focusSection(world: World, rideId: number, id: number): void {
  const t = world.track;
  const p = t.pieces;
  const c = p.cols;
  let last = id;
  for (let next = c.next[p.idToSlot[last]]; next >= 0 && next !== id;) {
    last = next;
    next = c.next[p.idToSlot[last]];
  }
  if (c.next[p.idToSlot[last]] === id) {
    t.head[rideId] = c.next[p.idToSlot[id]];
    t.tail[rideId] = id;
    return;
  }
  let first = id;
  for (let prev = c.prev[p.idToSlot[first]]; prev >= 0; prev = c.prev[p.idToSlot[first]])
    first = prev;
  t.head[rideId] = first;
  t.tail[rideId] = last;
}

/** Walks a section from `id`, numbering arclengths from 0. Returns its piece count and length. */
function measureSection(world: World, id: number): [number, number] {
  const p = world.track.pieces;
  const c = p.cols;
  let s = 0;
  let n = 0;
  let at = id;
  do {
    const slot = p.idToSlot[at];
    c.startS[slot] = s;
    s += PIECES[c.pieceType[slot]].length;
    n++;
    at = c.next[slot];
  } while (at >= 0 && at !== id);
  return [n, s];
}

/**
 * Recomputes a ride's piece count, length, start arclengths (from the first piece of each section)
 * and whether its track is one closed circuit, and invalidates its path.
 */
export function relinkRide(world: World, rideId: number): void {
  const t = world.track;
  const p = t.pieces;
  const c = p.cols;
  t.version[rideId]++;
  t.paths[rideId] = null;
  if (t.head[rideId] < 0) {
    t.count[rideId] = 0;
    t.closed[rideId] = 0;
    t.length[rideId] = 0;
    return;
  }
  for (let slot = 0; slot < p.count; slot++) if (c.rideId[slot] === rideId) c.startS[slot] = -1;
  const [activeCount, activeLength] = measureSection(world, t.head[rideId]);
  const ring = c.prev[p.idToSlot[t.head[rideId]]] === t.tail[rideId];
  let count = activeCount;
  let length = activeLength;
  for (let pass = 0; pass < 2; pass++) {
    for (let slot = 0; slot < p.count; slot++) {
      if (c.rideId[slot] !== rideId || c.startS[slot] >= 0) continue;
      if (pass === 0 && c.prev[slot] >= 0) continue;
      const [n, s] = measureSection(world, p.slotToId[slot]);
      count += n;
      length += s;
    }
  }
  t.count[rideId] = count;
  t.length[rideId] = length;
  t.closed[rideId] = ring && activeCount === count ? 1 : 0;
}

/** Validates and applies a placement. Returns the result; the new piece id is `lastPiece`. */
export function placeTrack(world: World, req: PlaceRequest): TrackResult {
  const t = world.track;
  const result = validatePlacement(world, req);
  t.lastResult = result;
  t.lastPiece = -1;
  if (result !== TrackResult.Ok) return result;

  const attach = attachPoint(world, req) as Attach;
  const slot = t.pieces.spawn();
  const id = t.pieces.slotToId[slot];
  const c = t.pieces.cols;
  c.rideId[slot] = req.rideId;
  c.pieceType[slot] = req.pieceType;
  c.x[slot] = req.x;
  c.y[slot] = req.y;
  c.z[slot] = req.z;
  c.dir[slot] = req.dir;
  c.mode[slot] = req.mode;
  c.prev[slot] = attach.after;
  c.next[slot] = attach.before;
  if (attach.after >= 0) c.next[t.pieces.idToSlot[attach.after]] = id;
  if (attach.before >= 0) c.prev[t.pieces.idToSlot[attach.before]] = id;
  focusSection(world, req.rideId, id);
  relinkRide(world, req.rideId);
  t.lastPiece = id;
  return TrackResult.Ok;
}

/**
 * Removes a piece of the ride. `pieceId` -1 means the last piece of the section being built. The
 * rest of the track stays: removing a middle piece splits its section in two (or opens a closed
 * circuit there), and building continues from the piece before the gap.
 */
export function removeTrack(world: World, rideId: number, pieceId: number): TrackResult {
  const t = world.track;
  t.lastPiece = -1;
  const result = removeInner(world, rideId, pieceId);
  t.lastResult = result;
  return result;
}

function removeInner(world: World, rideId: number, pieceId: number): TrackResult {
  const t = world.track;
  if (!validRide(world, rideId)) return TrackResult.NoSuchRide;
  if (t.tail[rideId] < 0) return TrackResult.NoSuchPiece;
  const id = pieceId === -1 ? t.tail[rideId] : pieceId;
  if (!Number.isInteger(id) || id < 0 || !t.pieces.isAlive(id)) return TrackResult.NoSuchPiece;
  const p = t.pieces;
  const c = p.cols;
  const slot = p.idToSlot[id];
  if (c.rideId[slot] !== rideId) return TrackResult.NoSuchPiece;

  const prevId = c.prev[slot];
  const nextId = c.next[slot];
  if (prevId >= 0) c.next[p.idToSlot[prevId]] = -1;
  if (nextId >= 0) c.prev[p.idToSlot[nextId]] = -1;
  p.despawnSlot(slot);
  t.head[rideId] = -1;
  t.tail[rideId] = -1;
  const focus = prevId >= 0 ? prevId : nextId >= 0 ? nextId : firstPieceOf(world, rideId);
  if (focus >= 0) focusSection(world, rideId, focus);
  relinkRide(world, rideId);
  return TrackResult.Ok;
}

function firstPieceOf(world: World, rideId: number): number {
  const p = world.track.pieces;
  for (let slot = 0; slot < p.count; slot++)
    if (p.cols.rideId[slot] === rideId) return p.slotToId[slot];
  return -1;
}

/** Deletes every piece of a ride (called when the ride itself is demolished). */
export function removeRideTrack(world: World, rideId: number): void {
  const t = world.track;
  if (rideId < 0 || rideId >= MAX_TRACK_RIDES) return;
  const p = t.pieces;
  for (let slot = p.count - 1; slot >= 0; slot--)
    if (p.cols.rideId[slot] === rideId) p.despawnSlot(slot);
  t.head[rideId] = -1;
  t.tail[rideId] = -1;
  relinkRide(world, rideId);
}

export function circuitStatus(world: World, rideId: number): CircuitStatus {
  const t = world.track;
  const none = { pieces: 0, closed: false, stations: 0, complete: false, length: 0 };
  if (rideId < 0 || rideId >= MAX_TRACK_RIDES || t.head[rideId] < 0) return none;
  const p = t.pieces;
  let stations = 0;
  for (let slot = 0; slot < p.count; slot++) {
    if (p.cols.rideId[slot] === rideId && PIECES[p.cols.pieceType[slot]].flags & PieceFlag.Station)
      stations++;
  }
  const closed = t.closed[rideId] === 1;
  return {
    pieces: t.count[rideId],
    closed,
    stations,
    complete: closed && stations > 0,
    length: t.length[rideId],
  };
}

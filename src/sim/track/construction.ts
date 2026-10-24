import type { World } from '../core/world';
import { Z_STEP } from '../core/constants';
import { CLEARANCE_UNITS, PIECES } from './catalog';
import { MAX_PIECES_PER_RIDE, MAX_TRACK_LEVEL, MAX_TRACK_RIDES } from './track-store';
import { PieceFlag, PieceMode, TrackResult } from './track-types';
import type { Bank, Direction, Slope } from './track-types';

export interface PlaceRequest {
  rideId: number;
  pieceType: number;
  /** Origin tile and entry height level of the piece. */
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
      return (flags & PieceFlag.LiftOk) !== 0;
    case PieceMode.Brake:
    case PieceMode.BlockBrake:
      return (flags & PieceFlag.BrakeOk) !== 0;
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

type Attach = 'first' | 'tail' | 'head';

function attachPoint(world: World, req: PlaceRequest): Attach | TrackResult {
  const t = world.track;
  const r = req.rideId;
  if (t.tail[r] < 0) return 'first';
  const def = PIECES[req.pieceType];
  const cur = getConstructionCursor(world, r);
  if (
    cur.x === req.x &&
    cur.y === req.y &&
    cur.z === req.z &&
    cur.dir === req.dir &&
    cur.slope === def.entrySlope &&
    cur.bank === def.entryBank
  ) {
    return 'tail';
  }
  const hs = t.pieces.idToSlot[t.head[r]];
  const hdef = PIECES[t.pieces.cols.pieceType[hs]];
  const exit = pieceExit(def.id, req.x, req.y, req.z, req.dir);
  const c = t.pieces.cols;
  if (
    exit.x === c.x[hs] &&
    exit.y === c.y[hs] &&
    exit.z === c.z[hs] &&
    exit.dir === c.dir[hs] &&
    def.exitSlope === hdef.entrySlope &&
    def.exitBank === hdef.entryBank
  ) {
    return 'head';
  }
  return TrackResult.NotConnected;
}

/** Checks terrain, height and bounds, then clearance against all placed track. */
function checkSpace(world: World, req: PlaceRequest): TrackResult {
  const def = PIECES[req.pieceType];
  const map = world.map;
  const baseZ = req.z * Z_STEP;
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

  const c = world.track.pieces.cols;
  const n = world.track.pieces.count;
  for (let s = 0; s < n; s++) {
    const odef = PIECES[c.pieceType[s]];
    if (Math.abs(c.x[s] - req.x) > 6 || Math.abs(c.y[s] - req.y) > 6) continue;
    const obase = c.z[s] * Z_STEP;
    for (const oc of odef.footprint) {
      const [ox, oy] = rotateTile(oc.i, oc.j, c.dir[s]);
      const otx = c.x[s] + ox;
      const oty = c.y[s] + oy;
      for (const cell of def.footprint) {
        const [rx, ry] = rotateTile(cell.i, cell.j, req.dir);
        if (req.x + rx !== otx || req.y + ry !== oty) continue;
        const lo = baseZ + cell.zMin;
        const hi = baseZ + cell.zMax + CLEARANCE_UNITS;
        const olo = obase + oc.zMin;
        const ohi = obase + oc.zMax + CLEARANCE_UNITS;
        if (lo <= ohi && olo <= hi) return TrackResult.Blocked;
      }
    }
  }
  return TrackResult.Ok;
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

/** Recomputes arclength offsets, length and closure for a ride after an edit. */
function relink(world: World, rideId: number): void {
  const t = world.track;
  const c = t.pieces.cols;
  t.version[rideId]++;
  t.paths[rideId] = null;
  if (t.head[rideId] < 0) {
    t.count[rideId] = 0;
    t.closed[rideId] = 0;
    t.length[rideId] = 0;
    return;
  }
  let id = t.head[rideId];
  let s = 0;
  let n = 0;
  do {
    const slot = t.pieces.idToSlot[id];
    c.startS[slot] = s;
    s += PIECES[c.pieceType[slot]].length;
    n++;
    id = c.next[slot];
  } while (id >= 0 && id !== t.head[rideId]);
  t.count[rideId] = n;
  t.length[rideId] = s;
}

function closesCircuit(world: World, rideId: number): boolean {
  const t = world.track;
  const c = t.pieces.cols;
  const ts = t.pieces.idToSlot[t.tail[rideId]];
  const hs = t.pieces.idToSlot[t.head[rideId]];
  const tdef = PIECES[c.pieceType[ts]];
  const hdef = PIECES[c.pieceType[hs]];
  const e = pieceExit(tdef.id, c.x[ts], c.y[ts], c.z[ts], c.dir[ts]);
  return (
    e.x === c.x[hs] &&
    e.y === c.y[hs] &&
    e.z === c.z[hs] &&
    e.dir === c.dir[hs] &&
    tdef.exitSlope === hdef.entrySlope &&
    tdef.exitBank === hdef.entryBank
  );
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
  c.prev[slot] = -1;
  c.next[slot] = -1;
  const r = req.rideId;
  if (attach === 'first') {
    t.head[r] = id;
    t.tail[r] = id;
  } else if (attach === 'tail') {
    const ts = t.pieces.idToSlot[t.tail[r]];
    c.next[ts] = id;
    c.prev[slot] = t.tail[r];
    t.tail[r] = id;
  } else {
    const hs = t.pieces.idToSlot[t.head[r]];
    c.prev[hs] = id;
    c.next[slot] = t.head[r];
    t.head[r] = id;
  }
  if (t.head[r] !== t.tail[r] && closesCircuit(world, r)) {
    c.next[t.pieces.idToSlot[t.tail[r]]] = t.head[r];
    c.prev[t.pieces.idToSlot[t.head[r]]] = t.tail[r];
    t.closed[r] = 1;
  }
  relink(world, r);
  t.lastPiece = id;
  return TrackResult.Ok;
}

/**
 * Removes a piece of the ride. `pieceId` -1 means the last-placed end. Open chains can only lose
 * an end piece; any piece of a closed circuit can go, which reopens it.
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
  const c = t.pieces.cols;
  const slot = t.pieces.idToSlot[id];
  if (c.rideId[slot] !== rideId) return TrackResult.NoSuchPiece;
  const closed = t.closed[rideId] === 1;
  const isHead = id === t.head[rideId];
  const isTail = id === t.tail[rideId];
  if (!closed && !isHead && !isTail) return TrackResult.NotAtEnd;

  if (t.count[rideId] === 1) {
    t.pieces.despawnSlot(slot);
    t.head[rideId] = -1;
    t.tail[rideId] = -1;
    relink(world, rideId);
    return TrackResult.Ok;
  }
  const prevId = c.prev[slot];
  const nextId = c.next[slot];
  if (closed) {
    t.head[rideId] = nextId;
    t.tail[rideId] = prevId;
    t.closed[rideId] = 0;
    c.next[t.pieces.idToSlot[prevId]] = -1;
    c.prev[t.pieces.idToSlot[nextId]] = -1;
  } else if (isTail) {
    t.tail[rideId] = prevId;
    c.next[t.pieces.idToSlot[prevId]] = -1;
  } else {
    t.head[rideId] = nextId;
    c.prev[t.pieces.idToSlot[nextId]] = -1;
  }
  t.pieces.despawnSlot(slot);
  relink(world, rideId);
  return TrackResult.Ok;
}

/** Deletes every piece of a ride (called when the ride itself is demolished). */
export function removeRideTrack(world: World, rideId: number): void {
  const t = world.track;
  if (rideId < 0 || rideId >= MAX_TRACK_RIDES) return;
  if (t.closed[rideId] === 1) {
    t.pieces.cols.prev[t.pieces.idToSlot[t.head[rideId]]] = -1;
    t.closed[rideId] = 0;
  }
  while (t.tail[rideId] >= 0) {
    const slot = t.pieces.idToSlot[t.tail[rideId]];
    const prev = t.pieces.cols.prev[slot];
    t.pieces.despawnSlot(slot);
    if (prev >= 0 && prev !== t.tail[rideId]) {
      t.pieces.cols.next[t.pieces.idToSlot[prev]] = -1;
      t.tail[rideId] = prev;
    } else {
      t.head[rideId] = -1;
      t.tail[rideId] = -1;
    }
  }
  relink(world, rideId);
}

export function circuitStatus(world: World, rideId: number): CircuitStatus {
  const t = world.track;
  const none = { pieces: 0, closed: false, stations: 0, complete: false, length: 0 };
  if (rideId < 0 || rideId >= MAX_TRACK_RIDES || t.head[rideId] < 0) return none;
  const c = t.pieces.cols;
  let stations = 0;
  let id = t.head[rideId];
  do {
    const slot = t.pieces.idToSlot[id];
    if (PIECES[c.pieceType[slot]].flags & PieceFlag.Station) stations++;
    id = c.next[slot];
  } while (id >= 0 && id !== t.head[rideId]);
  const closed = t.closed[rideId] === 1;
  return {
    pieces: t.count[rideId],
    closed,
    stations,
    complete: closed && stations > 0,
    length: t.length[rideId],
  };
}

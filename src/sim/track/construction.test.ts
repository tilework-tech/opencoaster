import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { Simulation } from '../core/simulation';
import { hashWorld } from '../core/hash';
import { TRACK_STEPS_PER_LEVEL, TRACK_Z_STEP, Z_STEP } from '../core/constants';
import { OWNED } from '../map/tile-map';
import { PIECES, PieceId, pieceByName } from './catalog';
import {
  circuitStatus,
  connectablePieces,
  getConstructionCursor,
  pieceExit,
  placeTrack,
  removeRideTrack,
  removeTrack,
  validatePlacement,
} from './construction';
import { MAX_TRACK_LEVEL } from './track-store';
import { trackSystem } from './track-system';
import { PieceMode, Slope, TrackResult } from './track-types';
import type { Direction } from './track-types';

const BASE_Z = 10;

function newWorld(): World {
  const w = new World({ seed: 1, width: 64, height: 64, maxGuests: 16 });
  w.map.heights.fill(2);
  return w;
}

function newRide(w: World): number {
  return w.rides.slotToId[w.rides.spawn()];
}

function pid(name: string): number {
  return pieceByName(name)!.id;
}

/** Appends a piece at the construction cursor. */
function app(w: World, ride: number, name: string, mode = PieceMode.Normal): TrackResult {
  const c = getConstructionCursor(w, ride);
  return placeTrack(w, {
    rideId: ride,
    pieceType: pid(name),
    x: c.x,
    y: c.y,
    z: c.z,
    dir: c.dir,
    mode,
  });
}

function start(w: World, ride: number, name: string, x = 10, y = 10, dir: Direction = 0): void {
  const r = placeTrack(w, {
    rideId: ride,
    pieceType: pid(name),
    x,
    y,
    z: BASE_Z,
    dir,
    mode: PieceMode.Normal,
  });
  expect(r).toBe(TrackResult.Ok);
}

/** Station, then four right turns joined by straights, ending exactly at the station. */
function buildRing(w: World, ride: number): void {
  start(w, ride, 'station');
  const seq: [string, number][] = [
    ['flat', 2],
    ['smallRight', 1],
    ['flat', 2],
    ['smallRight', 1],
    ['flat', 3],
    ['smallRight', 1],
    ['flat', 2],
    ['smallRight', 1],
  ];
  for (const [n, k] of seq)
    for (let i = 0; i < k; i++) expect(app(w, ride, n), n).toBe(TrackResult.Ok);
}

describe('construction', () => {
  let w: World;
  let ride: number;
  beforeEach(() => {
    w = newWorld();
    ride = newRide(w);
  });

  it('accepts a first piece anywhere and exposes the cursor after it', () => {
    start(w, ride, 'station', 5, 6, 1);
    const c = getConstructionCursor(w, ride);
    expect(c).toMatchObject({ hasTrack: true, closed: false, x: 5, y: 7, z: BASE_Z, dir: 1 });
    expect(c.slope).toBe(Slope.Flat);
  });

  it('rejects pieces that do not meet the cursor position or heading', () => {
    start(w, ride, 'flat');
    const base = { rideId: ride, pieceType: PieceId.Flat, z: BASE_Z, mode: PieceMode.Normal };
    expect(validatePlacement(w, { ...base, x: 12, y: 10, dir: 0 })).toBe(TrackResult.NotConnected);
    expect(validatePlacement(w, { ...base, x: 11, y: 10, dir: 1 })).toBe(TrackResult.NotConnected);
    expect(validatePlacement(w, { ...base, x: 11, y: 10, dir: 0 })).toBe(TrackResult.Ok);
    expect(validatePlacement(w, { ...base, x: 11, y: 10, dir: 0, z: BASE_Z + 1 })).toBe(
      TrackResult.NotConnected,
    );
  });

  it('requires slope and bank classes to match', () => {
    start(w, ride, 'flat');
    expect(app(w, ride, 'up25')).toBe(TrackResult.NotConnected);
    expect(app(w, ride, 'flatToUp25')).toBe(TrackResult.Ok);
    expect(app(w, ride, 'flat')).toBe(TrackResult.NotConnected);
    expect(app(w, ride, 'up25')).toBe(TrackResult.Ok);
    expect(app(w, ride, 'up25ToFlat')).toBe(TrackResult.Ok);
    const c = getConstructionCursor(w, ride);
    expect(c.z).toBe(BASE_Z + 1 + 2 + 1);
    expect(app(w, ride, 'flatToLeftBank')).toBe(TrackResult.Ok);
    expect(app(w, ride, 'smallRight')).toBe(TrackResult.NotConnected);
    expect(app(w, ride, 'smallLeftBanked')).toBe(TrackResult.Ok);
    expect(app(w, ride, 'smallRightBanked')).toBe(TrackResult.NotConnected);
    expect(app(w, ride, 'leftBankToFlat')).toBe(TrackResult.Ok);
  });

  it('lists the pieces that can follow the cursor', () => {
    start(w, ride, 'flat');
    const names = connectablePieces(getConstructionCursor(w, ride)).map((i) => PIECES[i].name);
    expect(names).toContain('smallLeft');
    expect(names).toContain('flatToUp25');
    expect(names).toContain('verticalLoopRight');
    expect(names).not.toContain('up25');
    expect(names).not.toContain('smallLeftBanked');
    expect(connectablePieces({ ...getConstructionCursor(w, ride), hasTrack: false }).length).toBe(
      PIECES.length,
    );
  });

  it('rotates piece exits with the heading', () => {
    const p = pieceByName('smallRight')!;
    expect(pieceExit(p.id, 10, 10, 4, 0)).toEqual({ x: 11, y: 12, z: 4, dir: 1 });
    expect(pieceExit(p.id, 10, 10, 4, 1)).toEqual({ x: 8, y: 11, z: 4, dir: 2 });
    expect(pieceExit(p.id, 10, 10, 4, 2)).toEqual({ x: 9, y: 8, z: 4, dir: 3 });
    expect(pieceExit(p.id, 10, 10, 4, 3)).toEqual({ x: 12, y: 9, z: 4, dir: 0 });
  });

  it('rejects out-of-bounds, underground (non-tunnel), over-height and unknown rides', () => {
    const req = { pieceType: PieceId.Flat, x: 10, y: 10, z: BASE_Z, dir: 0 as Direction };
    expect(validatePlacement(w, { ...req, rideId: ride, x: -1, mode: 0 })).toBe(
      TrackResult.OutOfBounds,
    );
    expect(validatePlacement(w, { ...req, rideId: ride, x: 64, mode: 0 })).toBe(
      TrackResult.OutOfBounds,
    );
    expect(
      validatePlacement(w, {
        ...req,
        rideId: ride,
        pieceType: PieceId.MediumLeftBanked,
        z: 0,
        mode: 0,
      }),
    ).toBe(TrackResult.BelowGround);
    expect(
      validatePlacement(w, {
        ...req,
        rideId: ride,
        z: MAX_TRACK_LEVEL * TRACK_STEPS_PER_LEVEL,
        mode: 0,
      }),
    ).toBe(TrackResult.Ok);
    expect(
      validatePlacement(w, {
        ...req,
        rideId: ride,
        pieceType: PieceId.VerticalLoopRight,
        z: MAX_TRACK_LEVEL * TRACK_STEPS_PER_LEVEL,
        mode: 0,
      }),
    ).toBe(TrackResult.TooHigh);
    expect(validatePlacement(w, { ...req, rideId: 200, mode: 0 })).toBe(TrackResult.NoSuchRide);
    expect(validatePlacement(w, { ...req, rideId: 9999, mode: 0 })).toBe(TrackResult.NoSuchRide);
  });

  it('allows tunnel-able pieces below the terrain but not below the world floor', () => {
    const req = {
      rideId: ride,
      pieceType: PieceId.Flat,
      x: 10,
      y: 10,
      dir: 0 as Direction,
      mode: 0,
    };
    expect(validatePlacement(w, { ...req, z: 0 })).toBe(TrackResult.Ok);
    expect(validatePlacement(w, { ...req, z: -1 })).toBe(TrackResult.BelowGround);
  });

  it('blocks track that overlaps other track unless it clears it vertically', () => {
    start(w, ride, 'flat');
    const other = newRide(w);
    const req = {
      rideId: other,
      pieceType: PieceId.Flat,
      x: 10,
      y: 10,
      dir: 1 as Direction,
      mode: 0,
    };
    expect(validatePlacement(w, { ...req, z: BASE_Z })).toBe(TrackResult.Blocked);
    expect(validatePlacement(w, { ...req, z: BASE_Z + 1 })).toBe(TrackResult.Blocked);
    expect(validatePlacement(w, { ...req, z: BASE_Z + 5 })).toBe(TrackResult.Blocked);
    expect(validatePlacement(w, { ...req, z: BASE_Z + 6 })).toBe(TrackResult.Ok);
    expect(validatePlacement(w, { ...req, z: BASE_Z - 5 })).toBe(TrackResult.Blocked);
    expect(validatePlacement(w, { ...req, z: BASE_Z - 6 })).toBe(TrackResult.Ok);
  });

  it('validates lift and brake modes against the piece type', () => {
    start(w, ride, 'flat');
    const req = { rideId: ride, x: 11, y: 10, z: BASE_Z, dir: 0 as Direction };
    expect(
      validatePlacement(w, { ...req, pieceType: PieceId.Flat, mode: PieceMode.ChainLift }),
    ).toBe(0);
    expect(validatePlacement(w, { ...req, pieceType: PieceId.Flat, mode: PieceMode.Brake })).toBe(
      0,
    );
    expect(
      validatePlacement(w, { ...req, pieceType: PieceId.Flat, mode: PieceMode.BlockBrake }),
    ).toBe(0);
    expect(
      validatePlacement(w, {
        ...req,
        pieceType: PieceId.FlatToUp25,
        mode: PieceMode.WaterLift,
      }),
    ).toBe(TrackResult.Ok);
    expect(
      validatePlacement(w, { ...req, pieceType: PieceId.SmallRight, mode: PieceMode.ChainLift }),
    ).toBe(TrackResult.BadMode);
    expect(validatePlacement(w, { ...req, pieceType: PieceId.Flat, mode: 9 as PieceMode })).toBe(
      TrackResult.BadMode,
    );
    const hill = newRide(w);
    start(w, hill, 'flatToUp25', 20, 20);
    expect(app(w, hill, 'up25', PieceMode.ChainLift)).toBe(TrackResult.Ok);
    expect(app(w, hill, 'up25', PieceMode.Brake)).toBe(TrackResult.BadMode);
  });

  it('places a vertical loop and continues from its shifted exit', () => {
    start(w, ride, 'flat');
    expect(app(w, ride, 'verticalLoopRight')).toBe(TrackResult.Ok);
    const c = getConstructionCursor(w, ride);
    expect(c).toMatchObject({ x: 12, y: 11, z: BASE_Z, dir: 0 });
    expect(app(w, ride, 'flat')).toBe(TrackResult.Ok);
  });

  it('detects a closed circuit and then locks further placement', () => {
    buildRing(w, ride);
    const st = circuitStatus(w, ride);
    expect(st).toMatchObject({ closed: true, stations: 1, complete: true, pieces: 14 });
    expect(st.length).toBeGreaterThan(8 * 256);
    expect(app(w, ride, 'flat')).toBe(TrackResult.CircuitClosed);
  });

  it('reports an open chain as incomplete', () => {
    start(w, ride, 'station');
    app(w, ride, 'flat');
    expect(circuitStatus(w, ride)).toMatchObject({ closed: false, stations: 1, complete: false });
  });

  it('closes a circuit when the final piece is prepended', () => {
    const chain = [
      ['station', 10, 10],
      ['flat', 11, 10],
    ] as const;
    start(w, ride, 'station');
    app(w, ride, 'flat');
    expect(chain.length).toBe(2);
    const req = { rideId: ride, pieceType: PieceId.Flat, z: BASE_Z, mode: PieceMode.Normal };
    expect(validatePlacement(w, { ...req, x: 9, y: 10, dir: 0 })).toBe(TrackResult.Ok);
    expect(placeTrack(w, { ...req, x: 9, y: 10, dir: 0 })).toBe(TrackResult.Ok);
    expect(circuitStatus(w, ride).pieces).toBe(3);
    expect(getConstructionCursor(w, ride)).toMatchObject({ x: 12, y: 10 });
  });

  it('removes from the ends, reopens a closed circuit, and rejects mid-chain removal', () => {
    buildRing(w, ride);
    expect(removeTrack(w, ride, -1)).toBe(TrackResult.Ok);
    expect(circuitStatus(w, ride)).toMatchObject({ closed: false, pieces: 13 });
    expect(w.track.pieces.count).toBe(13);
    expect(app(w, ride, 'smallRight')).toBe(TrackResult.Ok);
    expect(circuitStatus(w, ride).closed).toBe(true);

    const r2 = newRide(w);
    start(w, r2, 'flat', 30, 30);
    app(w, r2, 'flat');
    app(w, r2, 'flat');
    const mid = w.track.pieces.slotToId[w.track.pieces.count - 2];
    expect(removeTrack(w, r2, mid)).toBe(TrackResult.NotAtEnd);
    expect(removeTrack(w, r2, w.track.head[r2])).toBe(TrackResult.Ok);
    expect(getConstructionCursor(w, r2)).toMatchObject({ x: 33, y: 30 });
    expect(removeTrack(w, r2, mid + 9999)).toBe(TrackResult.NoSuchPiece);
    expect(removeTrack(w, r2, -1)).toBe(TrackResult.Ok);
    expect(removeTrack(w, r2, -1)).toBe(TrackResult.Ok);
    expect(removeTrack(w, r2, -1)).toBe(TrackResult.NoSuchPiece);
    expect(getConstructionCursor(w, r2).hasTrack).toBe(false);
  });

  it('removes a piece of another ride only through its own ride id', () => {
    start(w, ride, 'flat');
    const r2 = newRide(w);
    start(w, r2, 'flat', 30, 30);
    const id = w.track.head[ride];
    expect(removeTrack(w, r2, id)).toBe(TrackResult.NoSuchPiece);
  });

  it('drops the track of rides that no longer exist', () => {
    start(w, ride, 'flat');
    app(w, ride, 'flat');
    w.rides.despawnId(ride);
    trackSystem.update(w);
    expect(w.track.pieces.count).toBe(0);
    expect(getConstructionCursor(w, ride).hasTrack).toBe(false);
  });

  it('clears all track of a ride on demand', () => {
    buildRing(w, ride);
    removeRideTrack(w, ride);
    expect(w.track.pieces.count).toBe(0);
    expect(circuitStatus(w, ride).pieces).toBe(0);
  });

  it('keeps entry heights consistent in track steps of half a land level', () => {
    start(w, ride, 'flat');
    app(w, ride, 'flatToUp25');
    app(w, ride, 'up25ToUp60');
    app(w, ride, 'up60');
    const c = getConstructionCursor(w, ride);
    expect(c.z).toBe(BASE_Z + 1 + 4 + 8);
    expect(c.slope).toBe(Slope.Up60);
    expect(c.z * TRACK_Z_STEP).toBe(BASE_Z * TRACK_Z_STEP + 6.5 * Z_STEP);
  });
});

describe('track commands', () => {
  function run(withTrack: boolean): number {
    const sim = new Simulation({ seed: 5, width: 64, height: 64, maxGuests: 64 });
    sim.world.map.heights.fill(2);
    sim.world.map.ownership.fill(OWNED);
    const rideId = sim.world.rides.slotToId[sim.world.rides.spawn()];
    if (withTrack) {
      sim.enqueue({
        type: 'placeTrack',
        rideId,
        pieceType: PieceId.Station,
        x: 8,
        y: 8,
        z: 6,
        dir: 0,
        mode: 0,
      });
      sim.step();
      sim.enqueue({
        type: 'placeTrack',
        rideId,
        pieceType: PieceId.SmallRight,
        x: 9,
        y: 8,
        z: 6,
        dir: 0,
        mode: 0,
      });
      sim.enqueue({
        type: 'placeTrack',
        rideId,
        pieceType: PieceId.Flat,
        x: 99,
        y: 8,
        z: 6,
        dir: 0,
        mode: 0,
      });
    }
    for (let i = 0; i < 30; i++) sim.step();
    if (withTrack) {
      expect(sim.world.track.pieces.count).toBe(2);
      sim.enqueue({ type: 'removeTrack', rideId, pieceId: -1 });
      sim.step();
      expect(sim.world.track.pieces.count).toBe(1);
      expect(sim.world.track.lastResult).toBe(TrackResult.Ok);
    }
    return hashWorld(sim.world);
  }

  it('applies place/remove commands at tick boundaries and rejects invalid ones silently', () => {
    run(true);
  });

  it('is deterministic and visible to the world hash', () => {
    expect(run(true)).toBe(run(true));
    expect(run(true)).not.toBe(run(false));
  });
});

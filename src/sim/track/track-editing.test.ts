import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { hashWorld } from '../core/hash';
import { deserialize, serialize } from '../../save/save';
import { pieceByName } from './catalog';
import {
  circuitStatus,
  getConstructionCursor,
  placeTrack,
  removeRideTrack,
  removeTrack,
  validatePlacement,
} from './construction';
import type { PlaceRequest } from './construction';
import { PieceMode, TrackResult } from './track-types';
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

/** Every placed piece: the request that built it and the id it was given. */
interface Built {
  id: number;
  req: PlaceRequest;
}

function place(w: World, req: PlaceRequest): Built {
  expect(placeTrack(w, req)).toBe(TrackResult.Ok);
  return { id: w.track.lastPiece, req };
}

/** Appends at the construction cursor (or starts the track at 10,10 heading +x). */
function append(w: World, ride: number, name: string): Built {
  const c = getConstructionCursor(w, ride);
  return place(w, {
    rideId: ride,
    pieceType: pieceByName(name)!.id,
    x: c.hasTrack ? c.x : 10,
    y: c.hasTrack ? c.y : 10,
    z: c.hasTrack ? c.z : BASE_Z,
    dir: (c.hasTrack ? c.dir : 0) as Direction,
    mode: PieceMode.Normal,
  });
}

function chain(w: World, ride: number, names: readonly string[]): Built[] {
  return names.map((name) => append(w, ride, name));
}

const RING = [
  'station',
  'flat',
  'flat',
  'smallRight',
  'flat',
  'flat',
  'smallRight',
  'flat',
  'flat',
  'flat',
  'smallRight',
  'flat',
  'flat',
  'smallRight',
];

describe('editing track from a chosen piece', () => {
  let w: World;
  let ride: number;
  beforeEach(() => {
    w = newWorld();
    ride = newRide(w);
  });

  it('removes a middle piece of an unfinished track and keeps every piece after it', () => {
    const built = chain(w, ride, ['station', 'flat', 'flat', 'flat', 'flat']);
    const end = getConstructionCursor(w, ride);

    expect(removeTrack(w, ride, built[2].id)).toBe(TrackResult.Ok);

    expect(circuitStatus(w, ride).pieces).toBe(4);
    for (const piece of [built[0], built[1], built[3], built[4]])
      expect(w.track.pieces.isAlive(piece.id)).toBe(true);
    place(w, built[2].req);
    expect(circuitStatus(w, ride).pieces).toBe(5);
    expect(getConstructionCursor(w, ride)).toMatchObject({ x: end.x, y: end.y, dir: end.dir });
  });

  it('reopens a closed circuit at a removed middle piece and closes it again when rebuilt', () => {
    const built = chain(w, ride, RING);
    expect(circuitStatus(w, ride).complete).toBe(true);

    expect(removeTrack(w, ride, built[6].id)).toBe(TrackResult.Ok);
    expect(circuitStatus(w, ride)).toMatchObject({ closed: false, complete: false, pieces: 13 });
    expect(getConstructionCursor(w, ride)).toMatchObject({
      x: built[6].req.x,
      y: built[6].req.y,
      dir: built[6].req.dir,
    });

    place(w, built[6].req);
    expect(circuitStatus(w, ride)).toMatchObject({ closed: true, complete: true, pieces: 14 });
  });

  it('accepts a different shape in a gap but closes the circuit only where it meets the far side', () => {
    const built = chain(w, ride, RING);
    removeTrack(w, ride, built[9].id);
    removeTrack(w, ride, built[4].id);
    removeTrack(w, ride, built[5].id);
    const rise = place(w, { ...built[4].req, pieceType: pieceByName('flatToUp25')!.id });
    const level = place(w, {
      ...built[5].req,
      pieceType: pieceByName('up25ToFlat')!.id,
      z: getConstructionCursor(w, ride).z,
    });
    place(w, built[9].req);
    expect(circuitStatus(w, ride)).toMatchObject({ closed: false, pieces: 14 });

    removeTrack(w, ride, level.id);
    removeTrack(w, ride, rise.id);
    place(w, built[4].req);
    expect(circuitStatus(w, ride).closed).toBe(false);
    place(w, built[5].req);
    expect(circuitStatus(w, ride)).toMatchObject({ closed: true, complete: true, pieces: 14 });
  });

  it('joins separate sections when the gaps between them are filled in any order', () => {
    const built = chain(w, ride, ['station', 'flat', 'flat', 'flat', 'flat', 'flat', 'flat']);
    const end = getConstructionCursor(w, ride);
    removeTrack(w, ride, built[2].id);
    removeTrack(w, ride, built[5].id);
    expect(circuitStatus(w, ride).pieces).toBe(5);

    place(w, built[2].req);
    place(w, built[5].req);

    expect(circuitStatus(w, ride).pieces).toBe(7);
    expect(getConstructionCursor(w, ride)).toMatchObject({ x: end.x, y: end.y });
    expect(removeTrack(w, ride, -1)).toBe(TrackResult.Ok);
    expect(w.track.pieces.isAlive(built[6].id)).toBe(false);
  });

  it('builds backward onto the start of the section after a gap', () => {
    const built = chain(w, ride, ['station', 'flat', 'flat', 'flat', 'flat', 'flat']);
    removeTrack(w, ride, built[2].id);
    removeTrack(w, ride, built[3].id);

    place(w, built[3].req);
    expect(circuitStatus(w, ride).pieces).toBe(5);
    place(w, built[2].req);
    expect(circuitStatus(w, ride).pieces).toBe(6);
    expect(removeTrack(w, ride, built[4].id)).toBe(TrackResult.Ok);
    expect(validatePlacement(w, built[4].req)).toBe(TrackResult.Ok);
  });

  it('only accepts new pieces that meet an open end', () => {
    const built = chain(w, ride, ['station', 'flat', 'flat', 'flat']);
    removeTrack(w, ride, built[1].id);
    expect(validatePlacement(w, { ...built[1].req, y: 30 })).toBe(TrackResult.NotConnected);
    expect(validatePlacement(w, { ...built[1].req, dir: 1 })).toBe(TrackResult.NotConnected);
    expect(validatePlacement(w, built[1].req)).toBe(TrackResult.Ok);
  });

  it('keeps demolishing backward from the gap with the default end removal', () => {
    const built = chain(w, ride, ['station', 'flat', 'flat', 'flat', 'flat']);
    removeTrack(w, ride, built[3].id);
    expect(removeTrack(w, ride, -1)).toBe(TrackResult.Ok);
    expect(w.track.pieces.isAlive(built[2].id)).toBe(false);
    expect(w.track.pieces.isAlive(built[4].id)).toBe(true);
    expect(getConstructionCursor(w, ride)).toMatchObject({ x: built[2].req.x, y: built[2].req.y });
  });

  it('removes the first and the last piece of a section', () => {
    const built = chain(w, ride, ['station', 'flat', 'flat', 'flat', 'flat']);
    removeTrack(w, ride, built[2].id);
    expect(removeTrack(w, ride, built[3].id)).toBe(TrackResult.Ok);
    expect(removeTrack(w, ride, built[4].id)).toBe(TrackResult.Ok);
    expect(removeTrack(w, ride, built[0].id)).toBe(TrackResult.Ok);
    expect(circuitStatus(w, ride).pieces).toBe(1);
    expect(removeTrack(w, ride, built[1].id)).toBe(TrackResult.Ok);
    expect(circuitStatus(w, ride).pieces).toBe(0);
    expect(getConstructionCursor(w, ride).hasTrack).toBe(false);
  });

  it('refuses a piece that was already removed', () => {
    const built = chain(w, ride, ['station', 'flat', 'flat']);
    removeTrack(w, ride, built[1].id);
    expect(removeTrack(w, ride, built[1].id)).toBe(TrackResult.NoSuchPiece);
    expect(circuitStatus(w, ride).pieces).toBe(2);
  });

  it('counts the stations of every section', () => {
    const built = chain(w, ride, ['flat', 'flat', 'station']);
    expect(removeTrack(w, ride, built[1].id)).toBe(TrackResult.Ok);
    expect(circuitStatus(w, ride)).toMatchObject({ pieces: 2, stations: 1 });
  });

  it('clears every section when the ride is demolished', () => {
    const built = chain(w, ride, ['station', 'flat', 'flat', 'flat', 'flat']);
    expect(removeTrack(w, ride, built[1].id)).toBe(TrackResult.Ok);
    expect(removeTrack(w, ride, built[3].id)).toBe(TrackResult.Ok);
    removeRideTrack(w, ride);
    expect(w.track.pieces.count).toBe(0);
    expect(circuitStatus(w, ride).pieces).toBe(0);
  });

  it('saves and restores a track split into sections', () => {
    const built = chain(w, ride, RING);
    removeTrack(w, ride, built[3].id);
    removeTrack(w, ride, built[9].id);
    const copy = deserialize(serialize(w));
    expect(hashWorld(copy)).toBe(hashWorld(w));
    expect(placeTrack(copy, built[3].req)).toBe(TrackResult.Ok);
    expect(placeTrack(copy, built[9].req)).toBe(TrackResult.Ok);
    expect(circuitStatus(copy, ride).complete).toBe(true);
  });
});

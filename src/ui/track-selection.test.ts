import { describe, expect, it } from 'vitest';
import { World } from '../sim/core/world';
import { pieceByName } from '../sim/track/catalog';
import {
  getConstructionCursor,
  placeTrack,
  removeTrack,
  validatePlacement,
} from '../sim/track/construction';
import type { PlaceRequest } from '../sim/track/construction';
import { Bank, PieceMode, Slope, TrackResult } from '../sim/track/track-types';
import type { Direction } from '../sim/track/track-types';
import { RideType } from '../sim/rides/ride-types';
import { createSnapshot, writeSnapshot } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import {
  buildPointAt,
  neighbourPiece,
  openEnds,
  resolveBuild,
  sectionPosition,
  snapshotPiece,
} from './track-selection';

function world(): { w: World; ride: number } {
  const w = new World({ seed: 1, width: 64, height: 64, maxGuests: 16 });
  w.map.heights.fill(2);
  return { w, ride: w.rides.slotToId[w.rides.spawn()] };
}

const placedIds = new Map<World, number[]>();

/** Ids of the pieces `chain` placed in this world, in build order. */
function ids(w: World): number[] {
  return placedIds.get(w) ?? [];
}

function chain(w: World, ride: number, names: readonly string[]): PlaceRequest[] {
  const out: PlaceRequest[] = [];
  if (!placedIds.has(w)) placedIds.set(w, []);
  for (const name of names) {
    const c = getConstructionCursor(w, ride);
    const req: PlaceRequest = {
      rideId: ride,
      pieceType: pieceByName(name)!.id,
      x: c.hasTrack ? c.x : 10,
      y: c.hasTrack ? c.y : 10,
      z: c.hasTrack ? c.z : 10,
      dir: (c.hasTrack ? c.dir : 0) as Direction,
      mode: PieceMode.Normal,
    };
    expect(placeTrack(w, req)).toBe(TrackResult.Ok);
    placedIds.get(w)!.push(w.track.lastPiece);
    out.push(req);
  }
  return out;
}

function snap(w: World): Snapshot {
  const snapshot = createSnapshot({ guests: 16, staff: 0, vehicles: 0, litter: 0 });
  writeSnapshot(w, snapshot);
  return snapshot;
}

describe('construction from a selected piece', () => {
  it('describes a published piece by its id with its position and neighbours', () => {
    const { w, ride } = world();
    const reqs = chain(w, ride, ['station', 'smallRight', 'flat']);
    const [first, turn, last] = ids(w);
    const piece = snapshotPiece(snap(w), turn);
    expect(piece).toMatchObject({
      id: turn,
      rideId: ride,
      pieceType: reqs[1].pieceType,
      x: reqs[1].x,
      y: reqs[1].y,
      z: reqs[1].z,
      dir: reqs[1].dir,
      prev: first,
      next: last,
    });
    expect(snapshotPiece(snap(w), 9999)).toBeNull();
  });

  it('steps to the previous and next piece, stopping at the ends of unfinished track', () => {
    const { w, ride } = world();
    chain(w, ride, ['station', 'flat', 'flat']);
    const [a, b, c] = ids(w);
    const s = snap(w);
    expect(neighbourPiece(s, b, 'previous')).toBe(a);
    expect(neighbourPiece(s, b, 'next')).toBe(c);
    expect(neighbourPiece(s, a, 'previous')).toBe(-1);
    expect(neighbourPiece(s, c, 'next')).toBe(-1);
    expect(sectionPosition(s, b)).toEqual({ index: 1, count: 3, ring: false });
  });

  it('wraps around a closed circuit', () => {
    const { w, ride } = world();
    chain(w, ride, [
      'station',
      'flat',
      'smallRight',
      'flat',
      'smallRight',
      'flat',
      'flat',
      'smallRight',
      'flat',
      'smallRight',
    ]);
    const order = ids(w);
    const s = snap(w);
    expect(neighbourPiece(s, order[0], 'previous')).toBe(order[order.length - 1]);
    expect(neighbourPiece(s, order[order.length - 1], 'next')).toBe(order[0]);
    expect(sectionPosition(s, order[3])).toEqual({ index: 3, count: order.length, ring: true });
    expect(openEnds(snapshotPiece(s, order[3])!)).toEqual([]);
  });

  it('offers the open ends of the pieces either side of a gap', () => {
    const { w, ride } = world();
    chain(w, ride, ['station', 'flat', 'flat', 'flat', 'flat']);
    const [, before, gap, after, last] = ids(w);
    removeTrack(w, ride, gap);
    const s = snap(w);
    expect(openEnds(snapshotPiece(s, before)!)).toEqual(['after']);
    expect(openEnds(snapshotPiece(s, after)!)).toEqual(['before']);
    expect(openEnds(snapshotPiece(s, last)!)).toEqual(['after']);
    expect(sectionPosition(s, after)).toEqual({ index: 0, count: 2, ring: false });
  });

  it.each(['flat', 'smallRight', 'smallLeft', 'flatToUp25', 'down25ToFlat', 'mediumRight'])(
    'resolves the piece the sim accepts when building a %s back onto the start of a section',
    (name) => {
      const { w, ride } = world();
      const before = name === 'down25ToFlat' ? ['flatToDown25', 'down25'] : [];
      const after = name === 'flatToUp25' ? ['up25ToFlat', 'flat'] : ['flat', 'flat'];
      const reqs = chain(w, ride, ['station', 'flat', ...before, name, ...after]);
      const order = ids(w);
      const target = 2 + before.length;
      removeTrack(w, ride, order[target]);
      removeTrack(w, ride, order[target - 1]);
      const def = pieceByName(name)!;
      const s = snap(w);
      const head = snapshotPiece(s, order[target + 1])!;
      const build = resolveBuild(
        buildPointAt(head, 'before'),
        { turn: def.shape, slope: def.entrySlope, bank: def.entryBank },
        RideType.WoodenCoaster,
      );
      expect(build?.piece.id).toBe(def.id);
      const req: PlaceRequest = {
        ...reqs[target],
        ...build!.placement,
        dir: build!.placement.dir as Direction,
        pieceType: build!.piece.id,
      };
      expect(req).toEqual(reqs[target]);
      expect(validatePlacement(w, req)).toBe(TrackResult.Ok);
    },
  );

  it('resolves the next piece forward from the end of a section', () => {
    const { w, ride } = world();
    const reqs = chain(w, ride, ['station', 'flat', 'smallRight', 'flat']);
    const order = ids(w);
    removeTrack(w, ride, order[2]);
    const build = resolveBuild(
      buildPointAt(snapshotPiece(snap(w), order[1])!, 'after'),
      { turn: 'smallRight', slope: Slope.Flat, bank: Bank.None },
      RideType.WoodenCoaster,
    );
    expect({ ...reqs[2], ...build!.placement, pieceType: build!.piece.id }).toEqual(reqs[2]);
  });
});

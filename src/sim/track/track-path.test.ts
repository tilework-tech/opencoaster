import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { TRACK_Z_STEP } from '../core/constants';
import { BANK_DEG, PIECES, PieceId, TANGENT_ONE } from './catalog';
import { getConstructionCursor, placeTrack, removeTrack } from './construction';
import { getTrackPath } from './track-path';
import { PieceMode, TrackResult } from './track-types';
import type { Direction } from './track-types';
import type { TrackPath } from './track-path';

function setup(): { w: World; ride: number } {
  const w = new World({ seed: 1, width: 64, height: 64, maxGuests: 16 });
  w.map.heights.fill(2);
  return { w, ride: w.rides.slotToId[w.rides.spawn()] };
}

function put(
  w: World,
  ride: number,
  id: number,
  mode = PieceMode.Normal,
  at?: [number, number, number, Direction],
): void {
  const c = getConstructionCursor(w, ride);
  const [x, y, z, dir] = at ?? [c.x, c.y, c.z, c.dir];
  expect(placeTrack(w, { rideId: ride, pieceType: id, x, y, z, dir, mode })).toBe(TrackResult.Ok);
}

function expectContinuous(p: TrackPath): void {
  for (let i = 1; i < p.count; i++) {
    const d = Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1], p.z[i] - p.z[i - 1]);
    expect(d, `gap at ${i}`).toBeLessThanOrEqual(48);
    expect(d).toBeGreaterThan(0);
    expect(p.s[i]).toBeGreaterThan(p.s[i - 1]);
    const dot =
      (p.tx[i] * p.tx[i - 1] + p.ty[i] * p.ty[i - 1] + p.tz[i] * p.tz[i - 1]) /
      (TANGENT_ONE * TANGENT_ONE);
    expect(dot, `kink at ${i}`).toBeGreaterThan(0.9);
    // Tangent agrees with the direction of travel except where the loop turns it backward.
    const fx = p.x[i] - p.x[i - 1];
    const fy = p.y[i] - p.y[i - 1];
    const fz = p.z[i] - p.z[i - 1];
    const along = (fx * p.tx[i] + fy * p.ty[i] + fz * p.tz[i]) / (d * TANGENT_ONE);
    expect(along, `heading at ${i}`).toBeGreaterThan(0.85);
  }
}

describe('track path', () => {
  it('returns null for rides without track', () => {
    const { w, ride } = setup();
    expect(getTrackPath(w, ride)).toBeNull();
  });

  it('places a rotated station on the right world coordinates', () => {
    const { w, ride } = setup();
    put(w, ride, PieceId.Station, PieceMode.Normal, [5, 5, 4, 1]);
    const p = getTrackPath(w, ride)!;
    expect(p.closed).toBe(false);
    expect(p.x[0]).toBe(5 * 256 + 128);
    expect(p.y[0]).toBe(5 * 256);
    expect(p.z[0]).toBe(4 * TRACK_Z_STEP);
    expect(p.x[p.count - 1]).toBe(5 * 256 + 128);
    expect(p.y[p.count - 1]).toBe(6 * 256);
    expect([p.tx[0], p.ty[0], p.tz[0]]).toEqual([0, TANGENT_ONE, 0]);
    expect(p.length).toBe(256);
  });

  it('is continuous across a lift hill, drop, banked turn and loop', () => {
    const { w, ride } = setup();
    put(w, ride, PieceId.Station, PieceMode.Normal, [20, 20, 6, 0]);
    put(w, ride, PieceId.FlatToUp25, PieceMode.ChainLift);
    put(w, ride, PieceId.Up25, PieceMode.ChainLift);
    put(w, ride, PieceId.Up25ToUp60);
    put(w, ride, PieceId.Up60);
    put(w, ride, PieceId.Up60ToUp25);
    put(w, ride, PieceId.Up25ToFlat);
    put(w, ride, PieceId.FlatToDown25);
    put(w, ride, PieceId.Down25ToDown60);
    put(w, ride, PieceId.Down60);
    put(w, ride, PieceId.Down60ToDown25);
    put(w, ride, PieceId.Down25ToFlat);
    put(w, ride, PieceId.VerticalLoopLeft);
    put(w, ride, PieceId.FlatToRightBank);
    put(w, ride, PieceId.MediumRightBanked);
    put(w, ride, PieceId.RightBankToFlat);
    put(w, ride, PieceId.Flat, PieceMode.BlockBrake);
    const p = getTrackPath(w, ride)!;
    expect(p.length).toBe(w.track.length[ride]);
    expectContinuous(p);
    expect(p.pieceStart.length).toBe(w.track.count[ride] + 1);
    expect(p.pieceStart[p.pieceStart.length - 1]).toBe(p.count);
    // Chain-lift points carry the mode; the climb is monotonic.
    expect(p.mode[p.pieceStart[1] + 1]).toBe(PieceMode.ChainLift);
    expect(p.mode[p.count - 1]).toBe(PieceMode.BlockBrake);
    let top = 0;
    for (let i = 0; i < p.count; i++) top = Math.max(top, p.z[i]);
    expect(top).toBe((6 + 1 + 2 + 4 + 8 + 4 + 1) * TRACK_Z_STEP);
    expect(Math.max(...p.bank)).toBe(BANK_DEG);
    expect(Math.min(...p.bank)).toBe(0);
  });

  it('wraps a closed circuit onto its first point', () => {
    const { w, ride } = setup();
    put(w, ride, PieceId.Station, PieceMode.Normal, [10, 10, 6, 0]);
    for (const [id, k] of [
      [PieceId.Flat, 2],
      [PieceId.SmallRight, 1],
      [PieceId.Flat, 2],
      [PieceId.SmallRight, 1],
      [PieceId.Flat, 3],
      [PieceId.SmallRight, 1],
      [PieceId.Flat, 2],
      [PieceId.SmallRight, 1],
    ]) {
      for (let i = 0; i < k; i++) put(w, ride, id);
    }
    const p = getTrackPath(w, ride)!;
    expect(p.closed).toBe(true);
    expect([p.x[p.count - 1], p.y[p.count - 1], p.z[p.count - 1]]).toEqual([
      p.x[0],
      p.y[0],
      p.z[0],
    ]);
    expect(p.s[p.count - 1]).toBe(w.track.length[ride]);
    expectContinuous(p);
    let sum = 0;
    for (let i = 0; i < w.track.pieces.count; i++)
      sum += PIECES[w.track.pieces.cols.pieceType[i]].length;
    expect(p.length).toBe(sum);
  });

  it('caches the path until the track is edited', () => {
    const { w, ride } = setup();
    put(w, ride, PieceId.Station, PieceMode.Normal, [10, 10, 6, 0]);
    const a = getTrackPath(w, ride)!;
    expect(getTrackPath(w, ride)).toBe(a);
    put(w, ride, PieceId.Flat);
    const b = getTrackPath(w, ride)!;
    expect(b).not.toBe(a);
    expect(b.length).toBeGreaterThan(a.length);
    removeTrack(w, ride, -1);
    expect(getTrackPath(w, ride)!.length).toBe(a.length);
  });
});

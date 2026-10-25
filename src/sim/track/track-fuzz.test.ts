import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { hashWorld } from '../core/hash';
import { Prng } from '../core/prng';
import type { World } from '../core/world';
import { OWNED } from '../map/tile-map';
import { PIECES, PieceId, getConstructionCursor, getTrackPath } from './index';

const GENERAL_FUZZ_PIECES = PIECES.filter((piece) => piece.id !== PieceId.WaterSplashDrop);

function checkInvariants(w: World): void {
  const t = w.track;
  let total = 0;
  for (let r = 0; r < t.head.length; r++) {
    if (t.head[r] < 0) {
      expect(t.tail[r]).toBe(-1);
      expect(t.count[r]).toBe(0);
      continue;
    }
    const c = t.pieces.cols;
    let id = t.head[r];
    let n = 0;
    let prev = -1;
    do {
      const s = t.pieces.idToSlot[id];
      expect(c.rideId[s]).toBe(r);
      if (!t.closed[r] || n > 0) expect(c.prev[s]).toBe(prev);
      prev = id;
      id = c.next[s];
      n++;
    } while (id >= 0 && id !== t.head[r]);
    expect(prev).toBe(t.tail[r]);
    expect(n).toBe(t.count[r]);
    expect(id === t.head[r]).toBe(t.closed[r] === 1);
    total += n;
    const path = getTrackPath(w, r)!;
    expect(path.length).toBe(t.length[r]);
  }
  expect(total).toBe(t.pieces.count);
}

function fuzz(seed: number): { hash: number; sim: Simulation } {
  const sim = new Simulation({ seed, width: 32, height: 32, maxGuests: 16 });
  sim.world.map.heights.fill(3);
  sim.world.map.ownership.fill(OWNED);
  const rides = [0, 1, 2].map(() => sim.world.rides.slotToId[sim.world.rides.spawn()]);
  const rng = new Prng(seed * 7 + 1);
  for (let i = 0; i < 1500; i++) {
    const ride = rides[rng.nextU32() % rides.length];
    if (rng.nextU32() % 7 === 0) {
      sim.enqueue({ type: 'removeTrack', rideId: ride, pieceId: -1 });
    } else {
      const cur = getConstructionCursor(sim.world, ride);
      const fresh = !cur.hasTrack || rng.nextU32() % 16 === 0;
      sim.enqueue({
        type: 'placeTrack',
        rideId: ride,
        pieceType: GENERAL_FUZZ_PIECES[rng.nextU32() % GENERAL_FUZZ_PIECES.length]!.id,
        x: fresh ? 4 + (rng.nextU32() % 24) : cur.x,
        y: fresh ? 4 + (rng.nextU32() % 24) : cur.y,
        z: fresh ? 4 + (rng.nextU32() % 8) : cur.z,
        dir: fresh ? rng.nextU32() % 4 : cur.dir,
        mode: rng.nextU32() % 5 === 0 ? rng.nextU32() % 4 : 0,
      });
    }
    sim.step();
    if (i % 100 === 0) checkInvariants(sim.world);
  }
  checkInvariants(sim.world);
  return { hash: hashWorld(sim.world), sim };
}

describe('track fuzz', () => {
  it('keeps chains consistent under random commands and replays identically', () => {
    const a = fuzz(11);
    expect(a.sim.world.track.pieces.count).toBeGreaterThan(20);
    expect(fuzz(11).hash).toBe(a.hash);
    expect(fuzz(12).hash).not.toBe(a.hash);
  });
});

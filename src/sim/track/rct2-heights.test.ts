import { describe, expect, it } from 'vitest';
import { TRACK_Z_STEP, Z_STEP } from '../core/constants';
import { World } from '../core/world';
import { OWNED } from '../map/tile-map';
import { PIECES, SAMPLES, pieceByName } from './catalog';
import { circuitStatus, getConstructionCursor, placeTrack } from './construction';
import { Bank, PieceMode, Slope } from './track-types';
import type { TrackPieceDef } from './track-types';

/**
 * Rise of each piece in land steps, from OpenRCT2's track coordinate table (zEnd - zBegin, where a
 * land step is 16 z units and a track step 8):
 * https://github.com/OpenRCT2/OpenRCT2/blob/aca477060424cc9f2e3d925fa3b13f84f4fbf3f7/src/openrct2/ride/TrackData.cpp
 * and the ted/TED.*.h headers next to it. Sloped large turns follow OpenRCT2's pair of 25-degree
 * eighth turns (+3 land steps each); a full helix is two RCT2 half helices (+1 each). The level
 * corkscrew and the water splash drop are OpenCoaster pieces whose rise follows the slope classes
 * at their ends.
 */
function rct2LandSteps(p: TrackPieceDef): number {
  const name = p.name;
  if (/Helix.*Up$/.test(name)) return 2;
  if (/Helix.*Down$/.test(name)) return -2;
  const turn = /^(small|medium|large)(Left|Right).*(Up25|Down25)$/.exec(name);
  if (turn) {
    const steps = { small: 2, medium: 4, large: 6 }[turn[1] as 'small' | 'medium' | 'large'];
    return turn[3] === 'Up25' ? steps : -steps;
  }
  const up = (a: Slope, b: Slope): number => {
    const key = `${Math.abs(a)}>${Math.abs(b)}`;
    const table: Record<string, number> = {
      '0>0': 0,
      '0>1': 0.5,
      '1>0': 0.5,
      '1>1': 1,
      '1>2': 2,
      '2>1': 2,
      '2>2': 4,
    };
    return table[key];
  };
  const sign = p.entrySlope < 0 || p.exitSlope < 0 ? -1 : 1;
  return sign * up(p.entrySlope, p.exitSlope);
}

describe('RCT2 track heights', () => {
  it('gives every piece the rise of its RCT2 counterpart', () => {
    for (const p of PIECES) {
      const want = rct2LandSteps(p) * Z_STEP;
      const end = p.sampleStart + p.sampleCount - 1;
      expect(SAMPLES.z[end], p.name).toBe(want);
      expect(p.dz * TRACK_Z_STEP, p.name).toBe(want);
    }
  });

  it('reaches every whole land-level difference with level-to-level straight track', () => {
    const straights = PIECES.filter(
      (p) =>
        p.headingDelta === 0 &&
        p.entryBank === Bank.None &&
        p.exitBank === Bank.None &&
        p.dx === 1 &&
        p.dy === 0,
    );
    // Breadth-first search over (slope at the cursor, height in world units).
    const reached = new Set<string>(['0:0']);
    let frontier: [number, number][] = [[Slope.Flat, 0]];
    for (let depth = 0; depth < 12; depth++) {
      const next: [number, number][] = [];
      for (const [slope, z] of frontier) {
        for (const p of straights) {
          if (p.entrySlope !== slope) continue;
          const nz = z + p.dz * TRACK_Z_STEP;
          if (Math.abs(nz) > 12 * Z_STEP) continue;
          const key = `${p.exitSlope}:${nz}`;
          if (reached.has(key)) continue;
          reached.add(key);
          next.push([p.exitSlope, nz]);
        }
      }
      frontier = next;
    }
    for (let levels = -8; levels <= 8; levels++) {
      expect(reached.has(`${Slope.Flat}:${levels * Z_STEP}`), `${levels} levels`).toBe(true);
    }
  });

  it('closes a circuit whose two ends sit one land level apart', () => {
    const world = new World({ seed: 1, width: 32, height: 32, maxGuests: 16 });
    world.map.heights.fill(2);
    world.map.ownership.fill(OWNED);
    const ride = world.rides.slotToId[world.rides.spawn()];
    const groundSteps = (2 * Z_STEP) / TRACK_Z_STEP;
    const append = (name: string): number => {
      const c = getConstructionCursor(world, ride);
      return placeTrack(world, {
        rideId: ride,
        pieceType: pieceByName(name)!.id,
        x: c.hasTrack ? c.x : 8,
        y: c.hasTrack ? c.y : 8,
        z: c.hasTrack ? c.z : groundSteps,
        dir: c.hasTrack ? c.dir : 0,
        mode: PieceMode.Normal,
      });
    };
    for (const name of ['station', 'flatToUp25', 'up25ToFlat']) expect(append(name), name).toBe(0);
    const raised = getConstructionCursor(world, ride);
    expect(raised.z * TRACK_Z_STEP - groundSteps * TRACK_Z_STEP).toBe(Z_STEP);
    for (const name of [
      'smallRight',
      'smallRight',
      'flat',
      'flatToDown25',
      'down25ToFlat',
      'smallRight',
      'smallRight',
    ]) {
      expect(append(name), name).toBe(0);
    }
    expect(circuitStatus(world, ride).closed).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { TRACK_STEPS_PER_LEVEL, Z_STEP } from '../core/constants';
import { pieceByName } from './catalog';
import { unsoundTrenchPiece } from './clearance';
import type { TerrainTiles } from './clearance';
import { trenchTiles } from './trench';
import type { TrackPiecePlacement } from './trench';

const W = 16;
const LEVEL = 5;
const id = (name: string): number => pieceByName(name)!.id;

/** Terrain from a corner height function, so neighbouring tiles share their corners. */
function fromVertices(vertex: (vx: number, vy: number) => number): TerrainTiles {
  const heights = new Uint8Array(W * W);
  const slope = new Uint8Array(W * W);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const c = [vertex(x, y), vertex(x + 1, y), vertex(x + 1, y + 1), vertex(x, y + 1)];
      const base = Math.min(...c);
      heights[y * W + x] = base;
      slope[y * W + x] = c.reduce((m, h, k) => m | (h > base ? 1 << k : 0), 0);
    }
  return { width: W, height: W, heights, slope };
}

const plain = fromVertices(() => LEVEL);
const GROUND_Z = LEVEL * TRACK_STEPS_PER_LEVEL;

/** A run of straight pieces heading +x from tile (x, y) at ground level; z follows the pieces. */
function run(names: string[], x = 4, y = 6, z = GROUND_Z): TrackPiecePlacement[] {
  const out: TrackPiecePlacement[] = [];
  let at = x;
  let height = z;
  for (const name of names) {
    out.push({ pieceType: id(name), x: at, y, z: height, dir: 0 });
    height += pieceByName(name)!.dz;
    at += 1;
  }
  return out;
}

describe('trench tiles', () => {
  const dip = run([
    'flat',
    'flatToDown25',
    'down25ToFlat',
    'flat',
    'flat',
    'flatToUp25',
    'up25ToFlat',
    'flat',
  ]);

  it('opens the tiles where the track is below the ground but not yet roofed over', () => {
    const trench = trenchTiles(plain, dip);
    expect([...trench.keys()].sort((a, b) => a - b)).toEqual([5, 6, 9, 10].map((x) => 6 * W + x));
  });

  it('runs along the heading axis and follows the track down', () => {
    const trench = trenchTiles(plain, dip);
    const first = trench.get(6 * W + 5)!;
    expect(first.axis).toBe(0);
    expect(first.lowDepth).toBe(0);
    expect(first.highDepth).toBe(Z_STEP / 2);
    const second = trench.get(6 * W + 6)!;
    expect(second.lowDepth).toBe(Z_STEP / 2);
    expect(second.highDepth).toBe(Z_STEP);
  });

  it('puts a headwall where the trench ends at full depth, and nowhere else', () => {
    const trench = trenchTiles(plain, dip);
    const heads = [...trench.values()].map((t) => [t.lowHead, t.highHead]);
    expect(heads).toEqual([
      [false, false],
      [false, true],
      [true, false],
      [false, false],
    ]);
  });

  it('leaves tiles with track above the ground, and roofed tunnel, alone', () => {
    const trench = trenchTiles(plain, dip);
    expect(trench.has(6 * W + 4)).toBe(false);
    expect(trench.has(6 * W + 7)).toBe(false);
    expect(trench.has(6 * W + 8)).toBe(false);
  });

  it('keeps a shallow dip that never roofs over as an open cutting', () => {
    const trench = trenchTiles(plain, run(['flatToDown25']));
    expect(trench.size).toBe(1);
    const tile = trench.get(6 * W + 4)!;
    expect([tile.lowHead, tile.highHead]).toEqual([false, false]);
  });

  it('reports the same trench for every heading', () => {
    for (const dir of [1, 2, 3]) {
      const turned = dip.map((p) => {
        const dx = p.x - 4;
        const [x, y] = [
          [4 + dx, 6],
          [6, 4 + dx],
          [8 - dx, 6],
          [6, 8 - dx],
        ][dir]!;
        return { ...p, x: x!, y: y!, dir };
      });
      const trench = trenchTiles(plain, turned);
      expect(trench.size).toBe(4);
      expect([...trench.values()].every((t) => t.axis === (dir & 1))).toBe(true);
      expect([...trench.values()].filter((t) => t.lowHead || t.highHead)).toHaveLength(2);
    }
  });

  it('digs into a hillside that rises straight away from the track', () => {
    const hill = fromVertices((vx) => LEVEL + Math.min(3, Math.max(0, vx - 6)));
    const trench = trenchTiles(hill, run(['flat', 'flat', 'flat', 'flat'], 4, 6));
    const tile = trench.get(6 * W + 6)!;
    expect(tile.lowDepth).toBe(0);
    expect(tile.highDepth).toBe(Z_STEP);
    expect(tile.highHead).toBe(true);
    expect(trench.has(6 * W + 7)).toBe(false);
  });
});

describe('pieces that may not sit in a shallow trench', () => {
  it('refuses a turn that is partly below the ground and not yet roofed over', () => {
    const turn = { pieceType: id('smallLeft'), x: 5, y: 6, z: GROUND_Z - 1, dir: 0 };
    expect(unsoundTrenchPiece(plain, turn)).toBe(true);
  });

  it('accepts a turn on the ground and a turn deep under it', () => {
    const turn = { pieceType: id('smallLeft'), x: 5, y: 6, z: GROUND_Z, dir: 0 };
    expect(unsoundTrenchPiece(plain, turn)).toBe(false);
    expect(unsoundTrenchPiece(plain, { ...turn, z: GROUND_Z - 6 })).toBe(false);
  });

  it('accepts straight pieces in a trench', () => {
    const straight = { pieceType: id('down25ToFlat'), x: 5, y: 6, z: GROUND_Z - 1, dir: 0 };
    expect(unsoundTrenchPiece(plain, straight)).toBe(false);
  });
});

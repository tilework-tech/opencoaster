import { describe, expect, it } from 'vitest';
import { Prng } from '../core/prng';
import { Simulation } from '../core/simulation';
import { hashWorld } from '../core/hash';
import { OWNED } from '../map/tile-map';
import { placePath } from '../map/paths';
import { GridPathGraph } from './fixture';
import {
  DEFAULT_GUEST_OPTS,
  DEFAULT_STAFF_OPTS,
  DIR_E,
  DIR_N,
  DIR_NONE,
  DIR_S,
  DIR_W,
  isReachable,
  nextDirection,
  oppositeDir,
} from './index';

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

function world(rows: string[]): { map: GridPathGraph } {
  return { map: new GridPathGraph(rows) };
}

/** Follows nextDirection from `from` until `to`, returning steps taken (or -1). */
function walk(
  w: { map: GridPathGraph },
  from: [number, number],
  to: [number, number],
  opts = DEFAULT_GUEST_OPTS,
  seed = 1,
  cap = 500,
): number {
  const rng = new Prng(seed);
  let [x, y] = from;
  let came = DIR_NONE;
  const target = w.map.index(to[0], to[1]);
  for (let s = 0; s < cap; s++) {
    if (w.map.index(x, y) === target) return s;
    const d = nextDirection(w, w.map.index(x, y), target, rng, { ...opts, fromDir: came });
    if (d === DIR_NONE) return -1;
    x += DX[d];
    y += DY[d];
    came = d;
  }
  return -1;
}

describe('nextDirection', () => {
  const corridor = ['#####'];
  it('walks a straight corridor to the target', () => {
    const w = world(corridor);
    expect(nextDirection(w, 0, 4, new Prng(1))).toBe(DIR_E);
    expect(nextDirection(w, 4, 0, new Prng(1))).toBe(DIR_W);
  });

  it('returns DIR_NONE at the target, off-path, or when unreachable', () => {
    const w = world(['##.##']);
    expect(nextDirection(w, 0, 0, new Prng(1))).toBe(DIR_NONE);
    expect(nextDirection(w, 2, 0, new Prng(1))).toBe(DIR_NONE);
    expect(nextDirection(w, 0, 4, new Prng(1))).toBe(DIR_NONE);
  });

  it('picks the shorter way round a loop', () => {
    const w = world(['#####', '#...#', '#...#', '#...#', '#####']);
    expect(nextDirection(w, w.map.index(0, 0), w.map.index(0, 1), new Prng(1))).toBe(DIR_S);
    expect(nextDirection(w, w.map.index(0, 0), w.map.index(2, 0), new Prng(1))).toBe(DIR_E);
    expect(walk(w, [0, 0], [4, 3])).toBe(7);
  });

  it('finds a target in the middle of a corridor behind a junction', () => {
    const w = world(['..#..', '#####', '..#..']);
    expect(walk(w, [0, 1], [2, 0])).toBe(3);
    expect(walk(w, [4, 1], [2, 2])).toBe(3);
  });

  it('finds a target mid-corridor when the start is also mid-corridor', () => {
    const w = world(['#######']);
    expect(nextDirection(w, 1, 5, new Prng(1))).toBe(DIR_E);
    expect(nextDirection(w, 5, 2, new Prng(1))).toBe(DIR_W);
  });

  it('does not walk backwards unless at a dead end', () => {
    const w = world(['#####']);
    const rng = new Prng(1);
    expect(nextDirection(w, 2, 0, rng, { ...DEFAULT_GUEST_OPTS, fromDir: DIR_E })).toBe(DIR_E);
    expect(nextDirection(w, 4, 0, rng, { ...DEFAULT_GUEST_OPTS, fromDir: DIR_E })).toBe(DIR_W);
  });

  it('reaches targets across a maze with dead ends and loops', () => {
    const w = world([
      '###########',
      '#.#.....#.#',
      '#.#.###.#.#',
      '#.###.#.###',
      '#.....#...#',
      '###########',
    ]);
    const target: [number, number] = [4, 3];
    expect(isReachable(w, 0, w.map.index(...target))).toBe(true);
    for (let seed = 0; seed < 10; seed++) {
      expect(walk(w, [0, 0], target, DEFAULT_STAFF_OPTS, seed)).toBeGreaterThan(0);
    }
  });

  it('finds a target twelve junctions down a spine lined with side teeth', () => {
    const teeth = 12;
    const width = teeth * 2 + 3;
    const toothRow = Array.from({ length: width }, (_, x) =>
      x >= 2 && x <= teeth * 2 && x % 2 === 0 ? '#' : '.',
    ).join('');
    const spine = '#'.repeat(width);
    expect(walk(world([toothRow, spine]), [0, 1], [width - 1, 1])).toBeGreaterThan(0);
  });

  it('gets lost when the target is beyond the junction budget but still moves', () => {
    const rows = ['#'.repeat(41), ...Array.from({ length: 4 }, () => '#' + '.'.repeat(39) + '#')];
    const comb: string[] = [];
    for (let y = 0; y < 3; y++) comb.push('#'.repeat(41));
    const w = world(rows.concat(comb));
    const d = nextDirection(w, w.map.index(0, 0), w.map.index(40, 7), new Prng(1), {
      ...DEFAULT_GUEST_OPTS,
      maxJunctions: 1,
    });
    expect(d).not.toBe(DIR_NONE);
  });

  it('wanders at junctions without reversing and varies by rng', () => {
    const w = world(['..#..', '#####', '..#..']);
    const seen = new Set<number>();
    const opts = { ...DEFAULT_GUEST_OPTS, fromDir: DIR_E };
    for (let seed = 0; seed < 40; seed++) {
      seen.add(nextDirection(w, w.map.index(2, 1), -1, new Prng(seed), opts));
    }
    expect(seen).toEqual(new Set([DIR_E, DIR_S, DIR_N]));
  });

  it('wanders when the guest is lost (walked past lostAfter)', () => {
    const w = world(['..#..', '#####', '..#..']);
    const seen = new Set<number>();
    const opts = { ...DEFAULT_GUEST_OPTS, fromDir: DIR_E, stepsTaken: 1000, lostAfter: 10 };
    for (let seed = 0; seed < 60; seed++) {
      seen.add(nextDirection(w, w.map.index(2, 1), w.map.index(4, 1), new Prng(seed), opts));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('is deterministic for a given rng seed', () => {
    const w = world(['#####', '#.#.#', '#####']);
    const a = Array.from({ length: 20 }, (_, i) => walk(w, [0, 0], [4, 2], DEFAULT_GUEST_OPTS, i));
    const b = Array.from({ length: 20 }, (_, i) => walk(w, [0, 0], [4, 2], DEFAULT_GUEST_OPTS, i));
    expect(a).toEqual(b);
  });

  it('works on a real World map with placed paths', () => {
    const sim = new Simulation({ seed: 3, width: 16, height: 16 });
    const m = sim.world.map;
    m.waterLevel.fill(0);
    m.ownership.fill(OWNED);
    m.fillFlat(4);
    for (let x = 2; x < 10; x++) placePath(m, { x, y: 4 });
    const d = nextDirection(sim.world, m.index(2, 4), m.index(9, 4), new Prng(1));
    expect(d).toBe(DIR_E);
    expect(isReachable(sim.world, m.index(2, 4), m.index(9, 4))).toBe(true);
    expect(isReachable(sim.world, m.index(2, 4), m.index(2, 5))).toBe(false);
  });
});

describe('cache invalidation', () => {
  it('re-plans after a path edit', () => {
    const w = world(['#####', '#...#', '#####']);
    const t = w.map.index(4, 0);
    expect(nextDirection(w, w.map.index(0, 0), t, new Prng(1))).toBe(DIR_E);
    w.map.setPath(2, 0, false);
    expect(isReachable(w, w.map.index(0, 0), t)).toBe(true);
    expect(nextDirection(w, w.map.index(0, 0), t, new Prng(1))).toBe(DIR_S);
    w.map.setPath(0, 1, false);
    expect(isReachable(w, w.map.index(0, 0), t)).toBe(false);
    expect(nextDirection(w, w.map.index(0, 0), t, new Prng(1))).toBe(DIR_NONE);
  });
});

describe('isReachable', () => {
  it('distinguishes connected components', () => {
    const w = world(['##.##', '##.##']);
    expect(isReachable(w, 0, w.map.index(1, 1))).toBe(true);
    expect(isReachable(w, 0, w.map.index(3, 0))).toBe(false);
    expect(isReachable(w, 2, 2)).toBe(false);
  });
});

describe('staff patrol', () => {
  const rows = ['###########', '..#.......#.', '###########'];
  it('stays inside the patrol mask while wandering', () => {
    const w = world(['#####', '#...#', '#####']);
    const mask = new Uint8Array(15);
    for (let x = 0; x < 5; x++) mask[x] = 1;
    const rng = new Prng(5);
    let x = 0;
    let came = DIR_NONE;
    for (let s = 0; s < 200; s++) {
      const d = nextDirection(w, x, -1, rng, {
        ...DEFAULT_GUEST_OPTS,
        fromDir: came,
        patrol: mask,
      });
      expect(d === DIR_E || d === DIR_W).toBe(true);
      x += DX[d];
      came = d;
      expect(mask[x]).toBe(1);
    }
  });

  it('routes to a target through the area and returns to the area when outside', () => {
    const w = world(rows);
    const mask = new Uint8Array(rows[0].length * 3);
    for (let x = 0; x < 11; x++) mask[x] = 1;
    const opts = { ...DEFAULT_GUEST_OPTS, patrol: mask };
    expect(nextDirection(w, 0, 10, new Prng(1), opts)).toBe(DIR_E);
    expect(nextDirection(w, w.map.index(0, 2), 10, new Prng(1), opts)).toBe(DIR_E);
    const out = w.map.index(5, 2);
    expect(mask[out]).toBe(0);
    expect(nextDirection(w, out, -1, new Prng(1), opts)).toBe(DIR_W);
  });

  it('heads back into the area from outside', () => {
    const w = world(['#####']);
    const mask = new Uint8Array(5);
    mask[0] = 1;
    mask[1] = 1;
    expect(nextDirection(w, 4, -1, new Prng(1), { ...DEFAULT_GUEST_OPTS, patrol: mask })).toBe(
      DIR_W,
    );
  });
});

describe('oppositeDir', () => {
  it('flips', () => {
    expect([DIR_E, DIR_S, DIR_W, DIR_N].map(oppositeDir)).toEqual([DIR_W, DIR_N, DIR_E, DIR_S]);
  });
});

describe('determinism', () => {
  it('same seed and same walkers give the same world hash', () => {
    const run = (): number => {
      const sim = new Simulation({ seed: 9, width: 24, height: 24 });
      const m = sim.world.map;
      m.waterLevel.fill(0);
      m.ownership.fill(OWNED);
      m.fillFlat(4);
      for (let i = 0; i < 24; i++) {
        placePath(m, { x: i, y: 5 });
        placePath(m, { x: 5, y: i });
        placePath(m, { x: i, y: 18 });
      }
      let acc = 0;
      const rng = sim.world.rng;
      let t = m.index(5, 5);
      for (let s = 0; s < 400; s++) {
        const d = nextDirection(sim.world, t, m.index(23, 18), rng);
        if (d === DIR_NONE) break;
        t += DX[d] + DY[d] * m.width;
        acc = (acc * 31 + t) | 0;
      }
      return (acc ^ hashWorld(sim.world)) >>> 0;
    };
    expect(run()).toBe(run());
  });
});

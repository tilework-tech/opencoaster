import { describe, expect, it } from 'vitest';
import { Prng } from '../core/prng';
import { GridPathGraph } from './fixture';
import {
  createJunctionMemory,
  DEFAULT_GUEST_OPTS,
  DEFAULT_STAFF_OPTS,
  DIR_E,
  DIR_N,
  DIR_S,
  DIR_W,
  GUEST_JUNCTIONS,
  GUEST_LEAVING_JUNCTIONS,
  GUEST_LEAVING_LOST_JUNCTIONS,
  GUEST_MAP_JUNCTIONS,
  lastSearchOutcome,
  nextDirection,
  SearchOutcome,
  STAFF_JUNCTIONS,
} from './index';

function world(rows: string[]): { map: GridPathGraph } {
  return { map: new GridPathGraph(rows) };
}

describe('junction budgets', () => {
  it('uses the RCT2 junction budgets', () => {
    expect(GUEST_JUNCTIONS).toBe(5);
    expect(GUEST_MAP_JUNCTIONS).toBe(7);
    expect(GUEST_LEAVING_JUNCTIONS).toBe(7);
    expect(GUEST_LEAVING_LOST_JUNCTIONS).toBe(8);
    expect(STAFF_JUNCTIONS).toBe(8);
    expect(DEFAULT_GUEST_OPTS.maxJunctions).toBe(GUEST_JUNCTIONS);
    expect(DEFAULT_STAFF_OPTS.maxJunctions).toBe(STAFF_JUNCTIONS);
  });

  /**
   * A spine along y=0 with a one-tile tooth under x = 2, 4, ... 16. A walker standing on the
   * x=2 junction who arrived heading east meets junctions at x = 4 (cost 1), 6 (2), ... 16 (7);
   * the goal is the dead end at x=18, reached by expanding the seventh junction.
   */
  const comb = (): { map: GridPathGraph } => {
    const top = '#'.repeat(19);
    let teeth = '';
    for (let x = 0; x < 19; x++) teeth += x >= 2 && x <= 16 && x % 2 === 0 ? '#' : ' ';
    return world([top, teeth]);
  };

  function outcomeWith(maxJunctions: number): SearchOutcome {
    const w = comb();
    const start = w.map.index(2, 0);
    const goal = w.map.index(18, 0);
    nextDirection(w, start, goal, new Prng(1), {
      ...DEFAULT_GUEST_OPTS,
      fromDir: DIR_E,
      maxJunctions,
    });
    return lastSearchOutcome();
  }

  it('sees a goal seven junctions away only with a budget of seven', () => {
    expect(outcomeWith(GUEST_JUNCTIONS)).toBe(SearchOutcome.Blind);
    expect(outcomeWith(6)).toBe(SearchOutcome.Blind);
    expect(outcomeWith(GUEST_MAP_JUNCTIONS)).toBe(SearchOutcome.Seen);
  });

  it('charges every junction one unit even when a corridor leads to it', () => {
    const w = world(['#####', ' # # ']);
    const goal = w.map.index(4, 0);
    // The tooth under x=1 is a dead end; the junction at x=3 costs one unit of budget.
    nextDirection(w, w.map.index(1, 0), goal, new Prng(1), {
      ...DEFAULT_GUEST_OPTS,
      fromDir: DIR_E,
      maxJunctions: 1,
    });
    expect(lastSearchOutcome()).toBe(SearchOutcome.Seen);
  });
});

describe('junction memory', () => {
  /**
   * A four-way junction at (4,4). West runs on to the goal at (0,0). North is a dead end at
   * (4,0), the next best in sight; south ends at (4,6), east at (8,4).
   */
  function crossWorld(): { map: GridPathGraph } {
    const rows: string[] = [];
    for (let y = 0; y < 9; y++) {
      let row = '';
      for (let x = 0; x < 9; x++) {
        const west = y === 4 && x <= 4;
        const goalColumn = x === 0 && y <= 4;
        const north = x === 4 && y <= 4;
        const east = y === 4 && x >= 4;
        const south = x === 4 && y >= 4 && y <= 6;
        row += west || goalColumn || north || east || south ? '#' : ' ';
      }
      rows.push(row);
    }
    return world(rows);
  }

  const J = (w: { map: GridPathGraph }): number => w.map.index(4, 4);
  const GOAL = (w: { map: GridPathGraph }): number => w.map.index(0, 0);

  function decide(
    w: { map: GridPathGraph },
    fromDir: number,
    memory: ReturnType<typeof createJunctionMemory> | null,
    goal = GOAL(w),
  ): number {
    return nextDirection(w, J(w), goal, new Prng(7), { ...DEFAULT_GUEST_OPTS, fromDir, memory });
  }

  it('tries each remaining exit of a junction before repeating one', () => {
    const w = crossWorld();
    const memory = createJunctionMemory();
    // Arriving from the west the guest takes the north exit, the best it can see.
    expect(decide(w, DIR_E, memory)).toBe(DIR_N);
    // Back from the north dead end, west would win again (it sees the goal), but the guest
    // remembers it came in that way and has only east and south left.
    expect(decide(w, DIR_S, memory)).toBe(DIR_S);
    // Back from the south dead end: only east is untried.
    expect(decide(w, DIR_N, memory)).toBe(DIR_E);
    // Every exit has been tried, so the memory resets and the best exit wins again.
    expect(decide(w, DIR_W, memory)).toBe(DIR_W);
  });

  it('returns to the best exit without a memory', () => {
    const w = crossWorld();
    expect(decide(w, DIR_E, null)).toBe(DIR_N);
    expect(decide(w, DIR_S, null)).toBe(DIR_W);
  });

  it('forgets the junctions when the goal changes', () => {
    const w = crossWorld();
    const memory = createJunctionMemory();
    expect(decide(w, DIR_E, memory)).toBe(DIR_N);
    expect(decide(w, DIR_S, memory, w.map.index(0, 1))).toBe(DIR_W);
  });

});

describe('aimless wandering', () => {
  const tJunction = (): { map: GridPathGraph } =>
    world(['         ', '    #    ', '#########']);
  const plus = (): { map: GridPathGraph } =>
    world(['    #    ', '    #    ', '#########', '    #    ', '    #    ']);

  function shares(w: { map: GridPathGraph }, at: [number, number], trials: number): number[] {
    const counts = [0, 0, 0, 0];
    const rng = new Prng(11);
    for (let i = 0; i < trials; i++) {
      const d = nextDirection(w, w.map.index(at[0], at[1]), -1, rng, {
        ...DEFAULT_GUEST_OPTS,
        fromDir: DIR_E,
      });
      counts[d]++;
    }
    return counts.map((c) => c / trials);
  }

  it('goes straight half the time and otherwise picks any open exit', () => {
    // T-junction, heading east: straight (0.5) plus half of the other half.
    const t = shares(tJunction(), [4, 2], 4000);
    expect(t[DIR_E]).toBeGreaterThan(0.72);
    expect(t[DIR_E]).toBeLessThan(0.78);
    expect(t[DIR_N]).toBeGreaterThan(0.22);
    expect(t[DIR_N]).toBeLessThan(0.28);
    expect(t[DIR_W]).toBe(0);
  });

  it('weights a four-way junction 2/3 straight and 1/6 each side', () => {
    const p = shares(plus(), [4, 2], 6000);
    expect(p[DIR_E]).toBeGreaterThan(0.637);
    expect(p[DIR_E]).toBeLessThan(0.697);
    expect(p[DIR_N]).toBeGreaterThan(0.137);
    expect(p[DIR_N]).toBeLessThan(0.197);
    expect(p[DIR_S]).toBeGreaterThan(0.137);
    expect(p[DIR_S]).toBeLessThan(0.197);
  });

  it('is not applied to staff', () => {
    expect(DEFAULT_STAFF_OPTS.straightBias).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { exitLevel, pathRunTiles, pieceBase, pieceSlope, stepCursor } from './run';

describe('pathRunTiles', () => {
  it('is the single anchor tile when the drag stays on it', () => {
    expect(pathRunTiles({ x: 4, y: 4 }, { x: 4, y: 4 })).toEqual([{ x: 4, y: 4 }]);
  });

  it('lays a straight run along x when the end shares the anchor row', () => {
    expect(pathRunTiles({ x: 2, y: 5 }, { x: 5, y: 5 })).toEqual([
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: 5 },
    ]);
  });

  it('lays a straight run backwards along y', () => {
    expect(pathRunTiles({ x: 3, y: 6 }, { x: 3, y: 4 })).toEqual([
      { x: 3, y: 6 },
      { x: 3, y: 5 },
      { x: 3, y: 4 },
    ]);
  });

  it('turns once when the end is off both axes, going along x first', () => {
    expect(pathRunTiles({ x: 1, y: 1 }, { x: 3, y: 4 })).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 3, y: 4 },
    ]);
  });

  it('turns back toward negative coordinates without repeating the corner', () => {
    const run = pathRunTiles({ x: 5, y: 5 }, { x: 3, y: 2 });
    expect(run).toHaveLength(2 + 3 + 1);
    expect(new Set(run.map((t) => `${t.x},${t.y}`)).size).toBe(run.length);
    expect(run[0]).toEqual({ x: 5, y: 5 });
    expect(run.at(-1)).toEqual({ x: 3, y: 2 });
  });
});

describe('pieceSlope', () => {
  it('leaves the piece to follow the ground when level', () => {
    expect(pieceSlope(1, 'level')).toBe(-1);
  });

  it('rises toward the chosen direction when going up', () => {
    expect(pieceSlope(2, 'up')).toBe(2);
  });

  it('rises away from the chosen direction when going down', () => {
    expect(pieceSlope(2, 'down')).toBe(0);
    expect(pieceSlope(0, 'down')).toBe(2);
  });
});

describe('stepCursor', () => {
  it('moves one tile in the chosen direction', () => {
    expect(stepCursor({ x: 4, y: 4 }, 0)).toEqual({ x: 5, y: 4 });
    expect(stepCursor({ x: 4, y: 4 }, 1)).toEqual({ x: 4, y: 5 });
    expect(stepCursor({ x: 4, y: 4 }, 2)).toEqual({ x: 3, y: 4 });
    expect(stepCursor({ x: 4, y: 4 }, 3)).toEqual({ x: 4, y: 3 });
  });
});

describe('pieceBase', () => {
  it('rests a level or up piece on the entry level', () => {
    expect(pieceBase(5, 'level')).toBe(5);
    expect(pieceBase(5, 'up')).toBe(5);
  });

  it('rests a down piece one level below the entry, so its high end meets the entry', () => {
    expect(pieceBase(5, 'down')).toBe(4);
  });

  it('leaves the base to the ground when the cursor has no level', () => {
    expect(pieceBase(null, 'level')).toBeUndefined();
    expect(pieceBase(null, 'up')).toBeUndefined();
    expect(pieceBase(null, 'down')).toBeUndefined();
  });
});

describe('exitLevel', () => {
  it('is the base for a flat piece', () => {
    expect(exitLevel(3, -1, 0)).toBe(3);
  });

  it('is one above the base when the piece rises toward the way on', () => {
    expect(exitLevel(3, 0, 0)).toBe(4);
  });

  it('is the base when the piece rises back toward where it came from', () => {
    expect(exitLevel(3, 2, 0)).toBe(3);
  });

  it('has no exit when the piece rises sideways', () => {
    expect(exitLevel(3, 1, 0)).toBeNull();
  });
});

describe('chained pieces', () => {
  /** Builds pieces facing +x from an entry level and returns every base and the final level. */
  function chain(entry: number, slopes: Array<'level' | 'up' | 'down'>) {
    let level = entry;
    const bases: number[] = [];
    for (const slope of slopes) {
      const base = pieceBase(level, slope)!;
      bases.push(base);
      level = exitLevel(base, pieceSlope(0, slope), 0)!;
    }
    return { bases, level };
  }

  it('climbs four levels, runs level, then descends four', () => {
    const up = chain(2, ['up', 'up', 'up', 'up']);
    expect(up.bases).toEqual([2, 3, 4, 5]);
    expect(up.level).toBe(6);
    const level = chain(up.level, ['level', 'level']);
    expect(level.bases).toEqual([6, 6]);
    expect(level.level).toBe(6);
    const down = chain(level.level, ['down', 'down', 'down', 'down']);
    expect(down.bases).toEqual([5, 4, 3, 2]);
    expect(down.level).toBe(2);
  });
});

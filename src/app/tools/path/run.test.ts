import { describe, expect, it } from 'vitest';
import { pathRunTiles, pieceSlope, stepCursor } from './run';

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

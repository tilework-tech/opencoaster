import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { OWNED, PATH_COST_CENTS } from './tile-map';
import { placePath, PathResult } from './paths';
import { previewPathRun } from './map-commands';
import { PathStyle } from './tile-map';

function sim(): Simulation {
  const s = new Simulation({ seed: 9, width: 32, height: 32, maxGuests: 100 });
  s.world.map.ownership.fill(OWNED);
  s.world.map.waterLevel.fill(0);
  s.world.map.fillFlat(4);
  return s;
}

describe('footpath preview', () => {
  it('reports the same outcome placing the piece would, without building it', () => {
    const s = sim();
    const m = s.world.map;
    expect(previewPathRun(s.world, [{ x: 6, y: 6 }])[0]!.result).toBe(PathResult.Ok);
    expect(m.pathEdges(m.index(6, 6))).toBe(0);
    expect(m.pathElement(m.index(6, 6), -1)).toBe(-1);
    expect(placePath(m, { x: 6, y: 6 })).toBe(true);
  });

  it('explains a tile the player does not own', () => {
    const s = sim();
    s.world.map.ownership.fill(0);
    expect(previewPathRun(s.world, [{ x: 6, y: 6 }])[0]!.result).toBe(PathResult.NotOwned);
  });

  it('refuses a piece the player cannot afford', () => {
    const s = sim();
    s.world.economy.cash = PATH_COST_CENTS - 1;
    expect(previewPathRun(s.world, [{ x: 6, y: 6 }])[0]!.result).toBe(PathResult.InsufficientFunds);
  });

  it('refunds the piece when a footpath is removed', () => {
    const s = sim();
    const before = s.world.economy.cash;
    s.enqueue({ type: 'placePath', x: 6, y: 6 });
    s.step();
    expect(before - s.world.economy.cash).toBe(PATH_COST_CENTS);
    s.enqueue({ type: 'removePath', x: 6, y: 6 });
    s.step();
    expect(s.world.economy.cash).toBe(before);
  });

  it('previews a run without changing the map, then lays exactly the previewed pieces', () => {
    const s = sim();
    const m = s.world.map;
    const run = [4, 5, 6].map((x) => ({ x, y: 9, style: PathStyle.Dirt }));
    const revision = m.revision;
    const cash = s.world.economy.cash;

    const preview = previewPathRun(s.world, run);
    expect(preview.map((piece) => piece.result)).toEqual([
      PathResult.Ok,
      PathResult.Ok,
      PathResult.Ok,
    ]);
    expect(m.revision).toBe(revision);
    expect(s.world.economy.cash).toBe(cash);

    s.enqueue({ type: 'placePathRun', placements: run });
    s.step();
    expect(s.world.economy.cash).toBe(cash - 3 * PATH_COST_CENTS);
    preview.forEach((piece, k) => {
      const i = m.index(run[k]!.x, 9);
      expect(m.pathEdges(i)).toBe(piece.edges);
      expect(m.pathStyle[m.pathElement(i, piece.z)]).toBe(PathStyle.Dirt);
    });
    expect(preview[1]!.edges).toBe((1 << 0) | (1 << 2));
  });

  it('refuses the pieces the cash on hand cannot pay for, in run order', () => {
    const s = sim();
    s.world.economy.cash = 2 * PATH_COST_CENTS;
    const preview = previewPathRun(s.world, [
      { x: 4, y: 9 },
      { x: 5, y: 9 },
      { x: 6, y: 9 },
    ]);
    expect(preview.map((piece) => piece.result)).toEqual([
      PathResult.Ok,
      PathResult.Ok,
      PathResult.InsufficientFunds,
    ]);
  });
});

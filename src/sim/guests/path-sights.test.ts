import { describe, expect, it } from 'vitest';
import { flatWorld, guestAt, layPath, row } from '../integration/fixtures';
import { PathAddition, setPathAddition } from '../map/paths';
import { markPathElementBroken } from '../map/tile-map';
import { GuestThought } from './guest-store';
import { guestSystem } from './guest-system';
import { dropLitter, LitterKind } from './litter-store';
import { BAD_LITTER_ROLL, PATH_SIGHT_HAPPINESS_LOSS, noteTileSights } from './path-sights';

function pathWorld() {
  const w = flatWorld(24, 21);
  layPath(w, row(6, 2, 20));
  return w;
}

function hasThought(w: ReturnType<typeof pathWorld>, slot: number, thought: GuestThought): boolean {
  const g = w.guests.cols;
  return [g.thought0[slot], g.thought1[slot], g.thought2[slot], g.thought3[slot]].includes(thought);
}

function arrivals(
  w: ReturnType<typeof pathWorld>,
  tiles: number[],
  trials: number,
  thought: GuestThought,
): number {
  let fired = 0;
  for (let i = 0; i < trials; i++) {
    const slot = guestAt(w, tiles[0], 6);
    for (const x of tiles) noteTileSights(w, slot, w.map.index(x, 6));
    if (hasThought(w, slot, thought)) fired++;
    w.guests.despawnSlot(slot);
  }
  return fired;
}

describe('path sights', () => {
  it('complains about litter once the last three tiles hold three pieces, about one step in six', () => {
    expect(BAD_LITTER_ROLL).toBe(10_922);
    const w = pathWorld();
    for (let i = 0; i < 5; i++) dropLitter(w, 8, 6, LitterKind.Trash);
    // One tile with five pieces counts as three: enough alone.
    const fired = arrivals(w, [8], 1200, GuestThought.BadLitter);
    expect(fired / 1200).toBeGreaterThan(0.12);
    expect(fired / 1200).toBeLessThan(0.21);
  });

  it('adds the counts of the last three tiles', () => {
    const w = pathWorld();
    dropLitter(w, 6, 6, LitterKind.Trash);
    dropLitter(w, 7, 6, LitterKind.Trash);
    dropLitter(w, 8, 6, LitterKind.Trash);
    // 1 + 1 + 1 = 3 across three consecutive tiles.
    expect(arrivals(w, [6, 7, 8], 1200, GuestThought.BadLitter)).toBeGreaterThan(80);
    // 1 + 1 is only 2.
    expect(arrivals(w, [5, 6, 7], 600, GuestThought.BadLitter)).toBe(0);
  });

  it('lowers the happiness target by 17 when the thought is raised', () => {
    const w = pathWorld();
    for (let i = 0; i < 3; i++) dropLitter(w, 8, 6, LitterKind.Trash);
    expect(PATH_SIGHT_HAPPINESS_LOSS).toBe(17);
    for (let i = 0; i < 200; i++) {
      const slot = guestAt(w, 8, 6);
      w.guests.cols.happinessTarget[slot] = 100;
      noteTileSights(w, slot, w.map.index(8, 6));
      const target = w.guests.cols.happinessTarget[slot];
      expect(hasThought(w, slot, GuestThought.BadLitter) ? target : 83).toBe(83);
      w.guests.despawnSlot(slot);
    }
  });

  it('counts vomit separately as a disgusting path', () => {
    const w = pathWorld();
    for (let i = 0; i < 3; i++) dropLitter(w, 8, 6, LitterKind.Vomit);
    expect(arrivals(w, [8], 1200, GuestThought.PathDisgusting)).toBeGreaterThan(100);
    expect(arrivals(w, [8], 300, GuestThought.BadLitter)).toBe(0);
  });

  it('needs two vandalised tiles in the last six before complaining of vandalism', () => {
    const w = pathWorld();
    for (const x of [8, 9]) {
      setPathAddition(w.map, x, 6, PathAddition.Bench);
      markPathElementBroken(w.map, w.map.pathElement(w.map.index(x, 6), -1));
    }
    expect(arrivals(w, [8, 10], 600, GuestThought.Vandalism)).toBe(0);
    const fired = arrivals(w, [8, 9], 1500, GuestThought.Vandalism);
    expect(fired / 1500).toBeGreaterThan(0.12);
    expect(fired / 1500).toBeLessThan(0.21);
  });

  it('is noticed by guests walking the park, and not once the path is clean', () => {
    const complaints = (cleanFirst: boolean): number => {
      const w = pathWorld();
      for (let x = 9; x <= 14; x++) {
        dropLitter(w, x, 6, LitterKind.Vomit);
        dropLitter(w, x, 6, LitterKind.Vomit);
      }
      if (cleanFirst) while (w.litter.count > 0) w.litter.despawnSlot(0);
      for (let n = 0; n < 12; n++) {
        const slot = guestAt(w, 4 + n, 6);
        w.guests.cols.happinessTarget[slot] = 120;
      }
      for (let tick = 0; tick < 2_000; tick++) {
        w.tick = tick;
        guestSystem.update(w);
      }
      let count = 0;
      for (let slot = 0; slot < w.guests.count; slot++)
        if (hasThought(w, slot, GuestThought.PathDisgusting)) count++;
      return count;
    };
    expect(complaints(false)).toBeGreaterThan(0);
    expect(complaints(true)).toBe(0);
  });
});

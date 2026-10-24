import { describe, expect, it } from 'vitest';
import { Prng } from '../core/prng';
import { Simulation } from '../core/simulation';
import { hashWorld } from '../core/hash';
import { ElementType, OWNED } from './tile-map';
import type { TileMap } from './tile-map';
import { tileFitsGround } from './land';

function checkInvariants(m: TileMap): void {
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      const i = m.index(x, y);
      const cs = [0, 1, 2, 3].map((c) => m.cornerHeight(x, y, c));
      expect(Math.max(...cs) - Math.min(...cs)).toBeLessThanOrEqual(1);
      expect(m.heights[i]).toBe(Math.min(...cs));
      expect(tileFitsGround(m, i)).toBe(true);
      for (let e = m.firstElement(i); e >= 0; e = m.nextElement(e)) {
        if (m.elType[e] !== ElementType.Path) continue;
        for (let d = 0; d < 4; d++) {
          const n = m.neighbor(i, d);
          if (!(m.pathEdgesOf(e) & (1 << d))) continue;
          expect(n).toBeGreaterThanOrEqual(0);
          let back = false;
          for (let f = m.firstElement(n); f >= 0; f = m.nextElement(f)) {
            if (m.elType[f] === ElementType.Path && m.pathEdgesOf(f) & (1 << ((d + 2) & 3)))
              back = true;
          }
          expect(back).toBe(true);
        }
      }
    }
  }
}

function fuzz(seed: number): Simulation {
  const sim = new Simulation({ seed, width: 24, height: 24, maxGuests: 10 });
  sim.world.map.ownership.fill(OWNED);
  const r = new Prng(seed * 7 + 1);
  for (let step = 0; step < 40; step++) {
    for (let k = 0; k < 12; k++) {
      const x = r.int(24);
      const y = r.int(24);
      switch (r.int(6)) {
        case 0:
          sim.enqueue({ type: 'raiseLand', x, y, width: 1 + r.int(3), height: 1 + r.int(3) });
          break;
        case 1:
          sim.enqueue({
            type: 'lowerLand',
            x,
            y,
            width: 1 + r.int(3),
            height: 1 + r.int(3),
            corner: r.int(2) ? r.int(4) : undefined,
          });
          break;
        case 2:
        case 3:
          sim.enqueue({
            type: 'placePath',
            x,
            y,
            slope: r.int(3) === 0 ? r.int(4) : undefined,
            z: r.int(2) ? undefined : sim.world.map.heights[sim.world.map.index(x, y)] + r.int(4),
          });
          break;
        case 4:
          sim.enqueue({ type: 'removePath', x, y });
          break;
        default:
          sim.enqueue({ type: 'setWater', x, y, width: 2, height: 2, level: r.int(8) });
      }
    }
    sim.step();
  }
  return sim;
}

describe('map invariants under random commands', () => {
  it.each([1, 2, 3, 4])(
    'keeps terrain smooth, elements valid and edges symmetric (seed %i)',
    (seed) => {
      const sim = fuzz(seed);
      checkInvariants(sim.world.map);
      expect(sim.world.map.elementCount).toBeGreaterThan(0);
    },
  );

  it('is deterministic', () => {
    expect(hashWorld(fuzz(5).world)).toBe(hashWorld(fuzz(5).world));
  });
});

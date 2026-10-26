import { describe, expect, it } from 'vitest';
import { BANK_DEG, PIECES, PieceId, SAMPLES, TANGENT_ONE, pieceByName } from './catalog';
import { Bank, PieceFlag, Slope } from './track-types';
import { sinCosTurns } from './geometry';
import { TILE_UNITS, Z_STEP } from '../core/constants';

function sampleRange(id: number): [number, number] {
  const p = PIECES[id];
  return [p.sampleStart, p.sampleStart + p.sampleCount - 1];
}

function entryGrad(slope: number): number {
  return slope === Slope.Up25 || slope === Slope.Down25
    ? Math.sign(slope) * 0.5
    : slope === Slope.Flat
      ? 0
      : Math.sign(slope) * 2;
}

describe('track catalog', () => {
  it('lists the required piece families', () => {
    for (const n of [
      'station',
      'flat',
      'up25',
      'down25',
      'up60',
      'down60',
      'flatToUp25',
      'up25ToFlat',
      'flatToDown25',
      'down25ToFlat',
      'up25ToUp60',
      'up60ToUp25',
      'down25ToDown60',
      'down60ToDown25',
      'smallLeft',
      'smallRight',
      'mediumLeft',
      'mediumRight',
      'largeLeft',
      'largeRight',
      'flatToLeftBank',
      'leftBankToFlat',
      'flatToRightBank',
      'rightBankToFlat',
      'leftBank',
      'rightBank',
      'smallLeftBanked',
      'smallRightBanked',
      'mediumLeftBanked',
      'mediumRightBanked',
      'largeLeftBanked',
      'largeRightBanked',
      'verticalLoopLeft',
      'verticalLoopRight',
      'waterSplashDrop',
    ]) {
      expect(pieceByName(n), n).toBeDefined();
    }
  });

  it('assigns dense ids matching table position', () => {
    PIECES.forEach((p, i) => expect(p.id).toBe(i));
    expect(PieceId.Station).toBe(pieceByName('station')!.id);
  });

  it('defines the water splash drop as a descending track element', () => {
    const splash = pieceByName('waterSplashDrop');
    expect(splash).toBeDefined();
    expect(splash?.entrySlope).toBe(Slope.Flat);
    expect(splash?.exitSlope).toBe(Slope.Down25);
  });

  it('starts every piece at the entry point heading +x at its entry slope and bank', () => {
    for (const p of PIECES) {
      const [a] = sampleRange(p.id);
      expect(SAMPLES.x[a], p.name).toBe(0);
      expect(SAMPLES.y[a], p.name).toBe(TILE_UNITS / 2);
      expect(SAMPLES.z[a], p.name).toBe(0);
      const g = entryGrad(p.entrySlope);
      const horiz = SAMPLES.tx[a];
      expect(horiz, p.name).toBeGreaterThan(0);
      expect(SAMPLES.ty[a], p.name).toBe(0);
      expect(Math.abs(SAMPLES.tz[a] / horiz - g), p.name).toBeLessThan(0.05);
      const bank = p.entryBank === 0 ? 0 : p.entryBank === 1 ? -BANK_DEG : BANK_DEG;
      expect(SAMPLES.bank[a], p.name).toBe(bank);
    }
  });

  it('ends at an integer height delta and the declared exit tile', () => {
    for (const p of PIECES) {
      const [, b] = sampleRange(p.id);
      expect(SAMPLES.z[b], p.name).toBe(p.dz * Z_STEP);
      const hd = p.headingDelta;
      const ex = SAMPLES.x[b];
      const ey = SAMPLES.y[b];
      const exitTile =
        hd === 0
          ? [ex / TILE_UNITS, Math.floor(ey / TILE_UNITS)]
          : hd === 1
            ? [Math.floor(ex / TILE_UNITS), ey / TILE_UNITS]
            : hd === 3
              ? [Math.floor(ex / TILE_UNITS), ey / TILE_UNITS - 1]
              : [ex / TILE_UNITS - 1, Math.floor(ey / TILE_UNITS)];
      expect([p.dx, p.dy], p.name).toEqual(exitTile);
    }
  });

  it('exit tangent heading agrees with headingDelta', () => {
    for (const p of PIECES) {
      const [, b] = sampleRange(p.id);
      const want = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ][p.headingDelta];
      const tx = SAMPLES.tx[b];
      const ty = SAMPLES.ty[b];
      const h = Math.hypot(tx, ty);
      expect(tx / h, p.name).toBeCloseTo(want[0], 1);
      expect(ty / h, p.name).toBeCloseTo(want[1], 1);
    }
  });

  it('is C1-continuous across every legal connection (same slope and bank class)', () => {
    let connections = 0;
    for (const a of PIECES) {
      for (const b of PIECES) {
        if (a.exitSlope !== b.entrySlope || a.exitBank !== b.entryBank) continue;
        connections++;
        const [, ea] = sampleRange(a.id);
        const [sb] = sampleRange(b.id);
        // Express a's exit tangent in b's frame (rotate by -headingDelta of a: not needed for
        // the vertical component; compare the pitch ratio and the bank).
        const pa = SAMPLES.tz[ea] / Math.hypot(SAMPLES.tx[ea], SAMPLES.ty[ea]);
        const pb = SAMPLES.tz[sb] / Math.hypot(SAMPLES.tx[sb], SAMPLES.ty[sb]);
        expect(Math.abs(pa - pb), `${a.name}->${b.name}`).toBeLessThan(0.05);
        expect(Math.abs(SAMPLES.bank[ea] - SAMPLES.bank[sb]) % 360, `${a.name}->${b.name}`).toBe(0);
      }
    }
    expect(connections).toBeGreaterThan(100);
  });

  it('keeps sample spacing fine enough for vehicles and tangents unit length', () => {
    for (const p of PIECES) {
      const [a, b] = sampleRange(p.id);
      let len = 0;
      for (let i = a; i < b; i++) {
        const d = Math.hypot(
          SAMPLES.x[i + 1] - SAMPLES.x[i],
          SAMPLES.y[i + 1] - SAMPLES.y[i],
          SAMPLES.z[i + 1] - SAMPLES.z[i],
        );
        expect(d, p.name).toBeLessThanOrEqual(48);
        expect(d, p.name).toBeGreaterThan(0);
        len += d;
      }
      expect(Math.abs(len - p.length), p.name).toBeLessThanOrEqual(b - a);
      for (let i = a; i <= b; i++) {
        const m = Math.hypot(SAMPLES.tx[i], SAMPLES.ty[i], SAMPLES.tz[i]);
        expect(Math.abs(m - TANGENT_ONE), p.name).toBeLessThanOrEqual(2);
      }
    }
  });

  it('mirrors left and right variants', () => {
    for (const base of ['small', 'medium', 'large']) {
      const l = pieceByName(`${base}Left`)!;
      const r = pieceByName(`${base}Right`)!;
      expect(l.dx).toBe(r.dx);
      expect(l.dy).toBe(-r.dy);
      expect(l.headingDelta).toBe(3);
      expect(r.headingDelta).toBe(1);
      expect(l.length).toBe(r.length);
    }
  });

  it('scales curve radius small < medium < large', () => {
    const len = (n: string): number => pieceByName(n)!.length;
    expect(len('smallRight')).toBeLessThan(len('mediumRight'));
    expect(len('mediumRight')).toBeLessThan(len('largeRight'));
  });

  it('banked turns hold their bank class through the piece', () => {
    const p = pieceByName('mediumRightBanked')!;
    const [a, b] = sampleRange(p.id);
    for (let i = a; i <= b; i++) expect(SAMPLES.bank[i]).toBe(BANK_DEG);
    const q = pieceByName('mediumLeftBanked')!;
    const [c, d] = sampleRange(q.id);
    for (let i = c; i <= d; i++) expect(SAMPLES.bank[i]).toBe(-BANK_DEG);
  });

  it('bank transitions ramp monotonically', () => {
    const p = pieceByName('flatToRightBank')!;
    const [a, b] = sampleRange(p.id);
    for (let i = a; i < b; i++) expect(SAMPLES.bank[i + 1]).toBeGreaterThanOrEqual(SAMPLES.bank[i]);
    expect(SAMPLES.bank[b]).toBe(BANK_DEG);
  });

  it('slope pieces have the declared grade', () => {
    const mid = (n: string): number => {
      const p = pieceByName(n)!;
      const [a, b] = sampleRange(p.id);
      const m = Math.floor((a + b) / 2);
      return SAMPLES.tz[m] / SAMPLES.tx[m];
    };
    expect(mid('up25')).toBeCloseTo(0.5, 1);
    expect(mid('up60')).toBeCloseTo(2, 1);
    expect(mid('down25')).toBeCloseTo(-0.5, 1);
    expect(mid('flat')).toBe(0);
  });

  it('makes the vertical loop go fully inverted without self-intersecting', () => {
    const p = pieceByName('verticalLoopRight')!;
    const [a, b] = sampleRange(p.id);
    let minTx = Infinity;
    let maxZ = 0;
    for (let i = a; i <= b; i++) {
      minTx = Math.min(minTx, SAMPLES.tx[i]);
      maxZ = Math.max(maxZ, SAMPLES.z[i]);
    }
    expect(minTx).toBeLessThan(0);
    expect(maxZ).toBeGreaterThanOrEqual(4 * Z_STEP);
    expect(p.dz).toBe(0);
    expect(Math.abs(p.dy)).toBe(1);
    expect(Math.min(...p.footprint.map((c) => c.i))).toBeGreaterThanOrEqual(0);
    for (let i = a; i <= b; i++) {
      for (let j = i + 4; j <= b; j++) {
        const d = Math.hypot(
          SAMPLES.x[i] - SAMPLES.x[j],
          SAMPLES.y[i] - SAMPLES.y[j],
          SAMPLES.z[i] - SAMPLES.z[j],
        );
        expect(d).toBeGreaterThan(24);
      }
    }
  });
});

describe('PieceId', () => {
  it('names every catalog entry', () => {
    const byId = new Map<number, string>(
      Object.entries(PieceId).map(([k, v]) => [v, k.toLowerCase()]),
    );
    expect(byId.size).toBe(PIECES.length);
    for (const p of PIECES) expect(byId.get(p.id)).toBe(p.name.toLowerCase());
  });
});

describe('corkscrew, helix, S-bend and banked slope pieces', () => {
  const sampled = (name: string) => {
    const p = pieceByName(name)!;
    const [a, b] = sampleRange(p.id);
    return { p, a, b };
  };

  it('keeps piece ids stable: new pieces are appended after the original 34', () => {
    expect(PieceId.VerticalLoopRight).toBe(33);
    expect(PieceId.SBendLeft).toBe(34);
    expect(PieceId.WaterSplashDrop).toBe(66);
    expect(PIECES.length).toBe(91);
  });

  it('provides small, medium and large curves on gentle slopes in each bank state', () => {
    for (const size of ['small', 'medium', 'large'])
      for (const turn of ['Left', 'Right'])
        for (const slope of ['Up25', 'Down25'])
          for (const bank of ['', `${turn}Banked`]) {
            const name = `${size}${turn}${bank}${slope}`;
            const { p, a, b } = sampled(name);
            const sign = slope === 'Up25' ? 1 : -1;
            expect(p.entrySlope, name).toBe(sign);
            expect(p.exitSlope, name).toBe(sign);
            expect(p.entryBank, name).toBe(
              bank === 'LeftBanked' ? Bank.Left : bank ? Bank.Right : Bank.None,
            );
            expect(p.exitBank, name).toBe(p.entryBank);
            const horizontalLength = Array.from({ length: b - a }, (_, i) =>
              Math.hypot(
                SAMPLES.x[a + i + 1]! - SAMPLES.x[a + i]!,
                SAMPLES.y[a + i + 1]! - SAMPLES.y[a + i]!,
              ),
            ).reduce((sum, length) => sum + length, 0);
            expect(
              Math.abs(Math.abs(p.dz * Z_STEP) - horizontalLength * 0.5),
              name,
            ).toBeLessThanOrEqual(Z_STEP / 2);
            expect(SAMPLES.z[b], name).toBe(p.dz * Z_STEP);
            expect(
              SAMPLES.tz[a] / Math.hypot(SAMPLES.tx[a]!, SAMPLES.ty[a]!),
              `${name} entry grade`,
            ).toBeCloseTo(sign * 0.5, 1);
            expect(
              SAMPLES.tz[b] / Math.hypot(SAMPLES.tx[b]!, SAMPLES.ty[b]!),
              `${name} exit grade`,
            ).toBeCloseTo(sign * 0.5, 1);
            const heights = Array.from({ length: b - a + 1 }, (_, i) => SAMPLES.z[a + i]);
            expect(
              heights.every(
                (z, i) => i === 0 || (sign > 0 ? z >= heights[i - 1] : z <= heights[i - 1]),
              ),
              name,
            ).toBe(true);
          }
  });

  it('evaluates sine and cosine without Math.sin so tables match on every engine', () => {
    for (let i = 0; i <= 64; i++) {
      const turns = i / 64;
      const { sin, cos } = sinCosTurns(turns);
      expect(sin).toBeCloseTo(Math.sin(2 * Math.PI * turns), 12);
      expect(cos).toBeCloseTo(Math.cos(2 * Math.PI * turns), 12);
    }
  });

  it('shifts an S-bend one tile sideways without turning the heading', () => {
    for (const [name, sign] of [
      ['sBendLeft', -1],
      ['sBendRight', 1],
    ] as const) {
      const { p, b } = sampled(name);
      expect(p.headingDelta).toBe(0);
      expect(p.dy).toBe(sign);
      expect(SAMPLES.y[b] - TILE_UNITS / 2).toBe(sign * TILE_UNITS);
      expect(SAMPLES.ty[b]).toBe(0);
    }
  });

  it('rolls the rider a full turn in a corkscrew, upside down at the top, and flags it inverted', () => {
    for (const [name, sign] of [
      ['corkscrewLeft', -1],
      ['corkscrewRight', 1],
    ] as const) {
      const { p, a, b } = sampled(name);
      expect(p.flags & PieceFlag.Inverted).not.toBe(0);
      expect(p.entryBank).toBe(Bank.None);
      expect(p.exitBank).toBe(Bank.None);
      expect(SAMPLES.bank[b]).toBe(sign * 360);
      let top = a;
      for (let i = a; i <= b; i++) if (SAMPLES.z[i] > SAMPLES.z[top]) top = i;
      expect(Math.abs(SAMPLES.bank[top])).toBeGreaterThanOrEqual(170);
      expect(Math.abs(SAMPLES.bank[top])).toBeLessThanOrEqual(190);
      expect(SAMPLES.z[top]).toBeGreaterThanOrEqual(Z_STEP);
      expect(SAMPLES.z[b]).toBe(0);
    }
  });

  it('winds helices a full circle, banked on entry and exit, changing height smoothly', () => {
    for (const p of PIECES.filter((q) => q.name.includes('Helix'))) {
      const up = p.name.endsWith('Up');
      expect(p.dz, p.name).toBe((up ? 1 : -1) * (p.name.startsWith('small') ? 4 : 6));
      expect(p.entryBank).toBe(p.name.includes('Left') ? Bank.Left : Bank.Right);
      expect(p.exitBank).toBe(p.entryBank);
      expect(p.entrySlope).toBe(Slope.Flat);
      expect(p.exitSlope).toBe(Slope.Flat);
      expect(p.dy).toBe(0);
      const xs = Array.from({ length: p.sampleCount }, (_, i) => SAMPLES.x[p.sampleStart + i]);
      expect(Math.min(...xs), p.name).toBeGreaterThanOrEqual(0);
      expect(p.footprint.every((c) => c.i >= 0)).toBe(true);
    }
  });

  it('lets every slope be banked and every bank change happen on a slope', () => {
    const edges = new Set(
      PIECES.map((q) => `${q.entrySlope}/${q.entryBank}>${q.exitSlope}/${q.exitBank}`),
    );
    for (const bank of [Bank.Left, Bank.Right]) {
      for (const slope of [Slope.Up25, Slope.Down25]) {
        expect(edges.has(`${slope}/${bank}>${slope}/${bank}`)).toBe(true);
        expect(edges.has(`${slope}/${Bank.None}>${slope}/${bank}`)).toBe(true);
        expect(edges.has(`${slope}/${bank}>${slope}/${Bank.None}`)).toBe(true);
        expect(edges.has(`${Slope.Flat}/${bank}>${slope}/${bank}`)).toBe(true);
        expect(edges.has(`${slope}/${bank}>${Slope.Flat}/${bank}`)).toBe(true);
      }
    }
  });
});

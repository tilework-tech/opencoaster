import { describe, expect, it } from 'vitest';
import { BANK_DEG, PIECES, PieceId, SAMPLES, TANGENT_ONE, pieceByName } from './catalog';
import { Slope } from './track-types';
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
    ]) {
      expect(pieceByName(n), n).toBeDefined();
    }
  });

  it('assigns dense ids matching table position', () => {
    PIECES.forEach((p, i) => expect(p.id).toBe(i));
    expect(PieceId.Station).toBe(pieceByName('station')!.id);
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
        expect(SAMPLES.bank[ea], `${a.name}->${b.name}`).toBe(SAMPLES.bank[sb]);
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

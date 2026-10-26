import { TILE_UNITS, Z_STEP } from '../core/constants';
import { Bank, PieceFlag, Slope } from './track-types';
import type { FootprintCell, PieceShape, TrackPieceDef } from './track-types';
import {
  arcCurve,
  corkscrewCurve,
  helixCurve,
  loopCurve,
  sBendCurve,
  smoothBank,
  straightCurve,
  withProfile,
  type Curve,
} from './geometry';

/** Roll angle of a banked piece, in degrees. Left banks are negative. */
export const BANK_DEG = 60;
/** Fixed-point scale of the tangent vectors stored in SAMPLES. */
export const TANGENT_ONE = 1024;
/** Target distance between consecutive centre-line points, in TILE_UNITS. */
export const SAMPLE_SPACING = 32;

const HALF = TILE_UNITS / 2;
/** Rise per unit of horizontal run for each slope class. */
const GRADE: Record<number, number> = {
  [Slope.Down60]: -2,
  [Slope.Down25]: -0.5,
  [Slope.Flat]: 0,
  [Slope.Up25]: 0.5,
  [Slope.Up60]: 2,
};
const BANK_ANGLE: Record<number, number> = {
  [Bank.None]: 0,
  [Bank.Left]: -BANK_DEG,
  [Bank.Right]: BANK_DEG,
};

const S_BEND_LENGTH = 5 * TILE_UNITS;
const CORKSCREW_LENGTH = 5 * TILE_UNITS;
const CORKSCREW_RADIUS = 64;

const LOOP_RADIUS = 160;
const LOOP_DRIFT = TILE_UNITS;
const LOOP_LATERAL = TILE_UNITS;
/** Free height above the highest centre-line point of a tile that other track may not enter. */
export const CLEARANCE_UNITS = 3 * Z_STEP;

type Horizontal =
  | { kind: 'straight' }
  | { kind: 'arc'; radiusTiles: number; side: 1 | -1 }
  | { kind: 'loop'; side: 1 | -1 }
  | { kind: 'sBend'; side: 1 | -1 }
  | { kind: 'corkscrew'; side: 1 | -1 }
  | { kind: 'helix'; radiusTiles: number; driftTiles: number; side: 1 | -1; rise: number };

interface Spec {
  name: string;
  horizontal: Horizontal;
  entrySlope?: Slope;
  exitSlope?: Slope;
  entryBank?: Bank;
  exitBank?: Bank;
  flags?: number;
  cost: number;
}

const BASIC = PieceFlag.TunnelOk;
const LIFTABLE = PieceFlag.LiftOk | PieceFlag.TunnelOk;

const S = (
  name: string,
  entrySlope: Slope,
  exitSlope: Slope,
  flags: number = BASIC,
  cost = 1200,
): Spec => ({ name, horizontal: { kind: 'straight' }, entrySlope, exitSlope, flags, cost });

const turn = (name: string, radiusTiles: number, side: 1 | -1, banked: boolean): Spec => {
  const bank = banked ? (side === 1 ? Bank.Right : Bank.Left) : Bank.None;
  return {
    name,
    horizontal: { kind: 'arc', radiusTiles, side },
    entryBank: bank,
    exitBank: bank,
    flags: banked ? 0 : BASIC,
    cost: 1500 + radiusTiles * 400,
  };
};

const bankOf = (side: 1 | -1): Bank => (side === 1 ? Bank.Right : Bank.Left);

/** A straight (slope or level) whose bank class stays constant. */
const bankedStraight = (
  name: string,
  side: 1 | -1,
  entrySlope: Slope,
  exitSlope: Slope,
  flags = 0,
): Spec => ({
  name,
  horizontal: { kind: 'straight' },
  entrySlope,
  exitSlope,
  entryBank: bankOf(side),
  exitBank: bankOf(side),
  flags,
  cost: 1500,
});

/** A bank transition laid on a constant slope. */
const bankChangeOnSlope = (name: string, slope: Slope, entryBank: Bank, exitBank: Bank): Spec => ({
  name,
  horizontal: { kind: 'straight' },
  entrySlope: slope,
  exitSlope: slope,
  entryBank,
  exitBank,
  flags: 0,
  cost: 1600,
});

const helix = (
  name: string,
  radiusTiles: number,
  driftTiles: number,
  side: 1 | -1,
  rise: number,
): Spec => ({
  name,
  horizontal: { kind: 'helix', radiusTiles, driftTiles, side, rise },
  entryBank: bankOf(side),
  exitBank: bankOf(side),
  flags: 0,
  cost: 3500 + radiusTiles * 1200,
});

const slopedTurn = (
  size: string,
  radiusTiles: number,
  side: 1 | -1,
  slope: Slope.Up25 | Slope.Down25,
  bank: Bank,
): Spec => {
  const turn = side < 0 ? 'Left' : 'Right';
  const bankName = bank === Bank.Left ? 'LeftBanked' : bank === Bank.Right ? 'RightBanked' : '';
  const slopeName = slope === Slope.Up25 ? 'Up25' : 'Down25';
  return {
    name: `${size}${turn}${bankName}${slopeName}`,
    horizontal: { kind: 'arc', radiusTiles, side },
    entrySlope: slope,
    exitSlope: slope,
    entryBank: bank,
    exitBank: bank,
    flags: bank === Bank.None ? BASIC : 0,
    cost: 1800 + radiusTiles * 500,
  };
};

const SLOPED_TURNS: Spec[] = [1.5, 2.5, 3.5].flatMap((radiusTiles, index) => {
  const size = ['small', 'medium', 'large'][index]!;
  return ([-1, 1] as const).flatMap((side) =>
    ([Slope.Up25, Slope.Down25] as const).flatMap((slope) =>
      ([Bank.None, bankOf(side)] as const).map((bank) =>
        slopedTurn(size, radiusTiles, side, slope, bank),
      ),
    ),
  );
});

const SPECS: Spec[] = [
  {
    name: 'station',
    horizontal: { kind: 'straight' },
    flags: PieceFlag.Station,
    cost: 2000,
  },
  S('flat', Slope.Flat, Slope.Flat, LIFTABLE | PieceFlag.BrakeOk | PieceFlag.LaunchOk),
  S('up25', Slope.Up25, Slope.Up25, LIFTABLE),
  S('down25', Slope.Down25, Slope.Down25),
  S('up60', Slope.Up60, Slope.Up60, LIFTABLE, 2400),
  S('down60', Slope.Down60, Slope.Down60, BASIC, 2400),
  S('flatToUp25', Slope.Flat, Slope.Up25, LIFTABLE),
  S('up25ToFlat', Slope.Up25, Slope.Flat, LIFTABLE | PieceFlag.Crest),
  S('flatToDown25', Slope.Flat, Slope.Down25, BASIC | PieceFlag.DropStart),
  S('down25ToFlat', Slope.Down25, Slope.Flat),
  S('up25ToUp60', Slope.Up25, Slope.Up60, LIFTABLE, 2000),
  S('up60ToUp25', Slope.Up60, Slope.Up25, LIFTABLE, 2000),
  S('down25ToDown60', Slope.Down25, Slope.Down60, BASIC | PieceFlag.DropStart, 2000),
  S('down60ToDown25', Slope.Down60, Slope.Down25, BASIC, 2000),
  turn('smallLeft', 1.5, -1, false),
  turn('smallRight', 1.5, 1, false),
  turn('mediumLeft', 2.5, -1, false),
  turn('mediumRight', 2.5, 1, false),
  turn('largeLeft', 3.5, -1, false),
  turn('largeRight', 3.5, 1, false),
  {
    name: 'flatToLeftBank',
    horizontal: { kind: 'straight' },
    exitBank: Bank.Left,
    flags: 0,
    cost: 1400,
  },
  {
    name: 'leftBankToFlat',
    horizontal: { kind: 'straight' },
    entryBank: Bank.Left,
    flags: 0,
    cost: 1400,
  },
  {
    name: 'flatToRightBank',
    horizontal: { kind: 'straight' },
    exitBank: Bank.Right,
    flags: 0,
    cost: 1400,
  },
  {
    name: 'rightBankToFlat',
    horizontal: { kind: 'straight' },
    entryBank: Bank.Right,
    flags: 0,
    cost: 1400,
  },
  {
    name: 'leftBank',
    horizontal: { kind: 'straight' },
    entryBank: Bank.Left,
    exitBank: Bank.Left,
    flags: 0,
    cost: 1300,
  },
  {
    name: 'rightBank',
    horizontal: { kind: 'straight' },
    entryBank: Bank.Right,
    exitBank: Bank.Right,
    flags: 0,
    cost: 1300,
  },
  turn('smallLeftBanked', 1.5, -1, true),
  turn('smallRightBanked', 1.5, 1, true),
  turn('mediumLeftBanked', 2.5, -1, true),
  turn('mediumRightBanked', 2.5, 1, true),
  turn('largeLeftBanked', 3.5, -1, true),
  turn('largeRightBanked', 3.5, 1, true),
  {
    name: 'verticalLoopLeft',
    horizontal: { kind: 'loop', side: -1 },
    flags: PieceFlag.Inverted,
    cost: 9000,
  },
  {
    name: 'verticalLoopRight',
    horizontal: { kind: 'loop', side: 1 },
    flags: PieceFlag.Inverted,
    cost: 9000,
  },
  { name: 'sBendLeft', horizontal: { kind: 'sBend', side: -1 }, flags: BASIC, cost: 2400 },
  { name: 'sBendRight', horizontal: { kind: 'sBend', side: 1 }, flags: BASIC, cost: 2400 },
  {
    name: 'corkscrewLeft',
    horizontal: { kind: 'corkscrew', side: -1 },
    flags: PieceFlag.Inverted,
    cost: 7000,
  },
  {
    name: 'corkscrewRight',
    horizontal: { kind: 'corkscrew', side: 1 },
    flags: PieceFlag.Inverted,
    cost: 7000,
  },
  helix('smallHelixLeftDown', 1.5, 3, -1, -4),
  helix('smallHelixRightDown', 1.5, 3, 1, -4),
  helix('smallHelixLeftUp', 1.5, 3, -1, 4),
  helix('smallHelixRightUp', 1.5, 3, 1, 4),
  helix('largeHelixLeftDown', 2.5, 4, -1, -6),
  helix('largeHelixRightDown', 2.5, 4, 1, -6),
  helix('largeHelixLeftUp', 2.5, 4, -1, 6),
  helix('largeHelixRightUp', 2.5, 4, 1, 6),
  ...([-1, 1] as const).flatMap((side) => {
    const n = side === -1 ? 'left' : 'right';
    const N = side === -1 ? 'Left' : 'Right';
    return [
      bankedStraight(`${n}BankUp25`, side, Slope.Up25, Slope.Up25),
      bankedStraight(`${n}BankDown25`, side, Slope.Down25, Slope.Down25),
      bankedStraight(`${n}BankFlatToUp25`, side, Slope.Flat, Slope.Up25),
      bankedStraight(`${n}BankUp25ToFlat`, side, Slope.Up25, Slope.Flat, PieceFlag.Crest),
      bankedStraight(`${n}BankFlatToDown25`, side, Slope.Flat, Slope.Down25, PieceFlag.DropStart),
      bankedStraight(`${n}BankDown25ToFlat`, side, Slope.Down25, Slope.Flat),
      bankChangeOnSlope(`up25FlatTo${N}Bank`, Slope.Up25, Bank.None, bankOf(side)),
      bankChangeOnSlope(`up25${N}BankToFlat`, Slope.Up25, bankOf(side), Bank.None),
      bankChangeOnSlope(`down25FlatTo${N}Bank`, Slope.Down25, Bank.None, bankOf(side)),
      bankChangeOnSlope(`down25${N}BankToFlat`, Slope.Down25, bankOf(side), Bank.None),
    ];
  }),
  {
    name: 'waterSplashDrop',
    horizontal: { kind: 'straight' },
    entrySlope: Slope.Flat,
    exitSlope: Slope.Down25,
    flags: PieceFlag.DropStart | PieceFlag.WaterSplash,
    cost: 2400,
  },
  ...SLOPED_TURNS,
];

export const PieceId = {
  Station: 0,
  Flat: 1,
  Up25: 2,
  Down25: 3,
  Up60: 4,
  Down60: 5,
  FlatToUp25: 6,
  Up25ToFlat: 7,
  FlatToDown25: 8,
  Down25ToFlat: 9,
  Up25ToUp60: 10,
  Up60ToUp25: 11,
  Down25ToDown60: 12,
  Down60ToDown25: 13,
  SmallLeft: 14,
  SmallRight: 15,
  MediumLeft: 16,
  MediumRight: 17,
  LargeLeft: 18,
  LargeRight: 19,
  FlatToLeftBank: 20,
  LeftBankToFlat: 21,
  FlatToRightBank: 22,
  RightBankToFlat: 23,
  LeftBank: 24,
  RightBank: 25,
  SmallLeftBanked: 26,
  SmallRightBanked: 27,
  MediumLeftBanked: 28,
  MediumRightBanked: 29,
  LargeLeftBanked: 30,
  LargeRightBanked: 31,
  VerticalLoopLeft: 32,
  VerticalLoopRight: 33,
  SBendLeft: 34,
  SBendRight: 35,
  CorkscrewLeft: 36,
  CorkscrewRight: 37,
  SmallHelixLeftDown: 38,
  SmallHelixRightDown: 39,
  SmallHelixLeftUp: 40,
  SmallHelixRightUp: 41,
  LargeHelixLeftDown: 42,
  LargeHelixRightDown: 43,
  LargeHelixLeftUp: 44,
  LargeHelixRightUp: 45,
  LeftBankUp25: 46,
  LeftBankDown25: 47,
  LeftBankFlatToUp25: 48,
  LeftBankUp25ToFlat: 49,
  LeftBankFlatToDown25: 50,
  LeftBankDown25ToFlat: 51,
  Up25FlatToLeftBank: 52,
  Up25LeftBankToFlat: 53,
  Down25FlatToLeftBank: 54,
  Down25LeftBankToFlat: 55,
  RightBankUp25: 56,
  RightBankDown25: 57,
  RightBankFlatToUp25: 58,
  RightBankUp25ToFlat: 59,
  RightBankFlatToDown25: 60,
  RightBankDown25ToFlat: 61,
  Up25FlatToRightBank: 62,
  Up25RightBankToFlat: 63,
  Down25FlatToRightBank: 64,
  Down25RightBankToFlat: 65,
  WaterSplashDrop: 66,
  SmallLeftUp25: 67,
  SmallLeftLeftBankedUp25: 68,
  SmallLeftDown25: 69,
  SmallLeftLeftBankedDown25: 70,
  SmallRightUp25: 71,
  SmallRightRightBankedUp25: 72,
  SmallRightDown25: 73,
  SmallRightRightBankedDown25: 74,
  MediumLeftUp25: 75,
  MediumLeftLeftBankedUp25: 76,
  MediumLeftDown25: 77,
  MediumLeftLeftBankedDown25: 78,
  MediumRightUp25: 79,
  MediumRightRightBankedUp25: 80,
  MediumRightDown25: 81,
  MediumRightRightBankedDown25: 82,
  LargeLeftUp25: 83,
  LargeLeftLeftBankedUp25: 84,
  LargeLeftDown25: 85,
  LargeLeftLeftBankedDown25: 86,
  LargeRightUp25: 87,
  LargeRightRightBankedUp25: 88,
  LargeRightDown25: 89,
  LargeRightRightBankedDown25: 90,
} as const;

/** Shared centre-line point table, struct-of-arrays over every piece's samples. */
export interface SampleTable {
  /** Position relative to the origin tile's corner (x, y) and the entry height (z), TILE_UNITS. */
  x: Int32Array;
  y: Int32Array;
  z: Int32Array;
  /** Unit tangent in the local frame, scaled by TANGENT_ONE. */
  tx: Int16Array;
  ty: Int16Array;
  tz: Int16Array;
  /** Roll in degrees (positive rolls right). */
  bank: Int16Array;
}

function buildCurve(spec: Spec): { curve: Curve; dz: number; headingDelta: number } {
  const g0 = GRADE[spec.entrySlope ?? Slope.Flat];
  const g1 = GRADE[spec.exitSlope ?? Slope.Flat];
  const h = spec.horizontal;
  if (h.kind === 'loop') {
    return {
      curve: loopCurve(LOOP_RADIUS, LOOP_DRIFT, h.side * LOOP_LATERAL, HALF),
      dz: 0,
      headingDelta: 0,
    };
  }
  if (h.kind === 'sBend') {
    return {
      curve: sBendCurve(S_BEND_LENGTH, h.side * TILE_UNITS, HALF),
      dz: 0,
      headingDelta: 0,
    };
  }
  if (h.kind === 'corkscrew') {
    return {
      curve: corkscrewCurve(CORKSCREW_LENGTH, CORKSCREW_RADIUS, h.side, HALF),
      dz: 0,
      headingDelta: 0,
    };
  }
  if (h.kind === 'helix') {
    const base = helixCurve(h.radiusTiles * TILE_UNITS, h.driftTiles * TILE_UNITS, h.side, HALF);
    return { curve: withProfile(base, h.rise * Z_STEP, 0, 0), dz: h.rise, headingDelta: 0 };
  }
  if (h.kind === 'arc') {
    const base = arcCurve(h.radiusTiles * TILE_UNITS, h.side, HALF);
    if (g0 !== 0 || g1 !== 0) {
      let horizontalLength = 0;
      let previous = base.pos(0);
      for (let i = 1; i <= 1024; i++) {
        const point = base.pos(i / 1024);
        horizontalLength += Math.hypot(point.x - previous.x, point.y - previous.y);
        previous = point;
      }
      const rise = (horizontalLength * (g0 + g1)) / 2;
      const dz = Math.round(rise / Z_STEP);
      return {
        curve: withProfile(base, dz * Z_STEP, g0, g1),
        dz,
        headingDelta: h.side === 1 ? 1 : 3,
      };
    }
    return {
      curve: base,
      dz: 0,
      headingDelta: h.side === 1 ? 1 : 3,
    };
  }
  const rise = (TILE_UNITS * (g0 + g1)) / 2;
  const dz = rise / Z_STEP;
  if (!Number.isInteger(dz)) throw new Error(`piece ${spec.name}: rise is not whole height levels`);
  return {
    curve: withProfile(straightCurve(TILE_UNITS, HALF), rise, g0, g1),
    dz,
    headingDelta: 0,
  };
}

const CURVE_SIZE: Record<number, string> = { 1.5: 'small', 2.5: 'medium', 3.5: 'large' };

function shapeOf(spec: Spec): PieceShape {
  if (spec.name === 'waterSplashDrop') return 'waterSplashDrop';
  const h = spec.horizontal;
  const side = (h.kind !== 'straight' && h.side === 1 ? 'Right' : 'Left') as 'Left' | 'Right';
  switch (h.kind) {
    case 'straight':
      return spec.flags !== undefined && spec.flags & PieceFlag.Station ? 'station' : 'straight';
    case 'arc':
      return `${CURVE_SIZE[h.radiusTiles]}${side}` as PieceShape;
    case 'loop':
      return `loop${side}`;
    case 'sBend':
      return `sBend${side}`;
    case 'corkscrew':
      return `corkscrew${side}`;
    case 'helix':
      return `${h.radiusTiles < 2 ? 'small' : 'large'}Helix${side}${h.rise > 0 ? 'Up' : 'Down'}` as PieceShape;
  }
}

function exitTile(ex: number, ey: number, heading: number): [number, number] {
  switch (heading) {
    case 0:
      return [ex / TILE_UNITS, Math.floor(ey / TILE_UNITS)];
    case 1:
      return [Math.floor(ex / TILE_UNITS), ey / TILE_UNITS];
    case 2:
      return [ex / TILE_UNITS - 1, Math.floor(ey / TILE_UNITS)];
    default:
      return [Math.floor(ex / TILE_UNITS), ey / TILE_UNITS - 1];
  }
}

interface Built {
  def: Omit<TrackPieceDef, 'id' | 'sampleStart'>;
  x: number[];
  y: number[];
  z: number[];
  tx: number[];
  ty: number[];
  tz: number[];
  bank: number[];
}

function build(spec: Spec): Built {
  const { curve, dz, headingDelta } = buildCurve(spec);
  const b0 = BANK_ANGLE[spec.entryBank ?? Bank.None];
  const b1 = BANK_ANGLE[spec.exitBank ?? Bank.None];

  // Cumulative 3D arclength on a fine grid, inverted to place samples at equal spacing.
  const grid = 1024;
  const cum = new Array<number>(grid + 1);
  cum[0] = 0;
  let prev = curve.pos(0);
  for (let i = 1; i <= grid; i++) {
    const p = curve.pos(i / grid);
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const dzz = p.z - prev.z;
    cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dy * dy + dzz * dzz);
    prev = p;
  }
  const total = cum[grid];
  const n = Math.max(2, Math.ceil(total / SAMPLE_SPACING));

  const out: Built = { def: null as never, x: [], y: [], z: [], tx: [], ty: [], tz: [], bank: [] };
  let cursor = 0;
  for (let i = 0; i <= n; i++) {
    let u: number;
    if (i === 0) u = 0;
    else if (i === n) u = 1;
    else {
      const target = (total * i) / n;
      while (cum[cursor + 1] < target) cursor++;
      const f = (target - cum[cursor]) / (cum[cursor + 1] - cum[cursor]);
      u = (cursor + f) / grid;
    }
    const p = curve.pos(u);
    const v = curve.vel(u);
    const m = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    out.x.push(Math.round(p.x));
    out.y.push(Math.round(p.y));
    out.z.push(Math.round(p.z));
    out.tx.push(Math.round((v.x / m) * TANGENT_ONE));
    out.ty.push(Math.round((v.y / m) * TANGENT_ONE));
    out.tz.push(Math.round((v.z / m) * TANGENT_ONE));
    out.bank.push(Math.round(curve.bank ? curve.bank(u) : smoothBank(b0, b1, u)));
  }

  let length = 0;
  for (let i = 0; i < n; i++) {
    length += Math.round(
      Math.sqrt(
        (out.x[i + 1] - out.x[i]) ** 2 +
          (out.y[i + 1] - out.y[i]) ** 2 +
          (out.z[i + 1] - out.z[i]) ** 2,
      ),
    );
  }

  const cells = new Map<number, FootprintCell>();
  for (let i = 0; i < n; i++) {
    const ci = Math.floor(out.x[i] / TILE_UNITS);
    const cj = Math.floor(out.y[i] / TILE_UNITS);
    const key = ci * 4096 + cj;
    const cell = cells.get(key);
    if (cell) {
      cell.zMin = Math.min(cell.zMin, out.z[i]);
      cell.zMax = Math.max(cell.zMax, out.z[i]);
    } else cells.set(key, { i: ci, j: cj, zMin: out.z[i], zMax: out.z[i] });
  }
  const footprint = [...cells.values()].sort((a, b) => a.i - b.i || a.j - b.j);

  const [tdx, tdy] = exitTile(out.x[n], out.y[n], headingDelta);
  out.def = {
    name: spec.name,
    shape: shapeOf(spec),
    flags: spec.flags ?? 0,
    entrySlope: spec.entrySlope ?? Slope.Flat,
    exitSlope: spec.exitSlope ?? Slope.Flat,
    entryBank: spec.entryBank ?? Bank.None,
    exitBank: spec.exitBank ?? Bank.None,
    headingDelta,
    dx: tdx,
    dy: tdy,
    dz,
    cost: spec.cost,
    length,
    sampleCount: n + 1,
    footprint,
  };
  return out;
}

function buildCatalog(): { pieces: TrackPieceDef[]; samples: SampleTable } {
  const built = SPECS.map(build);
  const total = built.reduce((a, b) => a + b.x.length, 0);
  const samples: SampleTable = {
    x: new Int32Array(total),
    y: new Int32Array(total),
    z: new Int32Array(total),
    tx: new Int16Array(total),
    ty: new Int16Array(total),
    tz: new Int16Array(total),
    bank: new Int16Array(total),
  };
  const pieces: TrackPieceDef[] = [];
  let at = 0;
  built.forEach((b, id) => {
    pieces.push({ ...b.def, id, sampleStart: at });
    for (let i = 0; i < b.x.length; i++, at++) {
      samples.x[at] = b.x[i];
      samples.y[at] = b.y[i];
      samples.z[at] = b.z[i];
      samples.tx[at] = b.tx[i];
      samples.ty[at] = b.ty[i];
      samples.tz[at] = b.tz[i];
      samples.bank[at] = b.bank[i];
    }
  });
  return { pieces, samples };
}

const catalog = buildCatalog();
export const PIECES: readonly TrackPieceDef[] = catalog.pieces;
export const SAMPLES: SampleTable = catalog.samples;

/** Track geometry supported by transport art, including the small turns used by normal circuits. */
const TRANSPORT_TURNS = new Set(['smallLeft', 'smallRight']);
export const TRANSPORT_PIECES: readonly TrackPieceDef[] = PIECES.filter(
  (piece) =>
    !(piece.flags & PieceFlag.Inverted) &&
    Math.abs(piece.entrySlope) < Math.abs(Slope.Up60) &&
    Math.abs(piece.exitSlope) < Math.abs(Slope.Up60) &&
    (piece.headingDelta === 0 || TRANSPORT_TURNS.has(piece.name)) &&
    piece.entryBank === Bank.None &&
    piece.exitBank === Bank.None,
);

const BY_NAME = new Map(PIECES.map((p) => [p.name, p]));
export function pieceByName(name: string): TrackPieceDef | undefined {
  return BY_NAME.get(name);
}

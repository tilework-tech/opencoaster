/**
 * Build-time curve evaluation for the piece catalog. Only +, -, * , / and sqrt are used so the
 * generated integer tables are identical on every JS engine. Curves are expressed in the piece's
 * local frame: entry at (0, TILE/2) heading +x, z relative to the entry height.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A parametric centre line over u in [0, 1]: position and derivative d/du. */
export interface Curve {
  pos(u: number): Vec3;
  vel(u: number): Vec3;
  /** Roll in degrees at u; when absent the piece's end bank classes are blended instead. */
  bank?(u: number): number;
}

/** Cubic Bezier control-point constant for a quarter circle. */
export const QUARTER_K = 0.5522847498307936;

function bez(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const m = 1 - t;
  return m * m * m * p0 + 3 * m * m * t * p1 + 3 * m * t * t * p2 + t * t * t * p3;
}

function bezD(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const m = 1 - t;
  return 3 * m * m * (p1 - p0) + 6 * m * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

export function straightCurve(lengthUnits: number, y: number): Curve {
  return {
    pos: (u) => ({ x: lengthUnits * u, y, z: 0 }),
    vel: () => ({ x: lengthUnits, y: 0, z: 0 }),
  };
}

/** A quarter-circle turn of radius `radius`; side +1 turns toward +y (right), -1 toward -y. */
export function arcCurve(radius: number, side: 1 | -1, y: number): Curve {
  const k = QUARTER_K * radius;
  const p = [0, k, radius, radius];
  const q = [0, 0, radius - k, radius];
  return {
    pos: (u) => ({
      x: bez(p[0], p[1], p[2], p[3], u),
      y: y + side * bez(q[0], q[1], q[2], q[3], u),
      z: 0,
    }),
    vel: (u) => ({
      x: bezD(p[0], p[1], p[2], p[3], u),
      y: side * bezD(q[0], q[1], q[2], q[3], u),
      z: 0,
    }),
  };
}

/**
 * Vertical loop: four Bezier quadrants of a circle of the given radius in the x-z plane, with a
 * linear forward drift and a smoothstep lateral shift so the entry and exit legs pass side by side.
 */
export function loopCurve(radius: number, drift: number, lateral: number, y: number): Curve {
  const r = radius;
  const k = QUARTER_K * radius;
  // Control points (x, z) per quadrant, starting at the bottom and rising ahead.
  const quads: number[][] = [
    [0, 0, k, 0, r, r - k, r, r],
    [r, r, r, r + k, k, 2 * r, 0, 2 * r],
    [0, 2 * r, -k, 2 * r, -r, r + k, -r, r],
    [-r, r, -r, r - k, -k, 0, 0, 0],
  ];
  const seg = (u: number): { c: number[]; t: number } => {
    const s = u >= 1 ? 3 : Math.floor(u * 4);
    return { c: quads[s], t: u * 4 - s };
  };
  return {
    pos: (u) => {
      const { c, t } = seg(u);
      return {
        x: bez(c[0], c[2], c[4], c[6], t) + drift * u,
        y: y + lateral * (u * u * (3 - 2 * u)),
        z: bez(c[1], c[3], c[5], c[7], t),
      };
    },
    vel: (u) => {
      const { c, t } = seg(u);
      return {
        x: 4 * bezD(c[0], c[2], c[4], c[6], t) + drift,
        y: lateral * 6 * u * (1 - u),
        z: 4 * bezD(c[1], c[3], c[5], c[7], t),
      };
    },
  };
}

const HALF_PI = 1.5707963267948966;
const TWO_PI = 6.283185307179586;

/**
 * Sine and cosine of a fraction `turns` of a full revolution, from Taylor series on the first
 * quadrant using only + - * / so the result is bit-identical on every engine (Math.sin is not).
 */
export function sinCosTurns(turns: number): { sin: number; cos: number } {
  const q4 = turns * 4;
  const quadrant = Math.floor(q4);
  const a = (q4 - quadrant) * HALF_PI;
  const a2 = a * a;
  let sin = 0;
  let cos = 0;
  let sinTerm = a;
  let cosTerm = 1;
  for (let n = 0; n < 12; n++) {
    sin += sinTerm;
    cos += cosTerm;
    sinTerm = (-sinTerm * a2) / ((2 * n + 2) * (2 * n + 3));
    cosTerm = (-cosTerm * a2) / ((2 * n + 1) * (2 * n + 2));
  }
  switch (((quadrant % 4) + 4) % 4) {
    case 0:
      return { sin, cos };
    case 1:
      return { sin: cos, cos: -sin };
    case 2:
      return { sin: -sin, cos: -cos };
    default:
      return { sin: -cos, cos: sin };
  }
}

/** S-bend: a smoothstep lateral shift of `lateral` (signed) over `length`, heading unchanged. */
export function sBendCurve(length: number, lateral: number, y: number): Curve {
  return {
    pos: (u) => ({ x: length * u, y: y + lateral * (u * u * (3 - 2 * u)), z: 0 }),
    vel: (u) => ({ x: length, y: lateral * 6 * u * (1 - u), z: 0 }),
  };
}

/**
 * One full horizontal circle of `radius` turning toward `side`, drifting forward by `drift` so the
 * exit lies on the entry line, heading unchanged.
 */
export function helixCurve(radius: number, drift: number, side: 1 | -1, y: number): Curve {
  return {
    pos: (u) => {
      const { sin, cos } = sinCosTurns(u);
      return { x: radius * sin + drift * u, y: y + side * radius * (1 - cos), z: 0 };
    },
    vel: (u) => {
      const { sin, cos } = sinCosTurns(u);
      return { x: TWO_PI * radius * cos + drift, y: side * TWO_PI * radius * sin, z: 0 };
    },
  };
}

/**
 * Corkscrew: the track winds once around a forward axis while the rider rolls a full turn toward
 * `side`; up always points at the axis, so the rider is inverted at the top. The winding radius
 * rises from zero at the entry to `radius` mid-piece and back to zero, so both ends run straight
 * along the entry line.
 */
export function corkscrewCurve(length: number, radius: number, side: 1 | -1, y: number): Curve {
  return {
    pos: (u) => {
      const { sin, cos } = sinCosTurns(u);
      const amp = radius * 16 * u * u * (1 - u) * (1 - u);
      return { x: length * u, y: y - side * amp * sin, z: amp * (1 - cos) };
    },
    vel: (u) => {
      const { sin, cos } = sinCosTurns(u);
      const amp = radius * 16 * u * u * (1 - u) * (1 - u);
      const ampD = radius * 32 * u * (1 - u) * (1 - 2 * u);
      return {
        x: length,
        y: -side * (ampD * sin + amp * TWO_PI * cos),
        z: ampD * (1 - cos) + amp * TWO_PI * sin,
      };
    },
    bank: (u) => side * 360 * u,
  };
}

/** Horizontal length of a curve by fine polyline integration. */
export function horizontalLength(c: Curve): number {
  let len = 0;
  let prev = c.pos(0);
  for (let i = 1; i <= 256; i++) {
    const p = c.pos(i / 256);
    len += Math.sqrt((p.x - prev.x) * (p.x - prev.x) + (p.y - prev.y) * (p.y - prev.y));
    prev = p;
  }
  return len;
}

/**
 * Adds a cubic Hermite height profile (end gradients g0, g1 in rise per unit of horizontal run,
 * total rise dz) to a flat horizontal curve.
 */
export function withProfile(base: Curve, dz: number, g0: number, g1: number): Curve {
  const len = horizontalLength(base);
  const m0 = g0 * len;
  const m1 = g1 * len;
  return {
    pos: (u) => {
      const p = base.pos(u);
      const u2 = u * u;
      const u3 = u2 * u;
      const h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2;
      const h11 = u3 - u2;
      return { x: p.x, y: p.y, z: h10 * m0 + h01 * dz + h11 * m1 };
    },
    vel: (u) => {
      const v = base.vel(u);
      const u2 = u * u;
      const d10 = 3 * u2 - 4 * u + 1;
      const d01 = -6 * u2 + 6 * u;
      const d11 = 3 * u2 - 2 * u;
      return { x: v.x, y: v.y, z: d10 * m0 + d01 * dz + d11 * m1 };
    },
  };
}

/** Smoothstep interpolation of the bank angle between two end values. */
export function smoothBank(b0: number, b1: number, u: number): number {
  return b0 + (b1 - b0) * (u * u * (3 - 2 * u));
}

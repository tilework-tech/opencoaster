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

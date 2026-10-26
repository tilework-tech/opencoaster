import { material, polygon, quad } from '../mesh';
import type { Material, Mesh, Vec3 } from '../mesh';
import { ramp } from '../palette';
import { hash2, voronoi } from '../noise';

export const PATH_STYLES = ['tarmac', 'crazy-paving', 'dirt', 'queue'] as const;
export type PathStyle = (typeof PATH_STYLES)[number];

const PX = 1 / 16;
/** Height of the path surface above the ground. */
const SURFACE = PX;
/** Kerb top above the ground. */
const KERB_TOP = 3 * PX;
const KERB_WIDTH = 0.09;
const HALF = 0.5;

/** Unit direction vectors of connection bits: 0 = +x, 1 = +y, 2 = -x, 3 = -y. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

function surfaceMaterial(style: PathStyle): Material {
  switch (style) {
    case 'tarmac': {
      const colors = ramp('asphalt');
      return material(colors, {
        shader: (p, level) => {
          const speck = hash2(Math.floor(p[0] * 64), Math.floor(p[1] * 64), 3);
          const shade = speck < 0.07 ? level - 1 : speck > 0.95 ? level + 1 : level;
          return colors[Math.max(0, Math.min(4, shade - 1))];
        },
      });
    }
    case 'crazy-paving': {
      const colors = ramp('paving');
      return material(colors, {
        shader: (p, level) => {
          const cell = voronoi(p[0], p[1], 4, 5);
          if (cell.gap < 0.13) return colors[0];
          const tone = Math.floor(hash2(cell.id, 1, 9) * 3) - 1;
          return colors[Math.max(0, Math.min(4, level - 1 + tone))];
        },
      });
    }
    case 'dirt': {
      const colors = ramp('dirt');
      return material(colors, {
        shader: (p, level) => {
          const gx = Math.floor(p[0] * 32);
          const gy = Math.floor(p[1] * 32);
          const n = hash2(gx, gy, 11);
          const tone = n < 0.18 ? -1 : n > 0.9 ? 1 : 0;
          return colors[Math.max(0, Math.min(4, level - 1 + tone))];
        },
      });
    }
    case 'queue': {
      const colors = ramp('brick');
      return material(colors, {
        shader: (p, level) => {
          const rowSeam = Math.floor((p[1] + 0.5) * 8) !== Math.floor((p[1] + 0.5 + PX / 2) * 8);
          const bond = Math.floor((p[1] + 0.5) * 8) % 2 === 0 ? 0 : 0.0625;
          const colSeam =
            Math.floor((p[0] + 0.5 + bond) * 4) !== Math.floor((p[0] + 0.5 + bond + PX / 2) * 4);
          const base = rowSeam || colSeam ? level : level - 1;
          return colors[Math.max(0, Math.min(4, base))];
        },
      });
    }
  }
}

function kerbMaterial(style: PathStyle): Material {
  return material(ramp(style === 'dirt' ? 'wood' : style === 'queue' ? 'stone' : 'stone'));
}

const RAIL = material(ramp('white'));
const POST = material(ramp('red'));

/** Kerb strip along one tile edge without end caps so adjacent tiles join cleanly. */
function kerbStrip(direction: number, lift: (x: number, y: number) => number, mat: Material): Mesh {
  const [dx, dy] = DIRECTIONS[direction];
  const along: readonly [number, number] = [-dy, dx];
  const point = (side: number, t: number, z: number): Vec3 => {
    const x = dx * side + along[0] * t;
    const y = dy * side + along[1] * t;
    return [x, y, z + lift(x, y)];
  };
  const out = HALF;
  const inner = HALF - KERB_WIDTH;
  return [
    ...quad(
      [
        point(inner, -HALF, KERB_TOP),
        point(out, -HALF, KERB_TOP),
        point(out, HALF, KERB_TOP),
        point(inner, HALF, KERB_TOP),
      ],
      mat,
    ),
    ...quad(
      [
        point(out, -HALF, 0),
        point(out, HALF, 0),
        point(out, HALF, KERB_TOP),
        point(out, -HALF, KERB_TOP),
      ],
      mat,
    ),
    ...quad(
      [
        point(inner, -HALF, SURFACE),
        point(inner, HALF, SURFACE),
        point(inner, HALF, KERB_TOP),
        point(inner, -HALF, KERB_TOP),
      ],
      mat,
    ),
  ];
}

function queueRails(direction: number, lift: (x: number, y: number) => number): Mesh {
  const [dx, dy] = DIRECTIONS[direction];
  const mesh: Mesh = [];
  const inset = HALF - KERB_WIDTH / 2;
  const top = 8 * PX;
  const post = PX * 1.5;
  const bar = PX * 1.5;
  const postAt = (t: number): Mesh => {
    const x = dx * inset - dy * t;
    const y = dy * inset + dx * t;
    const z = lift(x, y);
    return [
      ...quad(
        [
          [x - post / 2, y - post / 2, z + top],
          [x + post / 2, y - post / 2, z + top],
          [x + post / 2, y + post / 2, z + top],
          [x - post / 2, y + post / 2, z + top],
        ],
        POST,
      ),
      ...quad(
        [
          [x - post / 2, y + post / 2, z + KERB_TOP],
          [x + post / 2, y + post / 2, z + KERB_TOP],
          [x + post / 2, y + post / 2, z + top],
          [x - post / 2, y + post / 2, z + top],
        ],
        POST,
      ),
      ...quad(
        [
          [x + post / 2, y - post / 2, z + KERB_TOP],
          [x + post / 2, y + post / 2, z + KERB_TOP],
          [x + post / 2, y + post / 2, z + top],
          [x + post / 2, y - post / 2, z + top],
        ],
        POST,
      ),
    ];
  };
  const railAt = (z: number): Mesh => {
    const a: Vec3 = [dx * inset + dy * HALF, dy * inset - dx * HALF, 0];
    const b: Vec3 = [dx * inset - dy * HALF, dy * inset + dx * HALF, 0];
    const za = z + lift(a[0], a[1]);
    const zb = z + lift(b[0], b[1]);
    return quad(
      [
        [a[0], a[1], za],
        [b[0], b[1], zb],
        [b[0], b[1], zb + bar],
        [a[0], a[1], za + bar],
      ],
      RAIL,
    );
  };
  mesh.push(...postAt(-HALF + PX), ...postAt(0), ...postAt(HALF - PX));
  mesh.push(...railAt(top - 2 * PX), ...railAt(top - 5.5 * PX));
  return mesh;
}

/**
 * The rail and posts along one edge of a flat queue piece. Edges facing the camera (directions 0
 * and 1) are drawn as separate sprites after the people standing on the tile, so guests stand
 * between the rails; the piece itself carries only the edges behind them.
 */
export function queueRailMesh(direction: number): Mesh {
  return queueRails(direction, () => 0);
}

export interface PathOptions {
  style: PathStyle;
  /** Bit d set when the piece joins its neighbour in direction d. */
  mask: number;
  /** Direction the ramp rises toward, one level across the tile; omitted for flat pieces. */
  slope?: number;
}

/** Geometry of one footpath piece: surface slab, kerbs on the closed sides, queue rails. */
export function pathMesh(options: PathOptions): Mesh {
  const { style, slope } = options;
  const surface = surfaceMaterial(style);
  const kerb = kerbMaterial(style);
  const lift =
    slope === undefined
      ? () => 0
      : (x: number, y: number): number => {
          const [dx, dy] = DIRECTIONS[slope];
          return (x * dx + y * dy + HALF) * 1;
        };
  const corner = (x: number, y: number): Vec3 => [x, y, SURFACE + lift(x, y)];
  const mesh: Mesh = quad(
    [corner(-HALF, -HALF), corner(HALF, -HALF), corner(HALF, HALF), corner(-HALF, HALF)],
    surface,
  );
  const closed =
    slope === undefined
      ? [0, 1, 2, 3].filter((d) => (options.mask & (1 << d)) === 0)
      : [(slope + 1) & 3, (slope + 3) & 3];
  for (const d of closed) {
    mesh.push(...kerbStrip(d, lift, kerb));
    const nearEdge = slope === undefined && d < 2;
    if (style === 'queue' && !nearEdge) mesh.push(...queueRails(d, lift));
  }
  if (slope !== undefined) {
    // Underside wedge on the two lateral sides keeps the ramp from floating above the ground.
    const [dx, dy] = DIRECTIONS[slope];
    for (const side of [1, -1]) {
      const sx = dy * side * HALF;
      const sy = -dx * side * HALF;
      const low: Vec3 = [sx - dx * HALF, sy - dy * HALF, 0];
      const high: Vec3 = [sx + dx * HALF, sy + dy * HALF, 0];
      mesh.push(
        ...polygon([low, high, [high[0], high[1], SURFACE + 1], [low[0], low[1], SURFACE]], kerb),
      );
    }
  }
  return mesh;
}

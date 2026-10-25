export type Vec3 = readonly [number, number, number];

/** Surface appearance: a colour ramp indexed by light level, optionally overridden per pixel. */
export interface Material {
  ramp: readonly number[];
  /** Fixed ramp level that ignores lighting. */
  fixedLevel?: number;
  /** Added to the computed light level before clamping. */
  levelBias?: number;
  /** Picks the palette index for a pixel from its model-space position and light level. */
  shader?: (p: Vec3, level: number) => number;
}

export interface Triangle {
  v: readonly [Vec3, Vec3, Vec3];
  material: Material;
}

export type Mesh = Triangle[];

export function material(
  rampIndices: readonly number[],
  options: Partial<Material> = {},
): Material {
  return { ramp: rampIndices, ...options };
}

export function quad(points: readonly [Vec3, Vec3, Vec3, Vec3], mat: Material): Mesh {
  return [
    { v: [points[0], points[1], points[2]], material: mat },
    { v: [points[0], points[2], points[3]], material: mat },
  ];
}

export function polygon(points: readonly Vec3[], mat: Material): Mesh {
  const out: Mesh = [];
  for (let i = 1; i + 1 < points.length; i++)
    out.push({ v: [points[0], points[i], points[i + 1]], material: mat });
  return out;
}

export interface BoxMaterials {
  top: Material;
  /** Face facing +y (the left visible side). */
  left: Material;
  /** Face facing +x (the right visible side). */
  right: Material;
  back?: Material;
}

/** Axis-aligned box; all six faces so it stays correct when rotated. */
export function box(min: Vec3, max: Vec3, mat: Material | BoxMaterials): Mesh {
  const m = 'ramp' in mat ? { top: mat, left: mat, right: mat, back: mat } : mat;
  const back = m.back ?? m.right;
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return [
    ...quad(
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      m.top,
    ),
    ...quad(
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
      ],
      back,
    ),
    ...quad(
      [
        [x0, y0, z0],
        [x0, y1, z0],
        [x0, y1, z1],
        [x0, y0, z1],
      ],
      back,
    ),
    ...quad(
      [
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
      ],
      m.right,
    ),
    ...quad(
      [
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      m.left,
    ),
    ...quad(
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
      ],
      back,
    ),
  ];
}

/** Regular prism with a vertical axis; `radius` may differ at the two ends to make cones. */
export function cylinder(
  cx: number,
  cy: number,
  z0: number,
  z1: number,
  radius0: number,
  radius1: number,
  segments: number,
  mat: Material,
  options: { capTop?: boolean; capBottom?: boolean; phase?: number } = {},
): Mesh {
  const out: Mesh = [];
  const phase = options.phase ?? 0;
  const ring = (r: number, z: number): Vec3[] =>
    Array.from({ length: segments }, (_, i) => {
      const a = phase + (i / segments) * Math.PI * 2;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z] as Vec3;
    });
  const low = ring(radius0, z0);
  const high = ring(radius1, z1);
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    out.push(...quad([low[i], low[j], high[j], high[i]], mat));
  }
  if (options.capTop !== false && radius1 > 0) out.push(...polygon(high, mat));
  if (options.capBottom) out.push(...polygon(low, mat));
  return out;
}

/** Extrudes a sequence of cross-section points between two centre-line stations. */
export function loft(sectionA: readonly Vec3[], sectionB: readonly Vec3[], mat: Material): Mesh {
  const out: Mesh = [];
  const n = sectionA.length;
  for (let i = 0; i < n - 1; i++)
    out.push(...quad([sectionA[i], sectionA[i + 1], sectionB[i + 1], sectionB[i]], mat));
  return out;
}

export function translateMesh(mesh: Mesh, dx: number, dy: number, dz: number): Mesh {
  return mesh.map((t) => ({
    material: t.material,
    v: t.v.map((p) => [p[0] + dx, p[1] + dy, p[2] + dz] as Vec3) as unknown as Triangle['v'],
  }));
}

/** Rotates around the vertical axis by quarter turns in the sense of the renderer's camera rotation. */
export function rotatePoint(p: Vec3, quarterTurns: number): Vec3 {
  switch (((quarterTurns % 4) + 4) % 4) {
    case 0:
      return p;
    case 1:
      return [-p[1], p[0], p[2]];
    case 2:
      return [-p[0], -p[1], p[2]];
    default:
      return [p[1], -p[0], p[2]];
  }
}

export function rotateMesh(mesh: Mesh, quarterTurns: number): Mesh {
  if (((quarterTurns % 4) + 4) % 4 === 0) return mesh;
  return mesh.map((t) => ({
    material: t.material,
    v: t.v.map((p) => rotatePoint(p, quarterTurns)) as unknown as Triangle['v'],
  }));
}

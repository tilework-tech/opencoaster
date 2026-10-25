import { beam, box, cylinder, material, quad } from '../mesh';
import type { Material, Mesh, Vec3 } from '../mesh';
import { ramp } from '../palette';

const BARK = material(ramp('wood'));
const FROND = material(ramp('green'));
const COCONUT = material(ramp('timber'));
const CACTUS = material(ramp('green'));
const BLOOM = material(ramp('pink'));

interface Station {
  at: Vec3;
  radius: number;
}

/** Tapered tube through a sequence of stations, each ring lying in a horizontal plane. */
function tube(stations: readonly Station[], segments: number, mat: Material): Mesh {
  const ring = (station: Station): Vec3[] =>
    Array.from({ length: segments }, (_, i) => {
      const a = (i / segments) * Math.PI * 2;
      return [
        station.at[0] + Math.cos(a) * station.radius,
        station.at[1] + Math.sin(a) * station.radius,
        station.at[2],
      ];
    });
  const out: Mesh = [];
  for (let k = 0; k + 1 < stations.length; k++) {
    const low = ring(stations[k]);
    const high = ring(stations[k + 1]);
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      out.push(...quad([low[i], low[j], high[j], high[i]], mat));
    }
  }
  return out;
}

/** One palm frond: a leaf strip that rises slightly, then arcs down under its own weight. */
function frond(origin: Vec3, heading: number, length: number, droop: number): Mesh {
  const steps = 6;
  const along = [Math.cos(heading), Math.sin(heading)];
  const across = [-Math.sin(heading), Math.cos(heading)];
  const spine = (s: number): Vec3 => [
    origin[0] + along[0] * length * s,
    origin[1] + along[1] * length * s,
    origin[2] + 0.12 * Math.sin(Math.PI * s) - droop * s * s,
  ];
  const halfWidth = (s: number): number => 0.13 * Math.sin(Math.PI * s) ** 0.6;
  const out: Mesh = [];
  for (let k = 0; k < steps; k++) {
    const s0 = k / steps;
    const s1 = (k + 1) / steps;
    const p0 = spine(s0);
    const p1 = spine(s1);
    const w0 = halfWidth(s0);
    const w1 = halfWidth(s1);
    const left = (p: Vec3, w: number): Vec3 => [p[0] + across[0] * w, p[1] + across[1] * w, p[2]];
    const right = (p: Vec3, w: number): Vec3 => [p[0] - across[0] * w, p[1] - across[1] * w, p[2]];
    out.push(...quad([left(p0, w0), left(p1, w1), right(p1, w1), right(p0, w0)], FROND));
  }
  return out;
}

/** Palm in physical tile units: a leaning tapered trunk with a crown of drooping fronds. */
export function palmTreeMesh(): Mesh {
  const height = 2.6;
  const bend = 0.22;
  const stations: Station[] = Array.from({ length: 9 }, (_, k) => {
    const t = k / 8;
    return { at: [bend * t * t, 0, height * t], radius: 0.09 - 0.04 * t };
  });
  const crown: Vec3 = [bend, 0, height - 0.02];
  const headings = [0, 1, 2, 3, 4, 5, 6].map((k) => (k / 7) * Math.PI * 2 + 0.3);
  const fronds = headings.flatMap((heading, k) =>
    frond(crown, heading, 1.05 + 0.1 * (k % 2), 0.55 + 0.1 * (k % 3)),
  );
  return [
    ...tube(stations, 8, BARK),
    ...fronds,
    ...box(
      [crown[0] - 0.09, -0.07, crown[2] - 0.2],
      [crown[0] - 0.02, 0.07, crown[2] - 0.1],
      COCONUT,
    ),
    ...box(
      [crown[0] + 0.02, -0.02, crown[2] - 0.24],
      [crown[0] + 0.1, 0.1, crown[2] - 0.14],
      COCONUT,
    ),
  ];
}

/** Saguaro-style cactus in physical tile units: a green column with two upturned arms. */
export function cactusTreeMesh(): Mesh {
  const height = 2.3;
  return [
    ...cylinder(0, 0, 0, height, 0.16, 0.14, 10, CACTUS, { capTop: true, capBottom: true }),
    ...beam([0.1, 0, 0.85], [0.46, 0, 0.85], 0.13, CACTUS),
    ...beam([0.46, 0, 0.85], [0.46, 0, 1.7], 0.13, CACTUS),
    ...cylinder(0.46, 0, 1.7, 1.72, 0.07, 0.07, 8, CACTUS, { capTop: true }),
    ...beam([0, 0.1, 1.2], [0, 0.42, 1.2], 0.13, CACTUS),
    ...beam([0, 0.42, 1.2], [0, 0.42, 1.95], 0.13, CACTUS),
    ...cylinder(0, 0.42, 1.95, 1.97, 0.07, 0.07, 8, CACTUS, { capTop: true }),
    ...box([-0.05, -0.05, height], [0.05, 0.05, height + 0.08], BLOOM),
  ];
}

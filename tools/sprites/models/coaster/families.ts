import { material } from '../../mesh';
import type { Material } from '../../mesh';
import { ramp } from '../../palette';

export const COASTER_FAMILIES = ['wood', 'steel', 'junior', 'mouse'] as const;
export type CoasterFamily = (typeof COASTER_FAMILIES)[number];

/** Track and station art is shared: Junior rides on steel-style track, Wild Mouse on timber. */
export const TRACK_ARTS = ['wood', 'steel'] as const;
export type TrackArt = (typeof TRACK_ARTS)[number];

const mat = (name: string): Material => material(ramp(name));

export interface TrackLook {
  /** Half the distance between the rail centres, in tiles. */
  gauge: number;
  railSize: number;
  rail: Material;
  /** Single central box under the rails (steel-style track). */
  spine?: { width: number; depth: number; drop: number; mat: Material };
  /** Twin side beams under the rails (timber-style track). */
  stringers?: { width: number; depth: number; drop: number; mat: Material };
  tie: { mat: Material; spacing: number; halfWidth: number; thickness: number };
  station: { roof: Material; pillar: Material; trim: Material };
  brake: Material;
  blockBrake: Material;
  chain: Material;
}

export const TRACK_LOOKS: Record<TrackArt, TrackLook> = {
  wood: {
    gauge: 0.1,
    railSize: 0.032,
    rail: mat('steel'),
    stringers: { width: 0.07, depth: 0.1, drop: 0.07, mat: mat('wood') },
    tie: { mat: mat('timber'), spacing: 0.0625, halfWidth: 0.15, thickness: 0.03 },
    station: { roof: mat('brick'), pillar: mat('timber'), trim: mat('yellow') },
    brake: mat('red'),
    blockBrake: mat('blue'),
    chain: mat('steel'),
  },
  steel: {
    gauge: 0.095,
    railSize: 0.04,
    rail: mat('white'),
    spine: { width: 0.085, depth: 0.075, drop: 0.07, mat: mat('blue') },
    tie: { mat: mat('steel'), spacing: 0.125, halfWidth: 0.125, thickness: 0.03 },
    station: { roof: mat('blue'), pillar: mat('white'), trim: mat('red') },
    brake: mat('red'),
    blockBrake: mat('yellow'),
    chain: mat('steel'),
  },
};

export interface SupportLook {
  /** A braced pair of posts, or a single tube. */
  kind: 'bent' | 'tube';
  mat: Material;
  brace: Material;
  /** Half the span between the posts of a bent. */
  half: number;
  size: number;
}

export const SUPPORT_LOOKS: Record<CoasterFamily, SupportLook> = {
  wood: { kind: 'bent', mat: mat('timber'), brace: mat('wood'), half: 0.14, size: 0.055 },
  steel: { kind: 'tube', mat: mat('white'), brace: mat('steel'), half: 0.1, size: 0.075 },
  junior: { kind: 'tube', mat: mat('green'), brace: mat('steel'), half: 0.1, size: 0.06 },
  mouse: { kind: 'bent', mat: mat('purple'), brace: mat('timber'), half: 0.1, size: 0.05 },
};

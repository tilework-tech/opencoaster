import { Z_STEP } from '../core/constants';
import type { World } from '../core/world';
import { RIDE_CATALOG } from '../rides/ride-types';
import type { RideType } from '../rides/ride-types';
import { MAX_TRACK_LEVEL } from '../track/track-store';

/**
 * Rules a scenario places on the player, read from the scenario file's optional `restrictions`
 * object and saved with the park. A missing field means that rule does not apply. See
 * docs/scenario-restrictions.md.
 */
export interface ScenarioRestrictions {
  /** Trees may not be removed by any tool or land edit. */
  forbidTreeRemoval?: boolean;
  /** Land height, water and land surface may not be changed. */
  forbidLandscaping?: boolean;
  /** Highest part of new construction, in land height levels above each tile's local ground. */
  maxConstructionHeight?: number;
  /** `RideType` ids that may not be built. */
  forbiddenRideTypeIds?: number[];
  /** Marketing campaigns may not be started. */
  forbidMarketing?: boolean;
}

/** Smallest cap: a 3-level stall still fits on a tile sloped by one level. */
export const MIN_CONSTRUCTION_HEIGHT = 4;
export const MAX_CONSTRUCTION_HEIGHT = MAX_TRACK_LEVEL;

const FLAGS = ['forbidTreeRemoval', 'forbidLandscaping', 'forbidMarketing'] as const;
const KEYS: readonly string[] = [...FLAGS, 'maxConstructionHeight', 'forbiddenRideTypeIds'];

/** Validates a scenario file's `restrictions` value; errors name the offending field. */
export function parseRestrictions(v: unknown): ScenarioRestrictions {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new Error('restrictions must be an object');
  const o = v as Record<string, unknown>;
  for (const key of Object.keys(o))
    if (!KEYS.includes(key)) throw new Error(`restrictions.${key} is not a known restriction`);
  const out: ScenarioRestrictions = {};
  for (const flag of FLAGS) {
    const value = o[flag];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') throw new Error(`restrictions.${flag} must be true or false`);
    if (value) out[flag] = true;
  }
  const cap = o.maxConstructionHeight;
  if (cap !== undefined) {
    if (
      typeof cap !== 'number' ||
      !Number.isInteger(cap) ||
      cap < MIN_CONSTRUCTION_HEIGHT ||
      cap > MAX_CONSTRUCTION_HEIGHT
    )
      throw new Error(
        `restrictions.maxConstructionHeight must be an integer from ${MIN_CONSTRUCTION_HEIGHT} to ${MAX_CONSTRUCTION_HEIGHT}`,
      );
    out.maxConstructionHeight = cap;
  }
  const ids = o.forbiddenRideTypeIds;
  if (ids !== undefined) {
    if (!Array.isArray(ids)) throw new Error('restrictions.forbiddenRideTypeIds must be an array');
    const seen = new Set<number>();
    ids.forEach((id, i) => {
      const path = `restrictions.forbiddenRideTypeIds[${i}]`;
      if (typeof id !== 'number' || RIDE_CATALOG[id as RideType] === undefined)
        throw new Error(`${path} must be a ride type id`);
      if (seen.has(id)) throw new Error(`${path} repeats ride type ${id}`);
      seen.add(id);
    });
    if (ids.length > 0) out.forbiddenRideTypeIds = [...(ids as number[])];
  }
  return out;
}

/** Plain-language description of each active rule, for the scenario preview and objective view. */
export function restrictionLines(r: ScenarioRestrictions): string[] {
  const lines: string[] = [];
  if (r.forbidTreeRemoval) lines.push('Trees may not be removed.');
  if (r.forbidLandscaping) lines.push('Land and water may not be reshaped.');
  if (r.maxConstructionHeight !== undefined)
    lines.push(
      `Nothing may be built more than ${r.maxConstructionHeight} height levels above the ground.`,
    );
  if (r.forbiddenRideTypeIds?.length)
    lines.push(
      `Banned attractions: ${r.forbiddenRideTypeIds.map((id) => RIDE_CATALOG[id as RideType].name).join(', ')}.`,
    );
  if (r.forbidMarketing) lines.push('Marketing campaigns are not allowed.');
  return lines;
}

export function treesProtected(world: World): boolean {
  return world.scenario.restrictions.forbidTreeRemoval === true;
}

export function landscapingForbidden(world: World): boolean {
  return world.scenario.restrictions.forbidLandscaping === true;
}

export function marketingForbidden(world: World): boolean {
  return world.scenario.restrictions.forbidMarketing === true;
}

export function rideTypeForbidden(world: World, type: number): boolean {
  return world.scenario.restrictions.forbiddenRideTypeIds?.includes(type) === true;
}

/** Land and water levels per tile: the sim's `TileMap` or a snapshot's `MapData`. */
export interface GroundLevels {
  heights: ArrayLike<number>;
  waterLevel?: ArrayLike<number>;
}

/**
 * Whether something whose top on `tile` is at world height `top` breaks a height cap. The local
 * ground is the tile's lowest land corner, or its water surface when that is higher.
 */
export function aboveHeightCap(
  cap: number | undefined,
  ground: GroundLevels,
  tile: number,
  top: number,
): boolean {
  if (cap === undefined) return false;
  const base = Math.max(ground.heights[tile], ground.waterLevel?.[tile] ?? 0);
  return top > (base + cap) * Z_STEP;
}

/** `aboveHeightCap` with the world's own cap and map. */
export function exceedsHeightCap(world: World, tile: number, top: number): boolean {
  return aboveHeightCap(world.scenario.restrictions.maxConstructionHeight, world.map, tile, top);
}

/** Why a command broke a scenario rule, in the words the UI shows the player. */
export const RESTRICTION_REFUSALS = {
  trees: 'Trees are protected in this park and cannot be removed.',
  landscaping: 'Landscaping is not allowed in this park.',
  rideType: 'This attraction is banned in this park.',
  marketing: 'Marketing campaigns are not allowed in this park.',
} as const;

/** Refusal for construction above the cap; `cap` is the feedback detail when the sim knows it. */
export function heightLimitRefusal(cap: string | number = ''): string {
  return cap === ''
    ? "Too high for this park's construction height limit."
    : `Too high: this park allows construction up to ${cap} height levels above the ground.`;
}

/** The world's cap as feedback detail, so a refusal can quote it. */
export function heightCapDetail(world: World): string {
  const cap = world.scenario.restrictions.maxConstructionHeight;
  return cap === undefined ? '' : String(cap);
}

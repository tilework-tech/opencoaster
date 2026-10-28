import { PATH_ADDITION_BROKEN, PathFlag } from '../sim/map/tile-map';
import { TICKS_PER_MONTH } from '../sim/economy/calendar';
import { TILE_UNITS } from '../sim/core/constants';
import { pathAdditionPlacements } from './ground-anchor';
import { project } from './projection';
import type { Camera, MapData } from './renderer';

/** Hour of the in-game day at which each day begins. */
const DAY_START_HOUR = 8;
/** Darkness at or above which path lamps are lit. Darkness only rises through dusk and falls through dawn. */
export const LAMP_ON_DARKNESS = 0.5;

/** World-pixel radii of a lamp's light pool on the ground; the pool is an isometric ellipse. */
export const POOL_RADIUS_X = 36;
export const POOL_RADIUS_Y = 18;
/** World pixels from a lamp's ground point up to its lamp head. */
export const LAMP_HEAD_HEIGHT = 22;
/** Edge length, in world pixels, of the bright core and of the halo around a lit lamp head. */
export const LAMP_HEAD_CORE = 2;
export const LAMP_HEAD_HALO = 5;
/** Light pool rings from the centre outwards: ring edge as a fraction of the radius, and brightness. */
export const POOL_BANDS: ReadonlyArray<readonly [number, number]> = [
  [0.35, 0.34],
  [0.6, 0.24],
  [0.8, 0.15],
  [1, 0.07],
];
export const LAMP_LIGHT_COLOUR: readonly [number, number, number] = [255, 190, 100];
export const LAMP_HEAD_COLOUR: readonly [number, number, number] = [255, 236, 170];
const NIGHT_TINT: readonly [number, number, number] = [92, 106, 170];

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** Number of in-game calendar days in one lighting cycle. */
const DAYS_PER_CYCLE = 36;
/** March has 31 calendar days, matching the tick span used by `gameDate`. */
export const TICKS_PER_NIGHT_CYCLE = (TICKS_PER_MONTH * DAYS_PER_CYCLE) / 31;

/** Hour of day, 0 to 24, derived from the simulation tick without adding saved state. */
function hourOfDay(tick: number): number {
  const progress = (tick % TICKS_PER_NIGHT_CYCLE) / TICKS_PER_NIGHT_CYCLE;
  return (DAY_START_HOUR + progress * 24) % 24;
}

/** 0 in full daylight, 1 at night, easing through dusk (18:00-20:00) and dawn (05:00-07:00). */
export function darknessAt(tick: number): number {
  const hour = hourOfDay(tick);
  return hour >= 12 ? smoothstep(18, 20, hour) : 1 - smoothstep(5, 7, hour);
}

export function lampsLit(darkness: number): boolean {
  return darkness >= LAMP_ON_DARKNESS;
}

/** Colour that multiplies the finished scene; white in daylight, a dim blue at night. */
export function ambientTint(darkness: number): [number, number, number] {
  return [
    Math.round(255 + (NIGHT_TINT[0] - 255) * darkness),
    Math.round(255 + (NIGHT_TINT[1] - 255) * darkness),
    Math.round(255 + (NIGHT_TINT[2] - 255) * darkness),
  ];
}

/** Ground points of lit lamps in viewport pixels, two floats per lamp; reused across frames. */
export class LampLightBuffer {
  data = new Float32Array(512);

  push(count: number, x: number, y: number): void {
    if ((count + 1) * 2 > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[count * 2] = x;
    this.data[count * 2 + 1] = y;
  }
}

const projected = new Float64Array(2);

/**
 * Fills `lights` with the viewport position of every intact lamp that could light the view and
 * returns how many there are. Vandalised lamps are skipped, so they stay dark.
 */
export function collectLitLamps(
  map: MapData,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  lights: LampLightBuffer,
): number {
  const paths = map.pathElements;
  if (!paths) return 0;
  const count = Math.min(map.pathCount ?? 0, paths.length / 6);
  const marginX = POOL_RADIUS_X * camera.zoom;
  const marginY = (POOL_RADIUS_Y + LAMP_HEAD_HEIGHT) * camera.zoom;
  let lit = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 6;
    const flags = paths[o + 3]!;
    if (!(flags & PathFlag.Lamp) || paths[o + 4]! & PATH_ADDITION_BROKEN) continue;
    const baseHeight = paths[o + 2]!;
    const worldX = paths[o]! * TILE_UNITS + TILE_UNITS / 2;
    const worldY = paths[o + 1]! * TILE_UNITS + TILE_UNITS / 2;
    for (const placement of pathAdditionPlacements(flags, baseHeight)) {
      project(
        worldX + placement.x,
        worldY + placement.y,
        placement.groundZ,
        map.width,
        map.height,
        camera.rotation,
        projected,
      );
      const x = (projected[0]! - camera.x) * camera.zoom + viewportWidth / 2;
      const y = (projected[1]! - camera.y) * camera.zoom + viewportHeight / 2;
      if (x < -marginX || x > viewportWidth + marginX) continue;
      if (y < -marginY || y > viewportHeight + marginY) continue;
      lights.push(lit++, x, y);
    }
  }
  return lit;
}

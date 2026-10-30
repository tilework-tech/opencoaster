import { readFileSync } from 'node:fs';
import { TILE_UNITS } from '../../src/sim/core/constants';
import { Simulation } from '../../src/sim/core/simulation';
import { spawnGuest } from '../../src/sim/guests/guest-store';
import { setParkEntrance } from '../../src/sim/guests/park';
import { layPath, openRide, row } from '../../src/sim/integration/fixtures';
import { RideType } from '../../src/sim/rides/ride-types';
import { parseScenarioFile } from '../../src/sim/scenario/scenario-file';
import { prepareScenario } from '../../src/sim/scenario/scenario-layout';
import { WeatherKind } from '../../src/sim/weather/weather';
import type { Tile } from '../footpath-helpers';

const PATH_Y = 42;
const PATH_FROM = 28;
const PATH_TO = 46;
/** Stalls stand on y 41 with their entrances on the path below them. */
const STALLS: ReadonlyArray<readonly [RideType, number]> = [
  [RideType.BalloonStall, 31],
  [RideType.HatStall, 34],
  [RideType.IceCreamStall, 37],
  [RideType.BurgerStall, 40],
  [RideType.InformationKiosk, 43],
];
export const STALL_CENTRE: Tile = { x: 37, y: PATH_Y };

export interface StallScene {
  sim: Simulation;
  /** Ride ids by stall type. */
  stalls: Map<RideType, number>;
}

/**
 * A strip of footpath lined with balloon, hat, ice cream and burger stalls and an information
 * kiosk, walked by guests who have ridden, are happy and have cash. After 8,000 ticks of the
 * real simulation they carry what the stalls sold them.
 */
export function stallScene(weather: WeatherKind): StallScene {
  const scenario = parseScenarioFile(
    JSON.parse(
      readFileSync(
        new URL('../../src/sim/scenario/scenarios/starter.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const sim = new Simulation({
    seed: scenario.seed,
    width: scenario.mapWidth,
    height: scenario.mapHeight,
  });
  const world = sim.world;
  prepareScenario(world, scenario);
  layPath(world, row(PATH_Y, PATH_FROM, PATH_TO));
  if (!setParkEntrance(world, PATH_TO, PATH_Y)) throw new Error('setParkEntrance');
  const stalls = new Map<RideType, number>();
  for (const [type, x] of STALLS) {
    const slot = openRide(world, type, [x, PATH_Y - 1], [x, PATH_Y], [x + 1, PATH_Y - 1]);
    stalls.set(type, world.rides.slotToId[slot]);
  }
  world.weather.kind = weather;
  world.weather.temperature = weather === WeatherKind.Sunny ? 24 : 16;
  world.weather.ticksUntilChange = 1_000_000;

  for (let n = 0; n < 36; n++) {
    if (!spawnGuest(world)) throw new Error('spawnGuest');
    const slot = world.guests.count - 1;
    const tileX = PATH_FROM + (n % (PATH_TO - PATH_FROM + 1));
    const g = world.guests.cols;
    g.x[slot] = tileX * TILE_UNITS + TILE_UNITS / 2;
    g.y[slot] = PATH_Y * TILE_UNITS + TILE_UNITS / 2;
    g.z[slot] = world.map.heightAt(g.x[slot], g.y[slot]);
    g.cash[slot] = 5_000;
    g.happiness[slot] = 230;
    g.happinessTarget[slot] = 230;
    g.ridesTaken[slot] = 6;
    g.hunger[slot] = 40 + (n % 5) * 10;
    g.thirst[slot] = 255;
  }
  for (let tick = 0; tick < 8_000; tick++) {
    sim.step();
    // Keep the strollers content and in funds so they stay in the park and keep shopping.
    if (tick % 100 !== 0) continue;
    const g = world.guests.cols;
    for (let slot = 0; slot < world.guests.count; slot++) {
      g.energy[slot] = 128;
      g.happiness[slot] = Math.max(g.happiness[slot], 230);
      g.happinessTarget[slot] = Math.max(g.happinessTarget[slot], 230);
      g.ridesTaken[slot] = Math.max(g.ridesTaken[slot], 6);
      g.cash[slot] = Math.max(g.cash[slot], 5_000);
      g.patience[slot] = Math.max(g.patience[slot], 600);
    }
  }
  return { sim, stalls };
}

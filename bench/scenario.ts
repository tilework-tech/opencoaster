import { Simulation } from '../src/sim/core/simulation';
import { DEFAULT_MAP_SIZE } from '../src/sim/core/constants';
import { dropLitter, LitterKind } from '../src/sim/guests/litter-store';
import { placePath, PathAddition, setPathAddition } from '../src/sim/map/paths';
import { StaffKind } from '../src/sim/staff/staff-store';

export interface BenchScenarioOptions {
  guests: number;
  staff: number;
  litter: number;
  /** Park benches placed on spaced path tiles; zero leaves the paths bare. */
  benches?: number;
  /** Starts every guest tired enough to look for a bench. */
  tired?: boolean;
}

export function createBenchScenario({
  guests,
  staff,
  litter,
  benches = 0,
  tired = false,
}: BenchScenarioOptions): Simulation {
  const sim = new Simulation({ seed: 1, width: DEFAULT_MAP_SIZE, height: DEFAULT_MAP_SIZE });
  const map = sim.world.map;
  map.waterLevel.fill(0);
  map.ownership.fill(1);
  map.fillFlat(4);
  const min = 8;
  const max = DEFAULT_MAP_SIZE - 8;
  const pathTiles: number[] = [];
  for (let y = min; y <= max; y++) {
    for (let x = min; x <= max; x++) {
      if (x % 4 === 0 || y % 4 === 0) {
        placePath(map, { x, y });
        pathTiles.push(map.index(x, y));
      }
    }
  }
  for (let y = min; y <= max; y += 16) {
    for (let x = min; x <= max; x += 16) {
      if (map.isWalkable(map.index(x, y))) {
        setPathAddition(map, x, y, PathAddition.Bin);
        const element = map.pathElement(map.index(x, y), -1);
        if (element >= 0) map.elData[element] = 12;
      }
    }
  }
  for (let placed = 0; placed < benches; placed++) {
    const tile = pathTiles[Math.floor(((placed + 0.25) * pathTiles.length) / benches)];
    setPathAddition(map, tile % map.width, Math.floor(tile / map.width), PathAddition.Bench);
  }
  sim.enqueue({ type: 'setParkEntrance', x: min, y: min });
  sim.enqueue({ type: 'spawnGuests', count: guests });
  const counts = [0.6, 0.1, 0.1, 0.2].map((share) => Math.floor(staff * share));
  counts[0] += staff - counts.reduce((sum, count) => sum + count, 0);
  for (let kind = StaffKind.Handyman; kind <= StaffKind.Entertainer; kind++) {
    if (counts[kind] > 0) sim.enqueue({ type: 'spawnStaff', count: counts[kind], kind });
  }

  if (tired) {
    sim.step();
    sim.world.guests.cols.energy.fill(60, 0, sim.world.guests.count);
  }

  for (let index = 0; index < litter; index++) {
    const tile = pathTiles[Math.floor(((index + 0.5) * pathTiles.length) / litter)];
    const x = tile % map.width;
    const y = Math.floor(tile / map.width);
    if (!dropLitter(sim.world, x, y, LitterKind.Vomit))
      throw new RangeError(`could not place ${litter} benchmark litter items`);
  }
  return sim;
}

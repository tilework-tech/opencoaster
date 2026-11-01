import { describe, expect, it } from 'vitest';
import { World } from '../sim/core/world';
import { OWNED } from '../sim/map/tile-map';
import { SCENARIOS } from '../sim/scenario/catalog';
import { parseScenarioFile } from '../sim/scenario/scenario-file';
import { prepareScenarioPark } from '../sim/scenario/scenario-layout';
import { deserialize, serialize } from './save';

/** Copper Ridge's map recipe before the hard-park remix: an inset owned rectangle. */
const LEGACY_COPPER_RIDGE = parseScenarioFile({
  id: 'copper-ridge',
  name: 'Copper Ridge',
  category: 'challenging',
  seed: 2101,
  map: { width: 96, height: 96 },
  finance: {
    startingCash: 3_000_000,
    startingLoan: 2_500_000,
    maxLoan: 9_000_000,
    annualInterestBps: 900,
  },
  pricing: { mode: 'perRide' },
  objective: { kind: 'completeCoasters', target: 5, minimumExcitement: 460, byYear: 1 },
  entrance: { side: 'south', length: 4 },
  land: { ownedMarginPercent: 22, saleMarginPercent: 3 },
  terrain: {
    seaLevel: 3,
    baseLevel: 8,
    relief: 5,
    cell: 10,
    surface: 'grass',
    buildLevel: 9,
    buildLength: 48,
    buildWidth: 35,
    lakes: [{ x: 15, y: 20, rx: 9, ry: 7, depth: 2 }],
    hills: [
      { x: 80, y: 25, radius: 12, height: 5 },
      { x: 20, y: 70, radius: 10, height: 4 },
    ],
    highland: { surface: 'dirt', level: 10 },
  },
  trees: { count: 150, groves: 8 },
});

function newGame(def: typeof LEGACY_COPPER_RIDGE): World {
  const w = new World({ seed: def.seed, width: def.mapWidth, height: def.mapHeight });
  prepareScenarioPark(w, def);
  return w;
}

describe('saves from before the hard-park remix', () => {
  it('load with their own land, terrain and scenery rather than the remixed map', () => {
    const legacy = newGame(LEGACY_COPPER_RIDGE);
    const loaded = deserialize(serialize(legacy));
    expect(Array.from(loaded.map.ownership)).toEqual(Array.from(legacy.map.ownership));
    expect(Array.from(loaded.map.vertexHeights)).toEqual(Array.from(legacy.map.vertexHeights));
    expect(Array.from(loaded.map.waterLevel)).toEqual(Array.from(legacy.map.waterLevel));
    expect(Array.from(loaded.map.elData)).toEqual(Array.from(legacy.map.elData));

    const remix = newGame(SCENARIOS.find((s) => s.id === 'copper-ridge')!);
    const ownedCount = (w: World) => w.map.ownership.reduce((n, o) => n + (o & OWNED ? 1 : 0), 0);
    expect(ownedCount(loaded)).not.toBe(ownedCount(remix));
  });
});

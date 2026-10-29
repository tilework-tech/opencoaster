import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { Simulation } from '../core/simulation';
import { RIDE_CATALOG } from '../rides/ride-types';
import { parseScenarioFile } from '../scenario/scenario-file';
import { applyScenario } from '../scenario/scenario';
import { FUNDING_WORK_PER_WEEK, Funding } from './research';
import { TICKS_PER_WEEK } from '../economy/calendar';

const starter = parseScenarioFile(
  JSON.parse(readFileSync(new URL('../scenario/scenarios/starter.json', import.meta.url), 'utf8')),
);

describe('ride research catalog', () => {
  it('includes every undiscovered ride in the starter scenario in authored discovery order', () => {
    const expected: ReadonlyArray<readonly [itemId: number, category: number, workUnits: number]> =
      [
        [9, 2, 585],
        [10, 2, 630],
        [11, 3, 675],
        [13, 3, 765],
        [14, 3, 810],
        [15, 3, 855],
        [16, 4, 900],
        [17, 4, 945],
        [18, 0, 990],
        [19, 0, 1035],
        [20, 0, 1080],
        [22, 2, 1170],
        [23, 1, 1215],
        [24, 5, 1260],
      ];
    expect(
      starter.inventions.map(({ itemId, category, workUnits }) => [itemId, category, workUnits]),
    ).toEqual(expected);
  });

  it('assigns each invention the ride category and work units authored in the catalog', () => {
    for (const invention of starter.inventions) {
      const def = RIDE_CATALOG[invention.itemId as keyof typeof RIDE_CATALOG];
      expect(def, `ride item ${invention.itemId}`).toBeDefined();
      if (!def) continue;
      expect(invention.category).toBe(def.researchCategory);
      expect(invention.workUnits).toBe(def.researchWorkUnits);
    }
  });

  it('loads scenario discoveries as the ride item ids used by the build catalog', () => {
    const world = new World({ seed: 1, width: 16, height: 16 });
    applyScenario(world, starter);
    for (const itemId of [1, 2, 3, 4, 5, 6, 7, 8, 21]) {
      expect(world.research.unlocked.has(itemId), `ride item ${itemId}`).toBe(true);
    }
    for (const invention of starter.inventions) {
      expect(world.research.unlocked.has(invention.itemId)).toBe(false);
    }
  });

  it('starts normal research across the scenario invention categories and unlocks an invention', () => {
    const simulation = new Simulation({ seed: 1, width: 16, height: 16 });
    applyScenario(simulation.world, starter);
    const firstInvention = starter.inventions[0];
    const weeks = Math.ceil(firstInvention.workUnits / FUNDING_WORK_PER_WEEK[Funding.Normal]);
    for (let i = 0; i <= weeks * TICKS_PER_WEEK; i++) {
      simulation.step();
    }
    expect(simulation.world.research.unlocked.has(firstInvention.itemId)).toBe(true);
  });
});

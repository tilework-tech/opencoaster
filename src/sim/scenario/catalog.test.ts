import { describe, expect, it } from 'vitest';
import { IMPORTED_ID, SANDBOX_ID, ObjectiveKind } from './scenario';
import { SCENARIOS, buildCatalog, findScenario, scenarioDisplayName } from './catalog';

const minimal = (id: string) => ({
  id,
  name: id,
  seed: 1,
  map: { width: 16, height: 16 },
  finance: { startingCash: 0, startingLoan: 0, maxLoan: 0, annualInterestBps: 0 },
  pricing: { mode: 'free' },
  objective: { kind: 'guests', target: 1, byYear: 1 },
});

describe('scenario catalog', () => {
  it('ships the starter scenario as a playable definition', () => {
    const starter = findScenario('starter');
    expect(starter).toBeDefined();
    expect(SCENARIOS.map((s) => s.id)).toContain('starter');
    expect(starter?.objective.kind).toBe(ObjectiveKind.GuestsAndRating);
    expect(starter?.objective.target).toBe(100);
    expect(starter?.objective.rating).toBe(450);
    expect(starter?.entrance).toEqual({ side: 'south', length: 4 });
  });

  it('names saved games by scenario, sandbox, or imported file', () => {
    expect(scenarioDisplayName('starter')).toBe('Starter Park');
    expect(scenarioDisplayName(SANDBOX_ID)).toBe('Sandbox');
    expect(scenarioDisplayName(IMPORTED_ID)).toBe('Imported game');
    expect(scenarioDisplayName('removed-scenario')).toBe('Imported game');
  });

  it('orders scenarios by file name so the title screen list is stable', () => {
    const catalog = buildCatalog({
      './scenarios/b.json': minimal('b'),
      './scenarios/a.json': minimal('a'),
    });
    expect(catalog.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('rejects two files that declare the same scenario id', () => {
    expect(() =>
      buildCatalog({ './scenarios/a.json': minimal('dup'), './scenarios/b.json': minimal('dup') }),
    ).toThrow(/Duplicate scenario id dup/);
  });

  it('fails the whole catalog when one scenario file is malformed', () => {
    expect(() => buildCatalog({ './scenarios/bad.json': { id: 'bad' } })).toThrow(/Scenario bad/);
  });
});

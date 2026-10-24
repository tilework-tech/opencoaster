import { describe, expect, it } from 'vitest';
import { SimRunner } from './sim-runner';
import type { FromWorker } from './protocol';
import { parseScenarioFile } from '../sim/scenario/scenario-file';
import { findScenario } from '../sim/scenario/catalog';
import { ScenarioStatus } from '../sim/scenario/scenario';
import { deserialize } from '../save/save';

function harness() {
  const out: FromWorker[] = [];
  const clock = { now: 0 };
  const runner = new SimRunner({ post: (m) => out.push(m) }, () => clock.now);
  const take = <T extends FromWorker['type']>(type: T) =>
    out.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type);
  /** Pumps once to anchor the scheduler, then after 100 ms, so due ticks run and publish. */
  const pumpTicks = () => {
    runner.pump();
    clock.now += 100;
    runner.pump();
  };
  return { runner, out, take, pumpTicks };
}

function latestSnapshot(out: FromWorker[]) {
  const snaps = out.filter((m) => m.type === 'snapshot');
  const last = snaps[snaps.length - 1];
  if (!last || last.type !== 'snapshot') throw new Error('no snapshot');
  return last.snapshot;
}

const starter = () => {
  const def = findScenario('starter');
  if (!def) throw new Error('starter scenario missing');
  return def;
};

describe('SimRunner game lifecycle', () => {
  it('starts a scenario with its finances and objective', () => {
    const { runner, take, out, pumpTicks } = harness();
    const def = starter();
    runner.handle({
      type: 'init',
      seed: def.seed,
      width: def.mapWidth,
      height: def.mapHeight,
      initialGuests: 0,
      scenario: def,
    });
    expect(take('ready')).toHaveLength(1);
    pumpTicks();
    const snap = latestSnapshot(out);
    expect(snap.park.cash).toBe(def.startingCash);
    expect(snap.scenario.status).toBe(ScenarioStatus.Active);
    expect(snap.scenario.objective?.target).toBe(def.objective.target);
  });

  it('round-trips a running game through save and load', () => {
    const a = harness();
    const def = starter();
    a.runner.handle({
      type: 'init',
      seed: def.seed,
      width: def.mapWidth,
      height: def.mapHeight,
      initialGuests: 0,
      scenario: def,
    });
    a.runner.handle({ type: 'command', command: { type: 'spawnGuests', count: 5 } });
    a.runner.handle({ type: 'save' });
    const saved = a.take('saved');
    expect(saved).toHaveLength(1);
    const bytes = saved[0].bytes;

    const b = harness();
    b.runner.handle({ type: 'load', bytes });
    expect(b.take('loaded')).toHaveLength(1);
    expect(b.take('map')).toHaveLength(1);
    b.runner.handle({ type: 'save' });
    expect(Buffer.compare(Buffer.from(b.take('saved')[0].bytes), Buffer.from(bytes))).toBe(0);
    expect(deserialize(bytes).economy.cash).toBe(def.startingCash);
  });

  it('reports a load of bytes that are not a save without touching the running game', () => {
    const { runner, take } = harness();
    const def = starter();
    runner.handle({
      type: 'init',
      seed: def.seed,
      width: def.mapWidth,
      height: def.mapHeight,
      initialGuests: 0,
      scenario: def,
    });
    runner.handle({ type: 'load', bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) });
    const errors = take('error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ request: 'load', message: 'Not an OpenCoaster save' });
    runner.handle({ type: 'save' });
    expect(take('saved')).toHaveLength(1);
  });

  it('refuses to save before any game has started', () => {
    const { runner, take } = harness();
    runner.handle({ type: 'save' });
    expect(take('error')).toEqual([
      { type: 'error', request: 'save', message: 'No game is running.' },
    ]);
  });

  it('can load a save into a worker that has never been initialised', () => {
    const source = harness();
    const def = starter();
    source.runner.handle({
      type: 'init',
      seed: def.seed,
      width: def.mapWidth,
      height: def.mapHeight,
      initialGuests: 0,
      scenario: def,
    });
    source.runner.handle({ type: 'save' });
    const fresh = harness();
    fresh.runner.handle({ type: 'load', bytes: source.take('saved')[0].bytes });
    expect(fresh.take('loaded')).toHaveLength(1);
    fresh.pumpTicks();
    expect(latestSnapshot(fresh.out).park.cash).toBe(def.startingCash);
  });
});

describe('scenario definitions from JSON', () => {
  it('a parsed file can be started directly by the runner', () => {
    const { runner, take } = harness();
    const def = parseScenarioFile({
      id: 'inline',
      name: 'Inline',
      seed: 3,
      map: { width: 32, height: 32 },
      finance: { startingCash: 900, startingLoan: 0, maxLoan: 0, annualInterestBps: 0 },
      pricing: { mode: 'free' },
      objective: { kind: 'guests', target: 1, byYear: 1 },
    });
    runner.handle({
      type: 'init',
      seed: def.seed,
      width: def.mapWidth,
      height: def.mapHeight,
      initialGuests: 0,
      scenario: def,
    });
    expect(take('error')).toHaveLength(0);
    expect(take('map')).toHaveLength(1);
  });
});

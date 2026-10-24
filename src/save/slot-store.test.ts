import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/core/simulation';
import { serialize, summarizeSave } from './save';
import { createMemorySlotStore } from './slot-store';
import type { SaveSlot } from './slot-store';

function slot(id: string, savedAt: number): SaveSlot {
  return {
    id,
    name: `Slot ${id}`,
    savedAt,
    scenarioId: 'starter',
    tick: 10,
    cash: 500,
    loan: 0,
    bytes: new Uint8Array([1, 2, 3]),
  };
}

describe('memory slot store', () => {
  it('lists saves newest first without their bytes', async () => {
    const store = createMemorySlotStore();
    await store.put(slot('a', 100));
    await store.put(slot('b', 300));
    await store.put(slot('c', 200));
    const list = await store.list();
    expect(list.map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect('bytes' in list[0]).toBe(false);
  });

  it('returns the bytes of one slot and nothing for an unknown id', async () => {
    const store = createMemorySlotStore();
    await store.put(slot('a', 1));
    expect(Array.from((await store.get('a'))?.bytes ?? [])).toEqual([1, 2, 3]);
    expect(await store.get('missing')).toBeUndefined();
  });

  it('overwrites a slot with the same id and removes slots', async () => {
    const store = createMemorySlotStore();
    await store.put(slot('a', 1));
    await store.put({ ...slot('a', 5), name: 'Renamed' });
    expect(await store.list()).toHaveLength(1);
    expect((await store.list())[0].name).toBe('Renamed');
    await store.remove('a');
    expect(await store.list()).toEqual([]);
  });
});

describe('summarizeSave', () => {
  it('reads the tick and finances from a save without loading the world', () => {
    const sim = new Simulation({ seed: 3, width: 16, height: 16 });
    sim.world.economy.cash = 123_456;
    sim.world.economy.loan = 7_000;
    for (let i = 0; i < 25; i++) sim.step();
    const summary = summarizeSave(serialize(sim.world));
    expect(summary).toEqual({ version: expect.any(Number), tick: 25, cash: 123_456, loan: 7_000 });
  });

  it('rejects bytes that are not a save', () => {
    expect(() => summarizeSave(new Uint8Array(40))).toThrow(/Not an OpenCoaster save/);
    expect(() => summarizeSave(new Uint8Array(3))).toThrow(/Not an OpenCoaster save/);
  });
});

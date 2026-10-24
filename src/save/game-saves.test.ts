import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/core/simulation';
import { serialize } from './save';
import { exportFileName, saveGameToSlot } from './game-saves';
import { createMemorySlotStore } from './slot-store';

describe('saveGameToSlot', () => {
  it('stores the game bytes with listing details read from the save', async () => {
    const sim = new Simulation({ seed: 4, width: 16, height: 16 });
    sim.world.economy.cash = 42_000;
    sim.world.economy.loan = 1_000;
    for (let i = 0; i < 9; i++) sim.step();
    const store = createMemorySlotStore();
    const meta = await saveGameToSlot({ save: async () => serialize(sim.world) }, store, {
      id: 'slot-1',
      name: 'My park',
      scenarioId: 'starter',
      savedAt: 1_000,
    });
    expect(meta).toEqual({
      id: 'slot-1',
      name: 'My park',
      savedAt: 1_000,
      scenarioId: 'starter',
      tick: 9,
      cash: 42_000,
      loan: 1_000,
    });
    expect(await store.list()).toEqual([meta]);
    const stored = await store.get('slot-1');
    expect(stored).toBeDefined();
    expect(
      Buffer.compare(Buffer.from(stored?.bytes ?? []), Buffer.from(serialize(sim.world))),
    ).toBe(0);
  });

  it('overwrites the slot it is given', async () => {
    const store = createMemorySlotStore();
    const source = (tick: number) => ({
      save: async () => {
        const sim = new Simulation({ seed: 4, width: 8, height: 8 });
        for (let i = 0; i < tick; i++) sim.step();
        return serialize(sim.world);
      },
    });
    await saveGameToSlot(source(1), store, { id: 's', name: 'A', scenarioId: 'x', savedAt: 1 });
    await saveGameToSlot(source(3), store, { id: 's', name: 'A', scenarioId: 'x', savedAt: 2 });
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].tick).toBe(3);
  });
});

describe('exportFileName', () => {
  it('is a filesystem-safe name with the scenario and minute', () => {
    expect(exportFileName('starter', Date.UTC(2026, 9, 24, 9, 30))).toBe(
      'opencoaster-starter-2026-10-24-09-30.ocsave',
    );
  });

  it('strips characters that could break a file name from the scenario id', () => {
    expect(exportFileName('../evil id', 0)).toMatch(/^opencoaster-evilid-/);
  });
});

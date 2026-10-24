import { describe, expect, it } from 'vitest';
import { EntityStore } from './entity-store';

const schema = { a: Int32Array, b: Uint8Array } as const;

describe('EntityStore', () => {
  it('spawns zeroed entities with stable ids', () => {
    const s = new EntityStore(schema, 4);
    const slot = s.spawn();
    expect(slot).toBe(0);
    expect(s.cols.a[0]).toBe(0);
    expect(s.isAlive(s.slotToId[slot])).toBe(true);
  });

  it('returns -1 when full', () => {
    const s = new EntityStore(schema, 2);
    s.spawn();
    s.spawn();
    expect(s.spawn()).toBe(-1);
  });

  it('swap-removes and keeps id mapping consistent', () => {
    const s = new EntityStore(schema, 4);
    for (let i = 0; i < 3; i++) s.cols.a[s.spawn()] = (i + 1) * 10;
    const firstId = s.slotToId[0];
    const lastId = s.slotToId[2];
    s.despawnId(firstId);
    expect(s.count).toBe(2);
    expect(s.isAlive(firstId)).toBe(false);
    expect(s.idToSlot[lastId]).toBe(0);
    expect(s.cols.a[0]).toBe(30);
  });

  it('zeroes recycled slots on spawn', () => {
    const s = new EntityStore(schema, 2);
    s.cols.a[s.spawn()] = 99;
    s.despawnSlot(0);
    const slot = s.spawn();
    expect(s.cols.a[slot]).toBe(0);
  });
});

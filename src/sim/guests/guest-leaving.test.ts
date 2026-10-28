import { describe, expect, it } from 'vitest';
import { flatWorld, guestAt, layPath, row } from '../integration/fixtures';
import type { World } from '../core/world';
import { GuestState, GuestThought, recordThought } from './guest-store';
import { guestSystem } from './guest-system';
import { setParkEntrance } from './park';

function parkWithGuest(seed: number): { w: World; slot: number } {
  const w = flatWorld(16, 8);
  layPath(w, row(5, 2, 8));
  const slot = guestAt(w, 4, 5);
  setParkEntrance(w, 2, 5);
  w.rng.seed(seed);
  const g = w.guests.cols;
  g.ridesTaken[slot] = 3;
  g.visitTicks[slot] = 20_000;
  g.happiness[slot] = 200;
  g.happinessTarget[slot] = 200;
  g.energy[slot] = 100;
  g.cash[slot] = 5000;
  g.hunger[slot] = 200;
  g.thirst[slot] = 200;
  g.toilet[slot] = 0;
  return { w, slot };
}

function leaversOver(seeds: number, tweak: (w: World, slot: number) => void): number {
  let leavers = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const { w, slot } = parkWithGuest(seed);
    tweak(w, slot);
    w.tick = 512 * 40 - w.guests.slotToId[slot];
    guestSystem.update(w);
    if (w.guests.cols.state[slot] === GuestState.Leaving) leavers++;
  }
  return leavers;
}

describe('guests deciding to leave', () => {
  it('keeps content guests with energy, happiness and cash', () => {
    expect(leaversOver(400, () => {})).toBe(0);
  });

  it.each([
    ['unhappy', (w: World, s: number) => (w.guests.cols.happiness[s] = 30)],
    ['tired', (w: World, s: number) => (w.guests.cols.energy[s] = 40)],
    ['broke', (w: World, s: number) => (w.guests.cols.cash[s] = 100)],
  ])('lets an %s guest leave on roughly one idle check in twenty', (_name, tweak) => {
    const leavers = leaversOver(800, tweak);
    expect(leavers).toBeGreaterThan(20);
    expect(leavers).toBeLessThan(70);
  });

  it('decides between tiles, not only when standing at a tile centre', () => {
    const leavers = leaversOver(800, (w, s) => {
      w.guests.cols.happiness[s] = 30;
      w.guests.cols.x[s] += 64;
    });
    expect(leavers).toBeGreaterThan(20);
  });

  it('records the leaving thought', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { w, slot } = parkWithGuest(seed);
      w.guests.cols.happiness[slot] = 10;
      w.tick = 512 * 40 - w.guests.slotToId[slot];
      guestSystem.update(w);
      if (w.guests.cols.state[slot] === GuestState.Leaving) {
        expect(w.guests.cols.thought0[slot] + w.guests.cols.thought1[slot]).toBeGreaterThan(0);
        return;
      }
    }
    throw new Error('no guest left');
  });
});

describe('guest energy', () => {
  it('never falls below the original minimum of 32', () => {
    const { w, slot } = parkWithGuest(1);
    w.guests.cols.energy[slot] = 33;
    for (let i = 1; i <= 6; i++) {
      w.tick = 512 * i - w.guests.slotToId[slot];
      guestSystem.update(w);
    }
    expect(w.guests.cols.energy[slot]).toBe(32);
  });
});

describe('guest thoughts', () => {
  it('moves a repeated thought to the newest slot instead of duplicating it', () => {
    const { w, slot } = parkWithGuest(1);
    recordThought(w, slot, GuestThought.Hungry);
    recordThought(w, slot, GuestThought.Tired);
    recordThought(w, slot, GuestThought.Hungry);
    const g = w.guests.cols;
    const ring = [g.thought0[slot], g.thought1[slot], g.thought2[slot], g.thought3[slot]];
    expect(ring.filter((t) => t === GuestThought.Hungry)).toHaveLength(1);
    expect(ring.filter((t) => t === GuestThought.Tired)).toHaveLength(1);
    const newest = ring[(g.thoughtCursor[slot] + 3) & 3];
    expect(newest).toBe(GuestThought.Hungry);
  });

  it('only thinks it is tired when energy is low and the guest is not happy', () => {
    const tiredThoughtWith = (happiness: number): boolean => {
      const { w, slot } = parkWithGuest(1);
      w.guests.cols.energy[slot] = 40;
      w.guests.cols.happiness[slot] = happiness;
      w.guests.cols.happinessTarget[slot] = happiness;
      w.tick = 1024 * 4 - w.guests.slotToId[slot];
      guestSystem.update(w);
      const g = w.guests.cols;
      return [g.thought0[slot], g.thought1[slot], g.thought2[slot], g.thought3[slot]].includes(
        GuestThought.Tired,
      );
    };
    expect(tiredThoughtWith(100)).toBe(true);
    expect(tiredThoughtWith(200)).toBe(false);
  });

  it('raises need thoughts once per 1,024 ticks, not on every need update', () => {
    const { w, slot } = parkWithGuest(1);
    w.guests.cols.hunger[slot] = 3;
    w.tick = 128 * 9 - w.guests.slotToId[slot];
    guestSystem.update(w);
    expect(w.guests.cols.thought0[slot]).toBe(GuestThought.None);
    w.tick = 1024 * 4 - w.guests.slotToId[slot];
    guestSystem.update(w);
    expect(w.guests.cols.thought0[slot]).toBe(GuestThought.Hungry);
  });
});

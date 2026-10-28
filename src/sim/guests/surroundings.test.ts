import { describe, expect, it } from 'vitest';
import { Z_STEP, TILE_UNITS } from '../core/constants';
import { flatWorld, guestAt } from '../integration/fixtures';
import { ElementType } from '../map/tile-map';
import { GuestThought } from './guest-store';
import { guestSystem } from './guest-system';
import { updateGuestSurroundings } from './surroundings';

describe('guest surroundings', () => {
  it('rewards scenery-rich areas with a scenery thought', () => {
    const world = flatWorld(20);
    const slot = guestAt(world, 10, 10);
    world.guests.cols.happiness[slot] = 100;
    world.guests.cols.happinessTarget[slot] = 100;
    const center = world.map.index(10, 10);
    for (let i = 0; i < 40; i++) {
      const x = 5 + (i % 10);
      const y = 5 + Math.floor(i / 10);
      world.map.addElement(world.map.index(x, y), ElementType.SmallScenery, 4, 5, 0, i);
    }
    world.guests.cols.z[slot] = Z_STEP * 4;
    world.guests.cols.x[slot] = 10 * TILE_UNITS + TILE_UNITS / 2;
    world.guests.cols.y[slot] = 10 * TILE_UNITS + TILE_UNITS / 2;
    world.tick = 9216 - world.guests.slotToId[slot];

    guestSystem.update(world);

    expect(world.guests.cols.happinessTarget[slot]).toBe(144);
    expect(world.guests.cols.happiness[slot]).toBe(104);
    expect(world.guests.cols.thought0[slot]).toBe(GuestThought.Scenery);
    expect(world.map.heights[center]).toBe(4);
  });

  it('rewards a very clean area when no stronger surroundings thought applies', () => {
    const world = flatWorld(20);
    const slot = guestAt(world, 10, 10);
    world.guests.cols.happiness[slot] = 230;
    world.guests.cols.happinessTarget[slot] = 230;
    world.guests.cols.z[slot] = Z_STEP * 4;
    world.tick = 9216 - world.guests.slotToId[slot];

    updateGuestSurroundings(world, slot);

    expect(world.guests.cols.happinessTarget[slot]).toBe(255);
    expect(world.guests.cols.thought0[slot]).toBe(GuestThought.VeryClean);
  });

  it('applies the bonus at each clean-area assessment and caps happiness', () => {
    const world = flatWorld(20);
    const slot = guestAt(world, 10, 10);
    world.guests.cols.happiness[slot] = 100;
    world.guests.cols.happinessTarget[slot] = 100;

    for (const tick of [1, 2, 3].map((n) => 9216 * n - world.guests.slotToId[slot])) {
      world.tick = tick;
      updateGuestSurroundings(world, slot);
    }

    expect(world.guests.cols.happinessTarget[slot]).toBe(235);
    expect(world.guests.cols.thought0[slot]).toBe(GuestThought.VeryClean);
  });

  it('does not add a thought when the surrounding area exceeds the rubbish threshold', () => {
    const world = flatWorld(20);
    const slot = guestAt(world, 10, 10);
    world.guests.cols.happiness[slot] = 100;
    world.guests.cols.happinessTarget[slot] = 100;
    world.guests.cols.z[slot] = Z_STEP * 4;
    for (let i = 0; i < 8; i++) {
      world.litter.spawn();
      world.litter.cols.x[i] = (6 + i) * TILE_UNITS;
      world.litter.cols.y[i] = 10 * TILE_UNITS;
    }
    world.tick = 9216 - world.guests.slotToId[slot];

    updateGuestSurroundings(world, slot);

    expect(world.guests.cols.happiness[slot]).toBe(100);
    expect(world.guests.cols.thought0[slot]).toBe(GuestThought.None);
  });
});

describe('surroundings assessment cadence', () => {
  it('assesses each guest once per 18 idle-motive periods (9,216 ticks), not every 18 ticks', () => {
    const world = flatWorld(20);
    const slot = guestAt(world, 10, 10);
    world.guests.cols.happinessTarget[slot] = 100;
    const id = world.guests.slotToId[slot];

    for (let tick = 9216 + 4 - id; tick < 2 * 9216 - id; tick++) {
      world.tick = tick;
      updateGuestSurroundings(world, slot);
    }
    expect(world.guests.cols.happinessTarget[slot]).toBe(100);

    world.tick = 2 * 9216 - id;
    updateGuestSurroundings(world, slot);
    expect(world.guests.cols.happinessTarget[slot]).toBe(145);
  });
});

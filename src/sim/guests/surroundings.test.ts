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
    const center = world.map.index(10, 10);
    for (let i = 0; i < 40; i++) {
      const x = 5 + (i % 10);
      const y = 5 + Math.floor(i / 10);
      world.map.addElement(world.map.index(x, y), ElementType.SmallScenery, 4, 5, 0, i);
    }
    world.guests.cols.z[slot] = Z_STEP * 4;
    world.guests.cols.x[slot] = 10 * TILE_UNITS + TILE_UNITS / 2;
    world.guests.cols.y[slot] = 10 * TILE_UNITS + TILE_UNITS / 2;
    world.tick = (4 - (world.guests.slotToId[slot] & 3)) & 3;

    guestSystem.update(world);

    expect(world.guests.cols.happiness[slot]).toBe(145);
    expect(world.guests.cols.thought0[slot]).toBe(GuestThought.Scenery);
    expect(world.map.heights[center]).toBe(4);
  });

  it('rewards a very clean area when no stronger surroundings thought applies', () => {
    const world = flatWorld(20);
    const slot = guestAt(world, 10, 10);
    world.guests.cols.happiness[slot] = 230;
    world.guests.cols.z[slot] = Z_STEP * 4;
    world.tick = 3;

    updateGuestSurroundings(world, slot);

    expect(world.guests.cols.happiness[slot]).toBe(255);
    expect(world.guests.cols.thought0[slot]).toBe(GuestThought.VeryClean);
  });

  it('applies the bonus at each clean-area assessment and caps happiness', () => {
    const world = flatWorld(20);
    const slot = guestAt(world, 10, 10);
    world.guests.cols.happiness[slot] = 100;

    for (const tick of [3, 21, 39]) {
      world.tick = tick;
      updateGuestSurroundings(world, slot);
    }

    expect(world.guests.cols.happiness[slot]).toBe(235);
    expect(world.guests.cols.thought0[slot]).toBe(GuestThought.VeryClean);
  });

  it('does not add a thought when the surrounding area exceeds the rubbish threshold', () => {
    const world = flatWorld(20);
    const slot = guestAt(world, 10, 10);
    world.guests.cols.happiness[slot] = 100;
    world.guests.cols.z[slot] = Z_STEP * 4;
    for (let i = 0; i < 8; i++) {
      world.litter.spawn();
      world.litter.cols.x[i] = (6 + i) * TILE_UNITS;
      world.litter.cols.y[i] = 10 * TILE_UNITS;
    }
    world.tick = 3;

    updateGuestSurroundings(world, slot);

    expect(world.guests.cols.happiness[slot]).toBe(100);
    expect(world.guests.cols.thought0[slot]).toBe(GuestThought.None);
  });
});

import { describe, expect, it } from 'vitest';
import { RIDE_TABS, ridesInTab } from './ride-select';

describe('ride build categories', () => {
  it('offers rides in transport, gentle, coaster, thrill, water, and shops tabs', () => {
    for (const id of ['transport', 'gentle', 'coaster', 'thrill', 'water', 'shops']) {
      const tab = RIDE_TABS.find((entry) => entry.id === id);
      expect(tab, id).toBeDefined();
      expect(ridesInTab(tab!), id).not.toHaveLength(0);
    }
  });

  it('lists rides in their catalog category without duplicating them between tabs', () => {
    const all = RIDE_TABS.flatMap((tab) => ridesInTab(tab).map((ride) => ride.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it.each([
    ['Haunted House', 'thrill'],
    ['Spiral Slide', 'gentle'],
    ['Top Spin', 'thrill'],
    ['Enterprise', 'thrill'],
    ['Go-Karts', 'thrill'],
    ['Log Flume', 'water'],
    ['River Rapids', 'water'],
    ['Miniature Railway', 'transport'],
    ['Monorail', 'transport'],
    ['Chairlift', 'transport'],
    ['Junior Roller Coaster', 'coaster'],
    ['Wild Mouse Coaster', 'coaster'],
    ['Observation Tower', 'gentle'],
    ['Burger Stall', 'shops'],
  ])('lists %s in %s', (name, tabId) => {
    const tab = RIDE_TABS.find((entry) => entry.id === tabId);
    expect(tab, tabId).toBeDefined();
    if (!tab) return;
    expect(ridesInTab(tab).some((ride) => ride.name === name)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { renderUiIconSprite } from '../../../tools/sprites/ui-icons';
import type { IconName } from '../icons';
import { OPTIONS_TABS } from '../game-ui';
import { FINANCE_TABS } from './finance-window';
import { GUEST_SUMMARY_TABS, GUEST_TABS } from './guest-window';
import { MAP_TABS } from './map-window';
import { PARK_TABS } from './park-window';
import { PATH_TABS } from './path-window';
import { RESEARCH_TABS } from './research-window';
import { RIDE_WINDOW_TABS } from './ride-window';
import { NEW_RIDE_TABS } from './ride-select';
import { LIST_TABS } from './ride-list';
import { SCENERY_WINDOW } from './tool-windows';
import { STAFF_TABS } from './staff-window';
import { WORKER_TABS } from './worker-window';

const WINDOW_TABS = [
  ['Options', OPTIONS_TABS],
  ['Footpaths', PATH_TABS],
  ['New attraction', NEW_RIDE_TABS],
  ['Rides and attractions', LIST_TABS],
  ['Park', PARK_TABS],
  ['Staff', STAFF_TABS],
  ['Guests', GUEST_SUMMARY_TABS],
  ['Guest inspector', GUEST_TABS],
  ['Worker inspector', WORKER_TABS],
  ['Ride inspector', RIDE_WINDOW_TABS],
  ['Map', MAP_TABS],
  ['Research', RESEARCH_TABS],
  ['Finances', FINANCE_TABS],
  ['Scenery', SCENERY_WINDOW.tabs],
] as const;

function renderedArt(name: string): string {
  return renderUiIconSprite(name as IconName, 24).pixels.join(',');
}

describe('window tab icons', () => {
  it.each(WINDOW_TABS)('%s uses a distinct icon id for each tab', (_window, tabs) => {
    const iconIds = tabs.map((tab) => tab.icon ?? 'info');
    expect(new Set(iconIds).size).toBe(iconIds.length);
  });

  it.each(WINDOW_TABS)('%s draws different artwork for each tab', (_window, tabs) => {
    const art = tabs.map((tab) => renderedArt(tab.icon ?? 'info'));
    expect(new Set(art).size).toBe(art.length);
  });
});

import { RIDE_CATALOG } from '../../sim/rides/ride-types';
import type { RideCategory, RideType, RideTypeDef } from '../../sim/rides/ride-types';
import { button, element } from '../dom';
import { formatMoney } from '../format';
import { icon } from '../icons';
import type { IconName } from '../icons';
import type { TabSpec } from '../window-manager';
import type { UiContext, WindowController } from '../ui-types';

export interface RideTab extends TabSpec {
  categories: readonly RideCategory[];
}

export const RIDE_TABS: readonly RideTab[] = [
  { id: 'transport', label: 'Transport rides', icon: 'next', categories: ['transport'] },
  { id: 'coaster', label: 'Roller Coasters', icon: 'coaster', categories: ['coaster'] },
  { id: 'gentle', label: 'Gentle rides', icon: 'carousel', categories: ['gentle'] },
  { id: 'thrill', label: 'Thrill rides', icon: 'twist', categories: ['thrill'] },
  { id: 'water', label: 'Water rides', icon: 'water', categories: ['water'] },
  { id: 'shops', label: 'Shops & Stalls', icon: 'food', categories: ['shop', 'stall', 'facility'] },
];

/** The ride types listed under a tab, in catalog order. */
export function ridesInTab(tab: RideTab): RideTypeDef[] {
  return Object.values(RIDE_CATALOG).filter((def) => tab.categories.includes(def.category));
}

const RIDE_ICONS: Partial<Record<RideType, IconName>> = {
  1: 'carousel',
  2: 'ship',
  3: 'wheel',
  4: 'twist',
  5: 'food',
  6: 'drink',
  7: 'info',
  8: 'toilet',
  9: 'coaster',
  10: 'loop',
  11: 'rides',
  12: 'rides',
  13: 'ship',
  14: 'twist',
  15: 'rides',
  16: 'water',
  17: 'water',
  18: 'rides',
  19: 'rides',
  20: 'rides',
  21: 'coaster',
  22: 'coaster',
  23: 'rides',
  24: 'food',
};

export function rideIcon(type: number): IconName {
  return RIDE_ICONS[type as RideType] ?? 'rides';
}

/**
 * The "new ride" window: category tabs of ride and stall cards. Picking one arms the Ride tool.
 * A card is offered only once research has unlocked its ride type, as the snapshot reports it.
 */
export function openRideSelect(ctx: UiContext): WindowController {
  const { window: win, created } = ctx.windows.open({
    id: 'ride-select',
    title: 'New attraction',
    kind: 'build',
    width: 360,
    tabs: [...RIDE_TABS, { id: 'research', label: 'Research', icon: 'research' }],
    onClose: () => {
      if (ctx.currentTool() === 'ride') ctx.chooseTool('select');
    },
  });
  if (created) {
    for (const tab of RIDE_TABS) {
      const pane = win.pane(tab.id);
      pane.append(
        element('p', 'ui-help', 'Choose an attraction, then tap a tile you own to build it.'),
      );
      const empty = element('p', 'ui-help', 'Nothing in this group is unlocked yet.');
      empty.dataset.empty = '';
      empty.hidden = true;
      pane.append(empty);
      const grid = element('div', 'card-grid');
      const defs = ridesInTab(tab);
      if (defs.length === 0)
        grid.append(element('p', 'ui-help', 'Nothing in this group has been invented yet.'));
      for (const def of defs) {
        const card = button('', () => ctx.actions.chooseRideType(def.id), 'ride-card');
        card.dataset.rideType = String(def.id);
        card.setAttribute('aria-label', `${def.name}, ${formatMoney(def.cost)}`);
        card.append(
          icon(rideIcon(def.id)),
          element('span', 'ride-card-name', def.name),
          element('span', 'ride-card-cost', formatMoney(def.cost)),
        );
        grid.append(card);
      }
      pane.append(grid);
    }
    const research = win.pane('research');
    research.append(
      element('p', 'ui-help', 'New attractions are discovered through research.'),
      button('Open research', () => ctx.openWindow('research'), 'ui-button'),
    );
    win.showTab('coaster');
    const list = button('Ride list', () => ctx.openWindow('ride-list'), 'ui-button');
    win.body.append(list);
  }
  return {
    update(snapshot) {
      if (!snapshot) return;
      const unlocked = snapshot.research.unlockedRides;
      for (const card of win.root.querySelectorAll<HTMLElement>('[data-ride-type]')) {
        card.hidden = unlocked[Number(card.dataset.rideType)] !== 1;
      }
      for (const tab of RIDE_TABS) {
        const pane = win.pane(tab.id);
        const anyUnlocked = pane.querySelector('[data-ride-type]:not([hidden])') !== null;
        const empty = pane.querySelector<HTMLElement>('[data-empty]');
        if (empty) empty.hidden = anyUnlocked;
      }
    },
  };
}

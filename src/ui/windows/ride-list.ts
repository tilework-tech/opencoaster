import { RIDE_CATALOG } from '../../sim/rides/ride-types';
import { RideInfo, RIDE_INFO_STRIDE } from '../../worker/snapshot';
import type { Snapshot } from '../../worker/snapshot';
import { element } from '../dom';
import { formatMoney } from '../format';
import type { UiContext, WindowController } from '../ui-types';

export const RIDE_STATE_NAMES = ['Closed', 'Open', 'Testing', 'Broken down'] as const;

const LIST_TABS = [
  {
    id: 'rides',
    label: 'Rides',
    icon: 'rides',
    categories: ['gentle', 'thrill', 'coaster', 'water'],
  },
  { id: 'stalls', label: 'Shops and stalls', icon: 'food', categories: ['shop', 'stall'] },
  { id: 'facilities', label: 'Guest facilities', icon: 'toilet', categories: ['facility'] },
] as const;

/** Rides, shops/stalls and guest facilities in the park; tapping a row opens that object's window. */
export function openRideList(ctx: UiContext): WindowController {
  const { window: win } = ctx.windows.open({
    id: 'ride-list',
    title: 'Rides and attractions',
    kind: 'ride',
    width: 360,
    tabs: LIST_TABS.map(({ id, label, icon }) => ({ id, label, icon })),
  });
  const lists = new Map<string, HTMLElement>();
  const signatures = new Map<string, string>();
  for (const tab of LIST_TABS) {
    const list = element('ul', 'ride-list');
    list.setAttribute('aria-label', tab.label);
    win.pane(tab.id).append(list);
    lists.set(tab.id, list);
  }
  return {
    update(snapshot: Snapshot | null) {
      if (!snapshot) return;
      const rows = new Map<string, string[]>(LIST_TABS.map((tab) => [tab.id, []]));
      for (let i = 0; i < snapshot.rides.count; i++) {
        const o = i * RIDE_INFO_STRIDE;
        const i32 = snapshot.rideInfo;
        const def = RIDE_CATALOG[i32[o + RideInfo.Type] as keyof typeof RIDE_CATALOG];
        const tab = LIST_TABS.find((t) =>
          (t.categories as readonly string[]).includes(def?.category ?? 'gentle'),
        );
        rows
          .get(tab?.id ?? 'rides')!
          .push(
            `${i32[o + RideInfo.Id]}|${def?.name ?? 'Ride'}|${RIDE_STATE_NAMES[i32[o + RideInfo.State]] ?? ''}|${i32[o + RideInfo.QueueLength]}|${i32[o + RideInfo.Price]}`,
          );
      }
      for (const [tabId, tabRows] of rows) {
        const next = tabRows.join('\n');
        if (next === signatures.get(tabId)) continue;
        signatures.set(tabId, next);
        const list = lists.get(tabId)!;
        if (tabRows.length === 0) {
          list.replaceChildren(element('li', 'ui-help', 'None have been built yet.'));
          continue;
        }
        list.replaceChildren(
          ...tabRows.map((row) => {
            const [id, name, state, queue, price] = row.split('|');
            const item = element('li');
            const open = element('button', 'list-row');
            open.type = 'button';
            open.dataset.rideId = id;
            open.append(
              element('span', 'list-name', `${name} #${id}`),
              element(
                'span',
                'list-meta',
                `${state} · queue ${queue} · ${formatMoney(Number(price))}`,
              ),
            );
            open.addEventListener('click', () => ctx.openRide(Number(id)));
            item.append(open);
            return item;
          }),
        );
      }
    },
  };
}

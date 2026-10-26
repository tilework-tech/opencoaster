import { RIDE_CATALOG } from '../../sim/rides/ride-types';
import { RideInfo, RIDE_INFO_STRIDE } from '../../worker/snapshot';
import type { Snapshot } from '../../worker/snapshot';
import { element, setText } from '../dom';
import { formatMoney } from '../format';
import type { UiContext, WindowController } from '../ui-types';

export const RIDE_STATE_NAMES = ['Closed', 'Open', 'Testing', 'Broken down'] as const;

interface RideListRow {
  item: HTMLLIElement;
  name: HTMLSpanElement;
  meta: HTMLSpanElement;
}

export const LIST_TABS = [
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
  const renderedRows = new Map<string, Map<string, RideListRow>>();
  for (const tab of LIST_TABS) {
    const list = element('ul', 'ride-list');
    list.setAttribute('aria-label', tab.label);
    list.addEventListener('click', (event) => {
      const row = (event.target as HTMLElement).closest<HTMLButtonElement>('.list-row');
      if (row?.dataset.rideId) ctx.openRide(Number(row.dataset.rideId));
    });
    win.pane(tab.id).append(list);
    lists.set(tab.id, list);
    renderedRows.set(tab.id, new Map());
  }
  return {
    update(snapshot: Snapshot | null) {
      if (!snapshot) return;
      const rows = new Map<
        string,
        { id: string; name: string; state: string; queue: number; price: number }[]
      >(LIST_TABS.map((tab) => [tab.id, []]));
      for (let i = 0; i < snapshot.rides.count; i++) {
        const o = i * RIDE_INFO_STRIDE;
        const i32 = snapshot.rideInfo;
        const id = String(i32[o + RideInfo.Id]);
        const def = RIDE_CATALOG[i32[o + RideInfo.Type] as keyof typeof RIDE_CATALOG];
        const tab = LIST_TABS.find((t) =>
          (t.categories as readonly string[]).includes(def?.category ?? 'gentle'),
        );
        rows.get(tab?.id ?? 'rides')!.push({
          id,
          name: def?.name ?? 'Ride',
          state: RIDE_STATE_NAMES[i32[o + RideInfo.State]] ?? '',
          queue: i32[o + RideInfo.QueueLength],
          price: i32[o + RideInfo.Price],
        });
      }
      for (const [tabId, tabRows] of rows) {
        const list = lists.get(tabId)!;
        const rendered = renderedRows.get(tabId)!;
        if (tabRows.length === 0) {
          for (const row of rendered.values()) row.item.remove();
          rendered.clear();
          if (!list.querySelector('.ui-help'))
            list.replaceChildren(element('li', 'ui-help', 'None have been built yet.'));
          continue;
        }
        list.querySelector('.ui-help')?.remove();
        const present = new Set(tabRows.map((row) => row.id));
        for (const [id, row] of rendered) {
          if (present.has(id)) continue;
          row.item.remove();
          rendered.delete(id);
        }
        for (const [index, row] of tabRows.entries()) {
          let nodes = rendered.get(row.id);
          if (!nodes) {
            const item = element('li');
            const open = element('button', 'list-row');
            open.type = 'button';
            open.dataset.rideId = row.id;
            const name = element('span', 'list-name');
            const meta = element('span', 'list-meta');
            open.append(name, meta);
            item.append(open);
            nodes = { item, name, meta };
            rendered.set(row.id, nodes);
          }
          setText(nodes.name, `${row.name} ${row.id + 1}`);
          setText(nodes.meta, `${row.state} · queue ${row.queue} · ${formatMoney(row.price)}`);
          const atIndex = list.children[index] ?? null;
          if (atIndex !== nodes.item) list.insertBefore(nodes.item, atIndex);
        }
      }
    },
  };
}

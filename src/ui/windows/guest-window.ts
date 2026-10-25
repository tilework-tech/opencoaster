import { RIDE_CATALOG } from '../../sim/rides/ride-types';
import { VoucherKind } from '../../sim/economy/vouchers';
import { TILE_UNITS } from '../../sim/core/constants';
import { RideInfo, RIDE_INFO_STRIDE, GUEST_DETAIL_STRIDE } from '../../worker/snapshot';
import type { Snapshot } from '../../worker/snapshot';
import { button, element, gauge, setText, statRow } from '../dom';
import { formatMoney } from '../format';
import type { TabSpec } from '../window-manager';
import type { UiContext, WindowController } from '../ui-types';

export const THOUGHT_LABELS: readonly string[] = [
  'No thought',
  'Hungry',
  'Thirsty',
  'Needs the toilet',
  'Feeling nauseous',
  'Ride is too intense',
  'Ride enjoyed',
  'Queue is too long',
  'Leaving the park',
  "I'm lost!",
];

export interface GuestDetails {
  happiness: number;
  hunger: number;
  thirst: number;
  toilet: number;
  nausea: number;
  energy: number;
  cash: number;
  thoughts: readonly number[];
}

export interface GuestSummaryRow {
  id: number;
  thought: number;
  tileX: number;
  tileY: number;
  rideIds: readonly number[];
}

export type GuestSummaryFilter =
  | { kind: 'all' }
  | { kind: 'thought'; value: number }
  | { kind: 'location'; x: number; y: number }
  | { kind: 'ride'; value: number };

export function filterGuestSummary(
  guests: readonly GuestSummaryRow[],
  filter: GuestSummaryFilter,
): GuestSummaryRow[] {
  return guests.filter((guest) => {
    if (guest.id <= 0) return false;
    if (filter.kind === 'thought') return guest.thought === filter.value;
    if (filter.kind === 'location') return guest.tileX === filter.x && guest.tileY === filter.y;
    if (filter.kind === 'ride') return guest.rideIds.includes(filter.value);
    return true;
  });
}

/** A cursor points at the next write, so walking backwards returns newest entries first. */
export function orderedHistory(cursor: number, ring: readonly number[]): number[] {
  if (ring.length === 0) return [];
  const next = ((cursor % ring.length) + ring.length) % ring.length;
  return Array.from(
    { length: ring.length },
    (_, i) => ring[(next + ring.length - 1 - i) % ring.length]!,
  ).filter((id) => id > 0);
}

export function guestDetailsText(details: GuestDetails): string {
  const thoughts = details.thoughts
    .filter((thought) => thought > 0)
    .map((thought) => THOUGHT_LABELS[thought] ?? `Thought ${thought}`);
  return [
    `Happiness  ${details.happiness}`,
    `Hunger satisfaction  ${details.hunger}`,
    `Thirst satisfaction  ${details.thirst}`,
    `Toilet  ${details.toilet}`,
    `Nausea  ${details.nausea}`,
    `Energy  ${details.energy}`,
    `Cash  $${(details.cash / 100).toFixed(2)}`,
    'Thoughts',
    ...(thoughts.length ? thoughts : ['No recent thoughts']),
  ].join('\n');
}

/** Describes the voucher a guest carries and the ride or stall it names. */
export function voucherText(kind: number, targetName: string): string {
  if (kind === VoucherKind.FreeRide) return `Voucher: free ride on ${targetName}`;
  if (kind === VoucherKind.FreeFoodOrDrink) return `Voucher: free food or drink at ${targetName}`;
  return 'Carrying no vouchers.';
}

export function guestSelectionText(details: string, tick: number): string {
  return `Selection at tick ${tick}\n${details}`;
}

const SUMMARY_TABS: readonly TabSpec[] = [
  { id: 'all', label: 'Guests', icon: 'guests' },
  { id: 'thought', label: 'By thought', icon: 'news' },
  { id: 'location', label: 'By location', icon: 'map' },
  { id: 'ride', label: 'By ride', icon: 'rides' },
];

const GUEST_TABS: readonly TabSpec[] = [
  { id: 'view', label: 'View', icon: 'guests' },
  { id: 'stats', label: 'Stats', icon: 'info' },
  { id: 'rides', label: 'Rides', icon: 'rides' },
  { id: 'cash', label: 'Cash info', icon: 'cash' },
  { id: 'thoughts', label: 'Recent thoughts', icon: 'news' },
  { id: 'items', label: 'Carrying', icon: 'bin' },
];

const NEED_MAX = 255;

function summaryRows(snapshot: Snapshot | null): GuestSummaryRow[] {
  if (!snapshot) return [];
  const count = Math.min(
    snapshot.guests.count,
    snapshot.guestIds.length,
    Math.floor(snapshot.guestDetails.length / GUEST_DETAIL_STRIDE),
  );
  const result: GuestSummaryRow[] = [];
  for (let i = 0; i < count; i++) {
    const id = snapshot.guestIds[i] ?? 0;
    const layer = i * 4;
    const details = i * GUEST_DETAIL_STRIDE;
    const cursor = snapshot.guestDetails[details + 7] ?? 0;
    const thought = snapshot.guestDetails[details + 8 + ((cursor + 3) & 3)] ?? 0;
    result.push({
      id,
      thought,
      tileX: Math.floor((snapshot.guests.data[layer] ?? 0) / TILE_UNITS),
      tileY: Math.floor((snapshot.guests.data[layer + 1] ?? 0) / TILE_UNITS),
      rideIds: Array.from({ length: 4 }, (_, j) => snapshot.guestDetails[details + 13 + j] ?? 0),
    });
  }
  return result;
}

function selectedSummary(filter: string, rows: readonly GuestSummaryRow[]): GuestSummaryRow[] {
  if (filter.startsWith('thought:'))
    return filterGuestSummary(rows, { kind: 'thought', value: Number(filter.slice(8)) });
  if (filter.startsWith('location:')) {
    const [x, y] = filter.slice(9).split(',').map(Number);
    return filterGuestSummary(rows, { kind: 'location', x: x ?? -1, y: y ?? -1 });
  }
  if (filter.startsWith('ride:'))
    return filterGuestSummary(rows, { kind: 'ride', value: Number(filter.slice(5)) });
  return filterGuestSummary(rows, { kind: 'all' });
}

function rideName(snapshot: Snapshot, id: number): string {
  for (let i = 0; i < snapshot.rides.count; i++) {
    const offset = i * RIDE_INFO_STRIDE;
    if (snapshot.rideInfo[offset + RideInfo.Id] !== id) continue;
    const type = snapshot.rideInfo[offset + RideInfo.Type];
    return `${RIDE_CATALOG[type as keyof typeof RIDE_CATALOG]?.name ?? 'Ride'} #${id}`;
  }
  return `Ride #${id}`;
}

/** Park-wide guest list and summaries, with filters by thought, location and ride. */
export function openGuestWindow(ctx: UiContext): WindowController {
  const { window: win, created } = ctx.windows.open({
    id: 'guests',
    title: 'Guests',
    kind: 'guest',
    width: 340,
    tabs: SUMMARY_TABS,
  });
  const controls = new Map<string, HTMLSelectElement>();
  const optionSignatures = new Map<string, string>();
  const lists = new Map<string, HTMLElement>();
  const counts = new Map<string, HTMLElement>();
  const average = statRow('Average happiness');
  let currentRows: GuestSummaryRow[] = [];
  let currentRideNames = new Map<number, string>();
  if (created) {
    win.body.prepend(average.row);
    for (const tab of SUMMARY_TABS) {
      const pane = win.pane(tab.id);
      const control = element('select', 'guest-filter');
      control.setAttribute('aria-label', `Filter guests ${tab.label.toLowerCase()}`);
      const list = element('ul', 'guest-list');
      list.setAttribute('aria-label', 'Guests');
      const count = element('p', 'ui-help', '0 guests');
      pane.append(control, count, list);
      controls.set(tab.id, control);
      optionSignatures.set(tab.id, '');
      lists.set(tab.id, list);
      counts.set(tab.id, count);
      control.addEventListener('change', () => refreshSummary(currentRows, currentRideNames));
    }
  }
  function refreshSummary(
    rows: readonly GuestSummaryRow[],
    rideNames: ReadonlyMap<number, string>,
  ): void {
    for (const [tab, control] of controls) {
      const old = control.value;
      const options: Array<[string, string]> = [['all', 'All guests']];
      if (tab === 'thought') {
        for (let thought = 1; thought < THOUGHT_LABELS.length; thought++)
          options.push([`thought:${thought}`, THOUGHT_LABELS[thought]!]);
      } else if (tab === 'location') {
        const locations = new Map<string, string>();
        for (const row of rows)
          locations.set(`${row.tileX},${row.tileY}`, `Tile ${row.tileX}, ${row.tileY}`);
        for (const [key, label] of locations) options.push([`location:${key}`, label]);
      } else if (tab === 'ride') {
        const ids = new Set(rows.flatMap((row) => row.rideIds).filter((id) => id > 0));
        for (const id of ids) options.push([`ride:${id}`, rideNames.get(id) ?? `Ride #${id}`]);
      }
      const optionSignature = options.map(([value, label]) => `${value}:${label}`).join('|');
      if (optionSignatures.get(tab) !== optionSignature) {
        control.replaceChildren(
          ...options.map(([value, label]) => {
            const option = element('option', '', label);
            option.value = value;
            return option;
          }),
        );
        optionSignatures.set(tab, optionSignature);
      }
      if (options.some(([value]) => value === old)) control.value = old;
      const matching = selectedSummary(control.value, rows);
      setText(counts.get(tab)!, `${matching.length} guest${matching.length === 1 ? '' : 's'}`);
      const list = lists.get(tab)!;
      const signature = matching.map((guest) => guest.id).join(',');
      const label = (guest: GuestSummaryRow): string => {
        const thought =
          THOUGHT_LABELS[guest.thought] ??
          (guest.thought ? `Thought ${guest.thought}` : 'No recent thought');
        return `Guest ${guest.id} · tile ${guest.tileX}, ${guest.tileY} · ${thought}`;
      };
      if (list.dataset.signature === signature) {
        const buttons = list.querySelectorAll<HTMLButtonElement>('.guest-entry');
        matching.forEach((guest, index) => {
          const entry = buttons[index];
          if (entry) entry.textContent = label(guest);
        });
        continue;
      }
      list.dataset.signature = signature;
      const buttons = matching.map((guest) => {
        const line = element('li');
        const open = button(label(guest), () => ctx.openGuest(guest.id), 'ui-button guest-entry');
        open.dataset.guestId = String(guest.id);
        line.append(open);
        return line;
      });
      list.replaceChildren(...buttons);
    }
  }
  return {
    update(snapshot: Snapshot | null) {
      const rows = summaryRows(snapshot);
      currentRows = rows;
      currentRideNames = new Map();
      if (snapshot) {
        for (const row of rows)
          for (const id of row.rideIds)
            if (id > 0 && !currentRideNames.has(id))
              currentRideNames.set(id, rideName(snapshot, id));
      }
      const n = Math.min(rows.length, snapshot?.guests.count ?? 0);
      let sum = 0;
      for (let i = 0; snapshot && i < n; i++)
        sum += snapshot.guestDetails[i * GUEST_DETAIL_STRIDE] ?? 0;
      setText(average.value, n ? String(Math.round(sum / n)) : '-');
      refreshSummary(rows, currentRideNames);
    },
  };
}

/** Opens an ID-stable guest window with the six information tabs. */
export function openIndividualGuestWindow(ctx: UiContext, guestId: number): WindowController {
  const id = `guest-${guestId}`;
  const { window: win, created } = ctx.windows.open({
    id,
    title: `Guest ${guestId}`,
    kind: 'guest',
    width: 340,
    tabs: GUEST_TABS,
  });
  const where = statRow('Where');
  const gauges = {
    happiness: gauge('Happiness'),
    hunger: gauge('Hunger satisfaction'),
    thirst: gauge('Thirst satisfaction'),
    toilet: gauge('Toilet'),
    nausea: gauge('Nausea'),
    energy: gauge('Energy'),
  };
  const cash = statRow('Cash');
  const voucher = element('p', 'ui-help', 'Carrying no vouchers.');
  const thoughts = element('ul', 'thought-list');
  thoughts.setAttribute('aria-label', 'Guest thoughts');
  const rides = element('ul', 'guest-ride-history');
  rides.setAttribute('aria-label', 'Ride history');
  let location: { x: number; y: number } | null = null;
  if (created) {
    const locate = () => {
      if (location) ctx.actions.locate(location.x, location.y);
    };
    win.pane('view').append(
      where.row,
      button('Locate', locate, 'ui-button'),
      Object.assign(button('Track guest', locate, 'ui-button'), {
        disabled: true,
        title: 'Following a guest is not available yet.',
      }),
    );
    win.pane('stats').append(...Object.values(gauges).map((item) => item.row));
    win.pane('rides').append(rides);
    win.pane('cash').append(cash.row);
    win.pane('thoughts').append(thoughts);
    win.pane('items').append(voucher);
  }
  let signature = '';
  return {
    update(snapshot: Snapshot | null) {
      const row = guestRow(snapshot, guestId);
      if (!snapshot || row === null) {
        location = null;
        win.setTitle(`Guest ${guestId} · left park`);
        setText(where.value, 'No longer in the park');
        return;
      }
      const layer = row * 4;
      const offset = row * GUEST_DETAIL_STRIDE;
      const data = snapshot.guestDetails;
      const x = Math.floor((snapshot.guests.data[layer] ?? 0) / TILE_UNITS);
      const y = Math.floor((snapshot.guests.data[layer + 1] ?? 0) / TILE_UNITS);
      location = { x, y };
      const state =
        (['walking', 'queueing', 'riding', 'leaving', 'shopping', 'waiting to board'] as const)[
          snapshot.guests.data[layer + 3]! >>> 8
        ] ?? 'unknown';
      win.setTitle(`Guest ${guestId}`);
      setText(where.value, `tile ${x}, ${y} · ${state}`);
      gauges.happiness.set((data[offset] ?? 0) / NEED_MAX, String(data[offset] ?? 0));
      gauges.hunger.set((data[offset + 1] ?? 0) / NEED_MAX, String(data[offset + 1] ?? 0));
      gauges.thirst.set((data[offset + 2] ?? 0) / NEED_MAX, String(data[offset + 2] ?? 0));
      gauges.toilet.set((data[offset + 3] ?? 0) / NEED_MAX, String(data[offset + 3] ?? 0));
      gauges.nausea.set((data[offset + 4] ?? 0) / NEED_MAX, String(data[offset + 4] ?? 0));
      gauges.energy.set((data[offset + 5] ?? 0) / NEED_MAX, String(data[offset + 5] ?? 0));
      setText(cash.value, formatMoney(data[offset + 6] ?? 0));
      const voucherKind = data[offset + 17] ?? 0;
      const voucherTarget = data[offset + 18] ?? -1;
      setText(
        voucher,
        voucherText(
          voucherKind,
          voucherTarget >= 0 ? rideName(snapshot, voucherTarget) : 'nothing',
        ),
      );
      const thoughtsByTime = orderedHistory(
        data[offset + 7] ?? 0,
        Array.from({ length: 4 }, (_, i) => data[offset + 8 + i] ?? 0),
      );
      const rideIds = orderedHistory(
        data[offset + 12] ?? 0,
        Array.from({ length: 4 }, (_, i) => data[offset + 13 + i] ?? 0),
      );
      const nextSignature = `${thoughtsByTime.join(',')}|${rideIds.join(',')}`;
      if (signature !== nextSignature) {
        signature = nextSignature;
        thoughts.replaceChildren(
          ...(thoughtsByTime.length ? thoughtsByTime : [0]).map((thought) =>
            element('li', '', THOUGHT_LABELS[thought] ?? `Thought ${thought}`),
          ),
        );
        rides.replaceChildren(
          ...rideIds.map((rideId) => element('li', '', rideName(snapshot, rideId))),
        );
        if (rideIds.length === 0) rides.replaceChildren(element('li', '', 'No recent rides'));
      }
    },
  };
}

function guestRow(snapshot: Snapshot | null, guestId: number): number | null {
  if (!snapshot || guestId <= 0) return null;
  const count = Math.min(snapshot.guests.count, snapshot.guestIds.length);
  for (let i = 0; i < count; i++) if (snapshot.guestIds[i] === guestId) return i;
  return null;
}

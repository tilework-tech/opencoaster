import type { Stats } from '../../worker/protocol';
import { GUEST_DETAIL_STRIDE } from '../../worker/snapshot';
import type { Snapshot } from '../../worker/snapshot';
import { button, element, gauge, setText, statRow } from '../dom';
import { formatMoney } from '../format';
import type { TabSpec } from '../window-manager';
import type { GuestSelection, UiContext, WindowController } from '../ui-types';

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

export function guestSelectionText(details: string, tick: number): string {
  return `Selection at tick ${tick}\n${details}`;
}

const TABS: readonly TabSpec[] = [
  { id: 'view', label: 'View', icon: 'guests' },
  { id: 'stats', label: 'Stats', icon: 'info' },
  { id: 'rides', label: 'Rides', icon: 'rides' },
  { id: 'cash', label: 'Cash info', icon: 'cash' },
  { id: 'thoughts', label: 'Recent thoughts', icon: 'news' },
  { id: 'items', label: 'Carrying', icon: 'bin' },
];

const NEED_MAX = 255;

/** Guest window: park-wide summary, plus Thoughts / Statistics / Items for the selected guest. */
export function openGuestWindow(ctx: UiContext): WindowController {
  const { window: win, created } = ctx.windows.open({
    id: 'guests',
    title: 'Guests',
    kind: 'guest',
    width: 320,
    tabs: TABS,
  });
  const summary = element('div', 'guest-summary');
  const total = statRow('Guests in park');
  const mood = statRow('Average happiness');
  const hint = element('p', 'ui-help', 'Tap a guest in the park to inspect them.');
  const thoughts = element('ul', 'thought-list');
  thoughts.setAttribute('aria-label', 'Guest thoughts');
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
  const items = element('p', 'ui-help', 'Guest belongings are not tracked yet.');

  if (created) {
    summary.append(total.row, mood.row, hint);
    const locate = button(
      'Locate',
      () => {
        const guest = ctx.selectedGuest();
        if (guest) ctx.actions.locate(guest.tileX, guest.tileY);
      },
      'ui-button',
    );
    win.pane('view').append(summary, where.row, locate);
    win.pane('stats').append(...Object.values(gauges).map((g) => g.row));
    win.pane('rides').append(element('p', 'ui-help', 'Ride history is not tracked yet.'));
    win.pane('cash').append(cash.row);
    win.pane('thoughts').append(thoughts);
    win.pane('items').append(items);
  }
  let shownSignature = '';
  return {
    update(snapshot: Snapshot | null, stats: Stats | null) {
      const guest: GuestSelection | null = ctx.selectedGuest();
      setText(total.value, String(stats?.guests ?? snapshot?.guests.count ?? 0));
      if (snapshot && snapshot.guests.count > 0) {
        let sum = 0;
        const n = Math.min(
          snapshot.guests.count,
          snapshot.guestDetails.length / GUEST_DETAIL_STRIDE,
        );
        for (let i = 0; i < n; i++) sum += snapshot.guestDetails[i * GUEST_DETAIL_STRIDE];
        setText(mood.value, n > 0 ? String(Math.round(sum / n)) : '-');
      } else setText(mood.value, '-');
      hint.hidden = guest !== null;
      if (!guest) {
        win.setTitle('Guests');
        if (shownSignature !== 'none') {
          shownSignature = 'none';
          thoughts.replaceChildren();
        }
        return;
      }
      win.setTitle(`Guest ${guest.number}`);
      setText(where.value, `tile ${guest.tileX}, ${guest.tileY} · ${guest.state}`);
      gauges.happiness.set(guest.happiness / NEED_MAX, String(guest.happiness));
      gauges.hunger.set(guest.hunger / NEED_MAX, String(guest.hunger));
      gauges.thirst.set(guest.thirst / NEED_MAX, String(guest.thirst));
      gauges.toilet.set(guest.toilet / NEED_MAX, String(guest.toilet));
      gauges.nausea.set(guest.nausea / NEED_MAX, String(guest.nausea));
      gauges.energy.set(guest.energy / NEED_MAX, String(guest.energy));
      setText(cash.value, formatMoney(guest.cash));
      const signature = guest.thoughts.join(',') + `@${guest.number}:${guest.tick}`;
      if (signature === shownSignature) return;
      shownSignature = signature;
      const lines = guest.thoughts
        .filter((thought) => thought > 0)
        .map((thought) => THOUGHT_LABELS[thought] ?? `Thought ${thought}`);
      thoughts.replaceChildren(
        ...(lines.length ? lines : ['No recent thoughts']).map((line) => element('li', '', line)),
      );
    },
  };
}

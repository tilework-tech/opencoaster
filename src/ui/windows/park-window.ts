import { PriceMode } from '../../sim/economy/ledger';
import { restrictionLines } from '../../sim/scenario/restrictions';
import { gameDate, TICKS_PER_MONTH } from '../../sim/economy/calendar';
import { AWARDS } from '../../sim/economy/awards';
import type { Stats } from '../../worker/protocol';
import type { Snapshot } from '../../worker/snapshot';
import { button, element, gauge, setText, statRow } from '../dom';
import { drawChart, formatMoney } from '../format';
import { objectiveLines } from '../objective';
import type { TabSpec } from '../window-manager';
import type { UiContext, WindowController } from '../ui-types';
import { priceControl } from './price-control';

export const PARK_TABS: readonly TabSpec[] = [
  { id: 'entrance', label: 'View', icon: 'entrance' },
  { id: 'rating', label: 'Park rating', icon: 'park' },
  { id: 'guests', label: 'Guests', icon: 'guests' },
  { id: 'price', label: 'Admission', icon: 'cash' },
  { id: 'stats', label: 'Park statistics', icon: 'info' },
  { id: 'objective', label: 'Objectives', icon: 'news' },
  { id: 'awards', label: 'Awards', icon: 'award' },
];

export const MAX_PARK_RATING = 999;

const MODE_LABELS: ReadonlyArray<readonly [PriceMode, string]> = [
  [PriceMode.Free, 'Free entry'],
  [PriceMode.Admission, 'Pay to enter'],
  [PriceMode.PerRide, 'Pay per ride'],
];

export function formatParkDate(tick: number): string {
  const date = gameDate(tick);
  return `${date.monthName} ${date.day}, Year ${date.year}`;
}

/** Park window: entrance, rating, guest graph, admission pricing, statistics and objective. */
export function openParkWindow(ctx: UiContext): WindowController {
  const { window: win, created } = ctx.windows.open({
    id: 'park',
    title: 'Park',
    kind: 'park',
    width: 340,
    tabs: PARK_TABS,
  });
  const entrance = {
    guests: statRow('Guests in park'),
    rides: statRow('Attractions'),
    value: statRow('Park value'),
  };
  const rating = gauge('Park rating');
  const guestChart = element('canvas', 'chart');
  guestChart.width = 300;
  guestChart.height = 110;
  const modeButtons = new Map<PriceMode, HTMLButtonElement>();
  const modeRow = element('div', 'button-row');
  for (const [mode, label] of MODE_LABELS) {
    const b = button(
      label,
      () => ctx.actions.command({ type: 'economy', action: { type: 'setPriceMode', mode } }),
      'ui-button',
    );
    b.dataset.priceMode = String(mode);
    modeButtons.set(mode, b);
    modeRow.append(b);
  }
  const admission = priceControl('Park admission', (cents) =>
    ctx.actions.command({ type: 'economy', action: { type: 'setAdmissionPrice', cents } }),
  );
  const admissionBlock = element('div', 'price-block');
  admissionBlock.append(element('p', 'ui-help', 'Admission price'), admission.root);
  const stats = {
    tick: statRow('Simulation tick'),
    date: statRow('Date'),
    rides: statRow('Rides'),
    staff: statRow('Staff'),
    litter: statRow('Litter on paths'),
  };
  const objective = element('pre', 'ui-pre');
  const awards = element('pre', 'ui-pre');

  if (created) {
    win.pane('entrance').append(
      entrance.guests.row,
      entrance.rides.row,
      entrance.value.row,
      button('Land rights', () => ctx.openWindow('land-rights'), 'ui-button'),
    );
    win
      .pane('rating')
      .append(
        rating.row,
        element(
          'p',
          'ui-help',
          'Rating rises with happy guests, exciting rides and a tidy, well-run park.',
        ),
      );
    win.pane('guests').append(element('p', 'ui-help', 'Guests in the park'), guestChart);
    win.pane('price').append(element('p', 'ui-help', 'How guests pay'), modeRow, admissionBlock);
    win
      .pane('stats')
      .append(stats.date.row, stats.tick.row, stats.rides.row, stats.staff.row, stats.litter.row);
    win.pane('objective').append(objective);
    win
      .pane('awards')
      .append(element('p', 'ui-help', 'Current park awards and their remaining duration.'), awards);
  }
  return {
    update(snapshot: Snapshot | null, simStats: Stats | null) {
      if (!snapshot) return;
      const guests = simStats?.guests ?? snapshot.guests.count;
      setText(entrance.guests.value, String(guests));
      setText(entrance.rides.value, String(snapshot.park.rides));
      setText(entrance.value.value, formatMoney(snapshot.economy.parkValue));
      rating.set(
        snapshot.scenario.parkRating / MAX_PARK_RATING,
        String(snapshot.scenario.parkRating),
      );
      if (win.activeTab === 'guests') drawChart(guestChart, ctx.series.guests.values(), '#8fd3ff');
      for (const [mode, b] of modeButtons)
        b.setAttribute('aria-pressed', String(snapshot.economy.priceMode === mode));
      admissionBlock.hidden = snapshot.economy.priceMode !== PriceMode.Admission;
      admission.show(snapshot.economy.admissionPrice);
      setText(stats.tick.value, String(snapshot.tick));
      setText(stats.date.value, formatParkDate(snapshot.tick));
      setText(stats.rides.value, String(snapshot.park.rides));
      setText(stats.staff.value, String(snapshot.staff.count));
      setText(stats.litter.value, String(snapshot.litter.count));
      const lines = objectiveLines(snapshot.scenario, snapshot.park.loan, snapshot.tick);
      const rules = restrictionLines(snapshot.scenario.restrictions);
      setText(
        objective,
        [
          lines.length ? lines.join('\n') : 'Sandbox: no objective.',
          ...(rules.length ? ['', 'Park rules:', ...rules.map((rule) => `• ${rule}`)] : []),
        ].join('\n'),
      );
      const currentAwards = snapshot.activeAwards
        .filter((award) => award.expiresTick > snapshot.tick)
        .map((award) => {
          const name = AWARDS[award.awardId]?.name ?? `Award ${award.awardId}`;
          const months = Math.ceil((award.expiresTick - snapshot.tick) / TICKS_PER_MONTH);
          return `${name} · ${months} month${months === 1 ? '' : 's'} remaining`;
        });
      setText(awards, currentAwards.length ? currentAwards.join('\n') : 'No active awards.');
    },
  };
}

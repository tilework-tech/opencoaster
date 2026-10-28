import { TILE_UNITS, Z_STEP } from '../../sim/core/constants';
import { STAFF_WAGE_CENTS_PER_WEEK } from '../../sim/staff/staff-store';
import { SNAPSHOT_STRIDE, STAFF_STAT_STRIDE } from '../../worker/snapshot';
import type { Snapshot } from '../../worker/snapshot';
import { button, element, setText, statRow } from '../dom';
import { liveViewport } from '../live-viewport';
import { formatMoney } from '../format';
import { gameDate } from '../../sim/economy/calendar';
import type { TabSpec } from '../window-manager';
import type { UiContext, WindowController } from '../ui-types';
import { STAFF_KIND_NAMES } from '../staff-roster';

export interface WorkerDetails {
  id: number;
  name: string;
  kind: number;
  role: string;
  tileX: number;
  tileY: number;
  height: number;
  weeklyWage: number;
  /** Park tick the worker was hired. */
  hiredTick: number;
  /** The activity totals shown for the worker's role. */
  stats: { label: string; value: number }[];
}

/** Stat labels per role, each with its offset in `Snapshot.staffStats`. */
const ROLE_STATS: readonly (readonly (readonly [string, number])[])[] = [
  [
    ['Lawns mown', 1],
    ['Gardens watered', 2],
    ['Litter swept', 0],
    ['Bins emptied', 3],
  ],
  [
    ['Rides inspected', 4],
    ['Rides fixed', 5],
  ],
  [['Vandals stopped', 6]],
  [['Guests entertained', 7]],
];

/** Resolves a worker's display details from the latest transferable snapshot. */
export function workerDetails(snapshot: Snapshot | null, staffId: number): WorkerDetails | null {
  if (!snapshot) return null;
  for (let slot = 0; slot < snapshot.staff.count; slot++) {
    if (snapshot.staffIds[slot] !== staffId) continue;
    const offset = slot * SNAPSHOT_STRIDE;
    const kind = snapshot.staff.data[offset + 3] & 0xff;
    const role = STAFF_KIND_NAMES[kind] ?? 'Staff';
    return {
      id: staffId,
      name: snapshot.staffNames.get(staffId) ?? `${role} ${staffId + 1}`,
      kind,
      role,
      tileX: Math.floor(snapshot.staff.data[offset] / TILE_UNITS),
      tileY: Math.floor(snapshot.staff.data[offset + 1] / TILE_UNITS),
      height: Math.floor(snapshot.staff.data[offset + 2] / Z_STEP),
      weeklyWage: STAFF_WAGE_CENTS_PER_WEEK[kind] ?? 0,
      hiredTick: snapshot.staffStats[slot * STAFF_STAT_STRIDE + 8],
      stats: (ROLE_STATS[kind] ?? []).map(([label, offset]) => ({
        label,
        value: snapshot.staffStats[slot * STAFF_STAT_STRIDE + offset],
      })),
    };
  }
  return null;
}

export const WORKER_TABS: readonly TabSpec[] = [
  { id: 'view', label: 'View', icon: 'info' },
  { id: 'orders', label: 'Orders', icon: 'staff' },
  { id: 'statistics', label: 'Statistics', icon: 'chart' },
];

const ROLE_ORDERS = [
  [
    ['sweep-paths', 'Sweep paths'],
    ['empty-bins', 'Empty bins'],
    ['water-gardens', 'Water gardens'],
    ['mow-grass', 'Mow grass'],
  ],
  [
    ['inspect-rides', 'Inspect rides'],
    ['repair-rides', 'Repair rides'],
  ],
  [['watch-for-vandalism', 'Watch for vandalism']],
  [['entertain-guests', 'Entertain guests']],
] as const;

export type WorkerTaskOrder = (typeof ROLE_ORDERS)[number][number][0];
export type WorkerOrderChange = (staffId: number, order: WorkerTaskOrder, enabled: boolean) => void;
const ORDER_BITS: Record<WorkerTaskOrder, number> = {
  'sweep-paths': 1 << 0,
  'empty-bins': 1 << 1,
  'water-gardens': 1 << 2,
  'inspect-rides': 1 << 3,
  'repair-rides': 1 << 4,
  'watch-for-vandalism': 1 << 5,
  'entertain-guests': 1 << 6,
  'mow-grass': 1 << 7,
};

/** Opens the three-tab inspector for a worker selected from the staff roster. */
export function openWorkerWindow(
  ctx: UiContext,
  staffId: number,
  onOrderChange?: WorkerOrderChange,
): WindowController {
  const { window: win, created } = ctx.windows.open({
    id: `worker-${staffId}`,
    title: 'Worker',
    kind: 'staff',
    width: 320,
    tabs: WORKER_TABS,
  });
  const name = element('strong', 'worker-name');
  let currentWorker: WorkerDetails | null = null;
  let activityLabels = '';
  let activityValues: HTMLElement[] = [];
  const role = statRow('Role');
  const location = statRow('Location');
  const employed = statRow('Employed');
  const activity = element('div', 'worker-activity');
  const wage = statRow('Wage per week');
  const taskLegend = element('legend', 'stat-label', 'Task orders');
  const patrolHint = element(
    'p',
    'ui-help',
    'This worker follows only the tiles in this patrol area.',
  );
  if (created) {
    const view = win.pane('view');
    const locate = button(
      'Locate',
      () => {
        if (currentWorker) ctx.actions.locate(currentWorker.tileX, currentWorker.tileY);
      },
      'ui-button',
    );
    const rename = button(
      'Rename',
      () => {
        if (!currentWorker) return;
        const next = window.prompt(
          'Name for this staff member (blank clears it):',
          currentWorker.name,
        );
        if (next !== null) ctx.actions.renameStaff(staffId, next);
      },
      'ui-button',
    );
    const sack = button(
      'Sack',
      () => {
        ctx.actions.fireStaff(staffId);
        ctx.windows.close(`worker-${staffId}`);
      },
      'ui-button',
    );
    sack.classList.add('ui-danger');
    const pickUp = button('Pick up', () => ctx.actions.pickUpPerson('staff', staffId), 'ui-button');
    view.append(
      liveViewport(`staff:${staffId}`, `Staff ${staffId} live view`),
      name,
      role.row,
      location.row,
      element('div', 'button-row'),
    );
    view.lastElementChild?.append(locate, pickUp, rename, sack);

    const orders = win.pane('orders');
    const taskOrders = element('fieldset', 'worker-task-orders');
    const taskHint = element('p', 'ui-help', 'Choose the tasks this worker should perform.');
    const patrol = button(
      'Edit patrol area',
      () => {
        if (!currentWorker) return;
        ctx.actions.setPatrolStaff(staffId);
        ctx.chooseTool('patrol');
      },
      'ui-button',
    );
    patrol.setAttribute('aria-label', 'Edit this worker patrol area');
    orders.append(taskOrders, taskHint, patrol, patrolHint);

    const statistics = win.pane('statistics');
    statistics.append(wage.row, employed.row, activity);
  }

  return {
    update(snapshot: Snapshot | null) {
      currentWorker = workerDetails(snapshot, staffId) ?? currentWorker;
      const worker = currentWorker;
      win.setTitle(worker ? worker.name : 'Worker');
      setText(name, worker?.name ?? 'Worker no longer employed');
      setText(role.value, worker?.role ?? 'Unavailable');
      setText(
        location.value,
        worker ? `Tile ${worker.tileX}, ${worker.tileY} · height ${worker.height}` : 'Unavailable',
      );
      setText(wage.value, worker ? formatMoney(worker.weeklyWage) : 'Unavailable');
      if (worker) {
        const hired = gameDate(worker.hiredTick);
        setText(employed.value, `${hired.monthName}, year ${hired.year}`);
      } else setText(employed.value, 'Unavailable');
      const stats = worker?.stats ?? [];
      const labels = stats.map((stat) => stat.label).join('|');
      if (labels !== activityLabels) {
        activityLabels = labels;
        activityValues = stats.map(({ label }) => {
          const row = statRow(label);
          activity.append(row.row);
          return row.value;
        });
        activity.replaceChildren(...activityValues.map((value) => value.parentElement as Node));
      }
      stats.forEach(({ value }, index) => setText(activityValues[index], String(value)));
      const orderGroup = win.pane('orders').firstElementChild as HTMLFieldSetElement;
      const selectedKind = worker?.kind ?? -1;
      let staffSlot = -1;
      for (let slot = 0; snapshot && slot < snapshot.staff.count; slot++) {
        if (snapshot.staffIds[slot] === staffId) {
          staffSlot = slot;
          break;
        }
      }
      const orders = staffSlot >= 0 ? (snapshot?.staffOrders[staffSlot] ?? 0) : 0;
      for (const checkbox of win
        .pane('orders')
        .querySelectorAll<HTMLInputElement>('input[data-order]')) {
        const order = checkbox.dataset.order as WorkerTaskOrder;
        checkbox.checked = (orders & ORDER_BITS[order]) !== 0;
      }
      if (orderGroup.dataset.kind !== String(selectedKind)) {
        orderGroup.dataset.kind = String(selectedKind);
        const controls = (ROLE_ORDERS[selectedKind] ?? []).map(([order, label]) => {
          const option = element('label', 'worker-order');
          const checkbox = element('input');
          checkbox.type = 'checkbox';
          checkbox.checked = true;
          checkbox.dataset.order = order;
          checkbox.addEventListener('change', () => {
            onOrderChange?.(staffId, order, checkbox.checked);
          });
          option.append(checkbox, element('span', undefined, label));
          return option;
        });
        orderGroup.replaceChildren(taskLegend, ...controls);
        for (const checkbox of orderGroup.querySelectorAll<HTMLInputElement>('input[data-order]')) {
          const order = checkbox.dataset.order as WorkerTaskOrder;
          checkbox.checked = (orders & ORDER_BITS[order]) !== 0;
        }
      }
    },
  };
}

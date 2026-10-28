import { Funding, FUNDING_MONTHLY_CENTS } from '../../sim/research/research';
import { RIDE_CATALOG } from '../../sim/rides/ride-types';
import type { Snapshot } from '../../worker/snapshot';
import { button, element, gauge, setText, statRow } from '../dom';
import { formatMoney } from '../format';
import type { TabSpec } from '../window-manager';
import type { UiContext, WindowController } from '../ui-types';

export const RESEARCH_TABS: readonly TabSpec[] = [
  { id: 'development', label: 'Development', icon: 'research' },
  { id: 'funding', label: 'Funding', icon: 'cash' },
];

export const FUNDING_LABELS: ReadonlyArray<readonly [Funding, string]> = [
  [Funding.None, 'None'],
  [Funding.Minimum, 'Minimum'],
  [Funding.Normal, 'Normal'],
  [Funding.Maximum, 'Maximum'],
];

/** Display names for the research category bits. */
export const RESEARCH_CATEGORIES: readonly string[] = [
  'Transport Rides',
  'Gentle Rides',
  'Roller Coasters',
  'Thrill Rides',
  'Water Rides',
  'Shops & Stalls',
  'Scenery & Themeing',
];

export interface FundingControls {
  root: HTMLElement;
  update(snapshot: Snapshot): void;
}

/** Funding level buttons and category toggles; shared by the research and finance windows. */
export function fundingControls(ctx: UiContext): FundingControls {
  const root = element('div', 'funding-controls');
  const levels = new Map<Funding, HTMLButtonElement>();
  const levelRow = element('div', 'button-row');
  for (const [level, label] of FUNDING_LABELS) {
    const caption =
      level === Funding.None
        ? label
        : `${label} ${formatMoney(FUNDING_MONTHLY_CENTS[level])}/month`;
    const b = button(
      caption,
      () => ctx.actions.command({ type: 'research', action: { type: 'setFunding', level } }),
      'ui-button',
    );
    b.dataset.funding = String(level);
    levels.set(level, b);
    levelRow.append(b);
  }
  const categories = element('div', 'category-list');
  const boxes: HTMLInputElement[] = [];
  let mask = 0;
  let pendingMask: number | null = null;
  RESEARCH_CATEGORIES.forEach((name, bit) => {
    const label = element('label', 'check-row');
    const box = element('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      mask = box.checked ? mask | (1 << bit) : mask & ~(1 << bit);
      pendingMask = mask;
      ctx.actions.command({
        type: 'research',
        action: { type: 'setCategories', mask },
      });
    });
    boxes.push(box);
    label.append(box, element('span', '', name));
    categories.append(label);
  });
  root.append(
    element('p', 'ui-help', 'Research funding'),
    levelRow,
    element('p', 'ui-help', 'Research priorities'),
    categories,
  );
  return {
    root,
    update(snapshot) {
      if (pendingMask === snapshot.research.enabledCategoryMask) pendingMask = null;
      if (pendingMask === null) mask = snapshot.research.enabledCategoryMask;
      else mask = pendingMask;
      for (const [level, b] of levels)
        b.setAttribute('aria-pressed', String(snapshot.research.funding === level));
      boxes.forEach((box, bit) => {
        const on = (mask & (1 << bit)) !== 0;
        if (box.checked !== on) box.checked = on;
      });
    },
  };
}

export function openResearchWindow(ctx: UiContext): WindowController {
  const { window: win, created } = ctx.windows.open({
    id: 'research',
    title: 'Research and development',
    kind: 'research',
    width: 340,
    tabs: RESEARCH_TABS,
  });
  const progress = gauge('Progress');
  const current = statRow('Current research');
  const discovered = statRow('Items discovered');
  const funding = fundingControls(ctx);
  if (created) {
    win.pane('development').append(current.row, progress.row, discovered.row);
    win.pane('funding').append(funding.root);
  }
  return {
    update(snapshot: Snapshot | null) {
      if (!snapshot) return;
      const r = snapshot.research;
      setText(
        current.value,
        r.currentItemId >= 0
          ? `${RIDE_CATALOG[r.currentItemId as keyof typeof RIDE_CATALOG]?.name ?? 'Scenery'} — ${r.progressStage}`
          : r.inventionCount === 0
            ? 'Nothing to research'
            : r.unlockedCount < r.inventionCount
              ? 'No research selected'
              : 'Complete',
      );
      progress.set(
        r.currentCost > 0 ? r.progress / r.currentCost : 0,
        r.currentCost > 0 ? `${Math.floor((100 * r.progress) / r.currentCost)}%` : '',
      );
      setText(discovered.value, `${r.unlockedCount} of ${r.inventionCount}`);
      funding.update(snapshot);
    },
  };
}

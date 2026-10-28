import { FeedbackDomain } from '../../sim/core/feedback';
import type { EconomyAction } from '../../sim/economy/actions';
import { CAMPAIGNS, MAX_CAMPAIGN_WEEKS, MIN_CAMPAIGN_WEEKS } from '../../sim/economy/marketing';
import { LedgerCategory } from '../../sim/economy/ledger';
import { LOAN_STEP_CENTS } from '../../sim/economy/finance';
import type { Snapshot } from '../../worker/snapshot';
import { button, element, setText, statRow } from '../dom';
import { drawChart, formatMoney } from '../format';
import type { TabSpec } from '../window-manager';
import type { UiContext, WindowController } from '../ui-types';
import { fundingControls } from './research-window';
import {
  economyFeedbackMessage,
  isFoodOrDrinkStall,
  isPromotableRide,
  targetOptions,
} from './campaign-targets';
import type { TargetOption } from './campaign-targets';

export const FINANCE_TABS: readonly TabSpec[] = [
  { id: 'summary', label: 'Financial accounts', icon: 'finances' },
  { id: 'cash', label: 'Cash graph', icon: 'cash' },
  { id: 'value', label: 'Park value', icon: 'park' },
  { id: 'profit', label: 'Weekly profit', icon: 'chart' },
  { id: 'marketing', label: 'Marketing', icon: 'megaphone' },
  { id: 'research', label: 'Research', icon: 'research' },
];

export const CATEGORY_LABELS: Record<LedgerCategory, string> = {
  [LedgerCategory.RideConstruction]: 'Ride construction',
  [LedgerCategory.RideRunning]: 'Ride running costs',
  [LedgerCategory.Land]: 'Land purchase',
  [LedgerCategory.Landscaping]: 'Landscaping',
  [LedgerCategory.Admission]: 'Park entrance tickets',
  [LedgerCategory.RideTickets]: 'Ride tickets',
  [LedgerCategory.ShopSales]: 'Shop sales',
  [LedgerCategory.ShopStock]: 'Shop stock',
  [LedgerCategory.FoodDrinkSales]: 'Food and drink sales',
  [LedgerCategory.FoodDrinkStock]: 'Food and drink stock',
  [LedgerCategory.Wages]: 'Staff wages',
  [LedgerCategory.Marketing]: 'Marketing',
  [LedgerCategory.Research]: 'Research',
  [LedgerCategory.Interest]: 'Loan interest',
  [LedgerCategory.COUNT]: '',
};

const DEFAULT_CAMPAIGN_WEEKS = 4;

/** Rebuilds a target list only when its contents change, keeping the player's choice. */
function fillTargetSelect(
  select: HTMLSelectElement,
  options: TargetOption[],
  emptyText: string,
): void {
  const key = options.map((option) => `${option.id}:${option.name}`).join('|');
  if (select.dataset.key !== key) {
    const previous = select.value;
    select.dataset.key = key;
    if (options.length === 0) {
      select.replaceChildren(new Option(emptyText, ''));
      select.title = emptyText;
    } else {
      select.replaceChildren(...options.map((o) => new Option(o.name, String(o.id))));
      select.removeAttribute('title');
      if (options.some((o) => String(o.id) === previous)) select.value = previous;
    }
  }
  select.disabled = options.length === 0;
}

function labelled(text: string, control: HTMLElement): HTMLElement {
  const row = element('label', 'campaign-field');
  row.append(element('span', '', text), control);
  return row;
}

function weeksLabel(weeks: number): string {
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
}

/** Finances window: monthly summary with loan controls, history graphs, marketing and research funding. */
export function openFinanceWindow(ctx: UiContext): WindowController {
  const { window: win, created } = ctx.windows.open({
    id: 'finance',
    title: 'Finances',
    kind: 'finance',
    width: 380,
    tabs: FINANCE_TABS,
  });
  const cash = statRow('Cash');
  const loan = statRow('Loan');
  const loanRow = element('div', 'button-row');
  const borrowButton = button(
    'Borrow $1,000',
    () =>
      ctx.actions.command({
        type: 'economy',
        action: { type: 'borrow', cents: LOAN_STEP_CENTS },
      }),
    'ui-button',
  );
  const repayButton = button(
    'Repay $1,000',
    () =>
      ctx.actions.command({ type: 'economy', action: { type: 'repay', cents: LOAN_STEP_CENTS } }),
    'ui-button',
  );
  loanRow.append(borrowButton, repayButton);
  const table = element('table', 'ledger-table');
  const head = element('tr');
  head.append(
    element('th', '', ''),
    element('th', '', 'This month'),
    element('th', '', 'Last month'),
  );
  table.append(head);
  const cells: Array<{ now: HTMLElement; before: HTMLElement }> = [];
  for (let c = 0; c < LedgerCategory.COUNT; c++) {
    const row = element('tr');
    const now = element('td', 'num');
    const before = element('td', 'num');
    cells.push({ now, before });
    row.append(element('th', '', CATEGORY_LABELS[c as LedgerCategory]), now, before);
    table.append(row);
  }
  const totalRow = element('tr', 'ledger-total');
  const totalNow = element('td', 'num');
  const totalBefore = element('td', 'num');
  totalRow.append(element('th', '', 'Profit'), totalNow, totalBefore);
  table.append(totalRow);

  const charts = {
    cash: element('canvas', 'chart'),
    value: element('canvas', 'chart'),
    profit: element('canvas', 'chart'),
  };
  for (const chart of Object.values(charts)) {
    chart.width = 340;
    chart.height = 160;
  }
  const campaignInfo = element('p', 'ui-help');
  const summaryFeedback = element('p', 'ui-help campaign-feedback');
  const marketingFeedback = element('p', 'ui-help campaign-feedback');
  const feedbackLines = [summaryFeedback, marketingFeedback];

  const durationSelect = element('select', 'campaign-select');
  for (let weeks = MIN_CAMPAIGN_WEEKS; weeks <= MAX_CAMPAIGN_WEEKS; weeks++) {
    durationSelect.append(new Option(weeksLabel(weeks), String(weeks)));
  }
  durationSelect.value = String(DEFAULT_CAMPAIGN_WEEKS);
  const rideSelect = element('select', 'campaign-select');
  const stallSelect = element('select', 'campaign-select');

  const startCampaign = (campaignId: number): void => {
    const campaign = CAMPAIGNS[campaignId];
    const action: EconomyAction = {
      type: 'startCampaign',
      campaignId,
      weeks: Number(durationSelect.value),
    };
    if (campaign.target === 'ride') action.targetId = Number(rideSelect.value);
    if (campaign.target === 'item') action.targetId = Number(stallSelect.value);
    ctx.actions.command({ type: 'economy', action });
  };
  const campaignButtons = CAMPAIGNS.map((_, id) => {
    const b = button('', () => startCampaign(id), 'ui-button');
    b.dataset.campaign = String(id);
    return b;
  });
  const marketing = element('div', 'campaign-list');
  marketing.append(
    labelled('Length', durationSelect),
    labelled('Ride', rideSelect),
    labelled('Food or drink stall', stallSelect),
    ...campaignButtons,
  );
  const funding = fundingControls(ctx);

  let lastFeedbackSeq: number | null = null;

  if (created) {
    win.pane('summary').append(cash.row, loan.row, loanRow, summaryFeedback, table);
    win.pane('cash').append(element('p', 'ui-help', 'Cash over time'), charts.cash);
    win.pane('value').append(element('p', 'ui-help', 'Park value over time'), charts.value);
    win
      .pane('profit')
      .append(element('p', 'ui-help', 'Profit this month, sampled over time'), charts.profit);
    win.pane('marketing').append(campaignInfo, marketingFeedback, marketing);
    win.pane('research').append(funding.root);
  }
  return {
    update(snapshot: Snapshot | null) {
      if (!snapshot) return;
      const e = snapshot.economy;
      setText(cash.value, formatMoney(snapshot.park.cash));
      setText(loan.value, `${formatMoney(snapshot.park.loan)} of ${formatMoney(e.maxLoan)} limit`);
      borrowButton.disabled = snapshot.park.loan + LOAN_STEP_CENTS > e.maxLoan;
      if (borrowButton.disabled) borrowButton.title = 'Maximum borrowing limit reached.';
      else borrowButton.removeAttribute('title');
      repayButton.disabled =
        snapshot.park.loan < LOAN_STEP_CENTS || snapshot.park.cash < LOAN_STEP_CENTS;
      if (repayButton.disabled)
        repayButton.title = 'Repayment requires at least $1,000 in loan and cash.';
      else repayButton.removeAttribute('title');
      let sumNow = 0;
      let sumBefore = 0;
      for (let c = 0; c < LedgerCategory.COUNT; c++) {
        sumNow += e.thisMonth[c];
        sumBefore += e.lastMonth[c];
        setText(cells[c].now, formatMoney(e.thisMonth[c]));
        setText(cells[c].before, e.monthsCompleted > 0 ? formatMoney(e.lastMonth[c]) : '-');
      }
      setText(totalNow, formatMoney(sumNow));
      setText(totalBefore, e.monthsCompleted > 0 ? formatMoney(sumBefore) : '-');
      const tab = win.activeTab;
      if (tab === 'cash') drawChart(charts.cash, ctx.series.cash.values(), '#9be28a');
      if (tab === 'value') drawChart(charts.value, ctx.series.value.values(), '#8fd3ff');
      if (tab === 'profit') drawChart(charts.profit, ctx.series.profit.values(), '#f2c14e');

      const rideOptions = targetOptions(snapshot, isPromotableRide);
      const stallOptions = targetOptions(snapshot, (type) => isFoodOrDrinkStall(type));
      fillTargetSelect(rideSelect, rideOptions, 'No rides built yet');
      fillTargetSelect(stallSelect, stallOptions, 'No food or drink stalls built yet');
      const weeks = Number(durationSelect.value);
      CAMPAIGNS.forEach((campaign, id) => {
        const b = campaignButtons[id];
        const unavailableReason =
          campaign.target === 'ride' && rideOptions.length === 0
            ? 'Build a promotable ride to run this campaign.'
            : campaign.target === 'item' && stallOptions.length === 0
              ? 'Build a food or drink stall to run this campaign.'
              : undefined;
        setText(
          b,
          `${campaign.name}: ${formatMoney(campaign.weeklyCostCents)}/wk for ${weeksLabel(weeks)}`,
        );
        b.disabled = unavailableReason !== undefined;
        if (unavailableReason) b.title = unavailableReason;
        else b.removeAttribute('title');
      });

      const feedback = snapshot.feedback;
      if (
        lastFeedbackSeq !== null &&
        feedback.seq !== lastFeedbackSeq &&
        feedback.domain === FeedbackDomain.Economy
      ) {
        for (const line of feedbackLines) setText(line, economyFeedbackMessage(feedback.code));
      }
      lastFeedbackSeq = feedback.seq;

      setText(
        campaignInfo,
        e.campaignId >= 0 && e.campaignWeeksLeft > 0
          ? `Running: ${CAMPAIGNS[e.campaignId]?.name ?? 'campaign'}, ${e.campaignWeeksLeft} weeks left.`
          : 'No campaign running.',
      );
      funding.update(snapshot);
    },
  };
}

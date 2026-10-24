import { CAMPAIGNS } from '../../sim/economy/marketing';
import { LedgerCategory } from '../../sim/economy/ledger';
import { LOAN_STEP_CENTS } from '../../sim/economy/finance';
import type { Snapshot } from '../../worker/snapshot';
import { button, element, setText, statRow } from '../dom';
import { drawChart, formatMoney } from '../format';
import type { TabSpec } from '../window-manager';
import type { UiContext, WindowController } from '../ui-types';
import { fundingControls } from './research-window';

const TABS: readonly TabSpec[] = [
  { id: 'summary', label: 'Financial accounts', icon: 'finances' },
  { id: 'cash', label: 'Cash graph', icon: 'cash' },
  { id: 'value', label: 'Park value', icon: 'park' },
  { id: 'profit', label: 'Weekly profit', icon: 'raise' },
  { id: 'marketing', label: 'Marketing', icon: 'news' },
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

const CAMPAIGN_WEEKS = 4;

/** Finances window: monthly summary with loan controls, history graphs, marketing and research funding. */
export function openFinanceWindow(ctx: UiContext): WindowController {
  const { window: win, created } = ctx.windows.open({
    id: 'finance',
    title: 'Finances',
    kind: 'finance',
    width: 380,
    tabs: TABS,
  });
  const cash = statRow('Cash');
  const loan = statRow('Loan');
  const loanRow = element('div', 'button-row');
  loanRow.append(
    button(
      'Borrow $1,000',
      () =>
        ctx.actions.command({
          type: 'economy',
          action: { type: 'borrow', cents: LOAN_STEP_CENTS },
        }),
      'ui-button',
    ),
    button(
      'Repay $1,000',
      () =>
        ctx.actions.command({ type: 'economy', action: { type: 'repay', cents: LOAN_STEP_CENTS } }),
      'ui-button',
    ),
  );
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
  const marketing = element('div', 'campaign-list');
  CAMPAIGNS.forEach((campaign, id) => {
    const b = button(
      `${campaign.name}: ${formatMoney(campaign.weeklyCostCents)}/wk for ${CAMPAIGN_WEEKS} wk`,
      () =>
        ctx.actions.command({
          type: 'economy',
          action: { type: 'startCampaign', campaignId: id, weeks: CAMPAIGN_WEEKS },
        }),
      'ui-button',
    );
    b.dataset.campaign = String(id);
    marketing.append(b);
  });
  const funding = fundingControls(ctx);

  if (created) {
    win.pane('summary').append(cash.row, loan.row, loanRow, table);
    win.pane('cash').append(element('p', 'ui-help', 'Cash over time'), charts.cash);
    win.pane('value').append(element('p', 'ui-help', 'Park value over time'), charts.value);
    win
      .pane('profit')
      .append(element('p', 'ui-help', 'Profit this month, sampled over time'), charts.profit);
    win.pane('marketing').append(campaignInfo, marketing);
    win.pane('research').append(funding.root);
  }
  return {
    update(snapshot: Snapshot | null) {
      if (!snapshot) return;
      const e = snapshot.economy;
      setText(cash.value, formatMoney(snapshot.park.cash));
      setText(loan.value, `${formatMoney(snapshot.park.loan)} of ${formatMoney(e.maxLoan)} limit`);
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

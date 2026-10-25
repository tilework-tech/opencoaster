import {
  LAND_PRICE_CENTS,
  OWNED,
  RIGHTS_OWNED,
  RIGHTS_PRICE_CENTS,
  SALE_LAND,
  SALE_RIGHTS,
} from '../../sim/map/tile-map';
import { button, element, setText } from '../dom';
import { formatMoney } from '../format';
import type { UiContext, WindowController } from '../ui-types';

function countForSale(flags: Uint8Array | undefined, sale: number, owned: number): number {
  if (!flags) return 0;
  let count = 0;
  for (const flag of flags) if (flag & sale && !(flag & owned)) count++;
  return count;
}

/** Park information's land purchase window and map selection controls. */
export function openLandRightsWindow(ctx: UiContext): WindowController {
  const { window: win, created } = ctx.windows.open({
    id: 'land-rights',
    title: 'Land rights',
    kind: 'tool',
    width: 310,
    onClose: () => {
      if (ctx.currentTool() === 'buy-land' || ctx.currentTool() === 'buy-rights')
        ctx.chooseTool('select');
    },
  });
  const landAvailable = element('p', 'land-rights-count');
  const rightsAvailable = element('p', 'land-rights-count');
  const buyLand = button(
    'Buy land',
    () => {
      ctx.actions.setAlternate(false);
      ctx.chooseTool('buy-land');
    },
    'ui-button',
  );
  const buyRights = button(
    'Buy construction rights',
    () => {
      ctx.actions.setAlternate(false);
      ctx.chooseTool('buy-rights');
    },
    'ui-button',
  );
  if (created) {
    const pane = win.pane();
    pane.append(
      element('p', 'ui-help', 'Choose what to buy, then click a marked tile on the map.'),
      element(
        'p',
        'ui-help',
        'Each tile is purchased separately. Purchases take effect immediately.',
      ),
      saleLegend('land-sale', 'Land available to buy', '#f3ce57'),
      saleLegend('rights-sale', 'Construction rights only', '#63c3e8'),
      landAvailable,
      buyLand,
      rightsAvailable,
      buyRights,
    );
  }
  return {
    update() {
      const flags = ctx.actions.map()?.ownership;
      setText(
        landAvailable,
        `${countForSale(flags, SALE_LAND, OWNED)} tiles · ${formatMoney(LAND_PRICE_CENTS)} per tile`,
      );
      setText(
        rightsAvailable,
        `${countForSale(flags, SALE_RIGHTS, OWNED | RIGHTS_OWNED)} tiles · ${formatMoney(RIGHTS_PRICE_CENTS)} per tile`,
      );
      buyLand.setAttribute('aria-pressed', String(ctx.currentTool() === 'buy-land'));
      buyRights.setAttribute('aria-pressed', String(ctx.currentTool() === 'buy-rights'));
    },
  };
}

function saleLegend(id: string, label: string, color: string): HTMLDivElement {
  const row = element('div', 'land-rights-legend');
  const swatch = element('span', 'land-rights-swatch');
  swatch.dataset.ownership = id;
  swatch.style.setProperty('--sale-color', color);
  swatch.setAttribute('aria-hidden', 'true');
  row.append(swatch, element('span', '', label));
  return row;
}

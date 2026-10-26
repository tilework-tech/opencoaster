import { button, element } from '../dom';
import { LAND_SIZE_RANGE } from '../ui-types';
import type { AreaToolSettings, UiContext, WindowController } from '../ui-types';

interface AreaWindowSpec {
  id: 'clear' | 'water';
  title: string;
  intro: string;
  /** Raise and Lower buttons, for the Water tool. */
  modes: boolean;
  apply(ctx: UiContext, settings: AreaToolSettings): void;
}

const CLEAR_WINDOW: AreaWindowSpec = {
  id: 'clear',
  title: 'Clear scenery',
  intro:
    'Hover to preview what goes and its cost; tap to remove trees, scenery and footpath additions on land the park owns.',
  modes: false,
  apply: (ctx, settings) => ctx.actions.setClearScenery(settings),
};

const WATER_WINDOW: AreaWindowSpec = {
  id: 'water',
  title: 'Water',
  intro:
    'Hover to preview; each tap raises the lowest water (or floods dry land) or lowers the highest water by one step.',
  modes: true,
  apply: (ctx, settings) => ctx.actions.setWater(settings),
};

/** Tool size, and for Water raise or lower; changes go to the map tool, the window keeps no other state. */
function openAreaWindow(ctx: UiContext, spec: AreaWindowSpec): WindowController {
  const settings: AreaToolSettings = { size: 1, lower: false };
  const { window: win, created } = ctx.windows.open({
    id: spec.id,
    title: spec.title,
    kind: 'tool',
    width: 300,
    onClose: () => ctx.chooseTool('select'),
  });
  if (created) {
    const pane = win.pane();
    const sizeLabel = element('output', 'land-size-label');
    sizeLabel.setAttribute('aria-label', 'Tool size');
    const smaller = button('−', () => resize(-1), 'ui-button');
    const larger = button('+', () => resize(1), 'ui-button');
    smaller.setAttribute('aria-label', 'Smaller tool size');
    larger.setAttribute('aria-label', 'Larger tool size');
    const raise = button('Raise', () => setLower(false), 'ui-button');
    const lower = button('Lower', () => setLower(true), 'ui-button');
    const sync = (): void => {
      sizeLabel.textContent = `${settings.size}×${settings.size}`;
      smaller.disabled = settings.size <= LAND_SIZE_RANGE.min;
      larger.disabled = settings.size >= LAND_SIZE_RANGE.max;
      raise.setAttribute('aria-pressed', String(!settings.lower));
      lower.setAttribute('aria-pressed', String(settings.lower));
      spec.apply(ctx, { ...settings });
    };
    const resize = (delta: number): void => {
      settings.size = Math.max(
        LAND_SIZE_RANGE.min,
        Math.min(LAND_SIZE_RANGE.max, settings.size + delta),
      );
      sync();
    };
    const setLower = (on: boolean): void => {
      settings.lower = on;
      sync();
    };
    const sizeRow = element('div', 'land-size-row');
    sizeRow.append(element('span', '', 'Tool size'), smaller, sizeLabel, larger);
    pane.append(element('p', 'ui-help', spec.intro), sizeRow);
    if (spec.modes) {
      const modeRow = element('div', 'land-mode-row');
      modeRow.append(raise, lower);
      pane.append(modeRow);
    }
    sync();
  }
  ctx.chooseTool(spec.id);
  return { update() {} };
}

export function openClearWindow(ctx: UiContext): WindowController {
  return openAreaWindow(ctx, CLEAR_WINDOW);
}

export function openWaterWindow(ctx: UiContext): WindowController {
  return openAreaWindow(ctx, WATER_WINDOW);
}

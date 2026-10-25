import { button, element } from '../dom';
import { LAND_SIZE_RANGE } from '../ui-types';
import type { LandMode, LandSettings, UiContext, WindowController } from '../ui-types';

const MODES: ReadonlyArray<{ mode: LandMode; label: string; help: string }> = [
  { mode: 'raise', label: 'Raise', help: 'Tap or drag up to raise the land by one step.' },
  { mode: 'lower', label: 'Lower', help: 'Tap or drag down to lower the land by one step.' },
  {
    mode: 'flatten',
    label: 'Flatten',
    help: 'Tap or drag to level the area to the first tile you touch.',
  },
  {
    mode: 'smooth',
    label: 'Smooth',
    help: 'Tap or drag to ease spikes and pits into the surrounding land.',
  },
];

/**
 * Land window: tool size, raise/lower/flatten/smooth and corner picking. Changes go to the map
 * tool through `setLand`; the window keeps no other state.
 */
export function openLandWindow(ctx: UiContext): WindowController {
  const settings: LandSettings = { size: 1, mode: 'raise', corners: true };
  const { window: win, created } = ctx.windows.open({
    id: 'land',
    title: 'Land',
    kind: 'tool',
    width: 300,
    onClose: () => ctx.chooseTool('select'),
  });
  if (created) {
    const pane = win.pane();
    const help = element('p', 'ui-help');
    const sizeLabel = element('output', 'land-size-label');
    sizeLabel.setAttribute('aria-label', 'Tool size');
    const modeButtons = new Map<LandMode, HTMLButtonElement>();
    const cornerToggle = element('input', 'land-corners') as HTMLInputElement;
    let smaller: HTMLButtonElement;
    let larger: HTMLButtonElement;
    const sync = (): void => {
      sizeLabel.textContent = `${settings.size}×${settings.size}`;
      for (const [mode, node] of modeButtons)
        node.setAttribute('aria-pressed', String(mode === settings.mode));
      help.textContent = MODES.find((m) => m.mode === settings.mode)?.help ?? '';
      smaller.disabled = settings.size <= LAND_SIZE_RANGE.min;
      larger.disabled = settings.size >= LAND_SIZE_RANGE.max;
      cornerToggle.disabled = settings.mode !== 'raise' && settings.mode !== 'lower';
      ctx.actions.setLand({ ...settings });
    };
    const resize = (delta: number): void => {
      settings.size = Math.max(
        LAND_SIZE_RANGE.min,
        Math.min(LAND_SIZE_RANGE.max, settings.size + delta),
      );
      sync();
    };
    const sizeRow = element('div', 'land-size-row');
    smaller = button('−', () => resize(-1), 'ui-button');
    smaller.setAttribute('aria-label', 'Smaller tool size');
    larger = button('+', () => resize(1), 'ui-button');
    larger.setAttribute('aria-label', 'Larger tool size');
    sizeRow.append(element('span', '', 'Tool size'), smaller, sizeLabel, larger);
    const modeRow = element('div', 'land-mode-row');
    for (const { mode, label } of MODES) {
      const node = button(
        label,
        () => {
          settings.mode = mode;
          sync();
        },
        'ui-button',
      );
      modeButtons.set(mode, node);
      modeRow.append(node);
    }
    cornerToggle.type = 'checkbox';
    cornerToggle.checked = true;
    cornerToggle.setAttribute('aria-label', 'Pick corners and edges');
    cornerToggle.addEventListener('change', () => {
      settings.corners = cornerToggle.checked;
      sync();
    });
    const cornerLabel = element('label', 'coaster-row');
    cornerLabel.append(cornerToggle, element('span', '', 'Pick single corners and edges (size 1)'));
    pane.append(
      element(
        'p',
        'ui-help',
        'Hover to preview. Drag up or down on the map to repeat raise or lower.',
      ),
      sizeRow,
      modeRow,
      cornerLabel,
      help,
    );
    sync();
  }
  ctx.chooseTool('land');
  return { update() {} };
}

import { button, element } from '../dom';
import type { IconName } from '../icons';
import type { ToolMode, UiContext, WindowController } from '../ui-types';
import { buildSceneryPicker } from './scenery-picker';

interface ToolTab {
  id: string;
  label: string;
  icon: IconName;
  tool: ToolMode;
  help: string;
  /** Label for the alternate action toggle (lower, remove) when the tool has one. */
  alternate?: string;
  scenery?: boolean;
}

interface ToolWindowSpec {
  id: string;
  title: string;
  tabs: readonly ToolTab[];
}

export const SCENERY_WINDOW: ToolWindowSpec = {
  id: 'scenery',
  title: 'Scenery',
  tabs: [
    {
      id: 'place-scenery',
      label: 'Place scenery',
      icon: 'scenery',
      tool: 'scenery',
      help: 'Choose a group and a piece, then place it on land you own. These are decorations only; benches, bins, shelters and lamps have their own tabs.',
      scenery: true,
    },
    {
      id: 'flowerbed',
      label: 'Flower beds',
      icon: 'flower',
      tool: 'flowerbed',
      help: 'Plant flower beds on open ground.',
      alternate: 'Remove',
    },
    {
      id: 'bench',
      label: 'Benches',
      icon: 'bench',
      tool: 'bench',
      help: 'Benches go on footpath tiles you own.',
    },
    {
      id: 'bin',
      label: 'Litter bins',
      icon: 'bin',
      tool: 'bin',
      help: 'Bins go on footpath tiles you own.',
    },
    {
      id: 'shelter',
      label: 'Rain shelters',
      icon: 'shelter',
      tool: 'shelter',
      help: 'Guests shelter here when it rains.',
    },
    {
      id: 'lamp',
      label: 'Lamps',
      icon: 'lamp',
      tool: 'lamp',
      help: 'Lamps go on footpath tiles you own.',
    },
  ],
};

/** The scenery picker built into a window, found again when the window is reopened. */
const pickersByWindow = new WeakMap<HTMLElement, { update(): void }>();

/** A window of build-tool tabs: choosing a tab picks its map tool; closing the window returns to Select. */
export function openToolWindow(ctx: UiContext, spec: ToolWindowSpec): WindowController {
  const byId = new Map(spec.tabs.map((tab) => [tab.id, tab]));
  const toggles: HTMLButtonElement[] = [];
  const select = (tab: ToolTab | undefined): void => {
    if (!tab) return;
    ctx.actions.setAlternate(false);
    ctx.chooseTool(tab.tool);
    for (const toggle of toggles) toggle.setAttribute('aria-pressed', 'false');
  };
  const { window: win, created } = ctx.windows.open({
    id: spec.id,
    title: spec.title,
    kind: 'tool',
    width: 300,
    tabs: spec.tabs.length > 1 ? spec.tabs : undefined,
    onTab: (id) => select(byId.get(id)),
    onClose: () => {
      ctx.actions.setAlternate(false);
      ctx.chooseTool('select');
    },
  });
  if (created) {
    for (const tab of spec.tabs) {
      const pane = win.panes.get(tab.id) ?? win.pane();
      pane.append(element('p', 'ui-help', tab.help));
      if (tab.alternate) {
        const toggle = button(
          tab.alternate,
          () => {
            const on = toggle.getAttribute('aria-pressed') !== 'true';
            toggle.setAttribute('aria-pressed', String(on));
            ctx.actions.setAlternate(on);
          },
          'ui-button',
        );
        toggles.push(toggle);
        toggle.setAttribute('aria-pressed', 'false');
        pane.append(toggle);
      }
      if (tab.scenery) pickersByWindow.set(win.root, buildSceneryPicker(ctx, pane));
    }
    if (spec.tabs.length === 1) select(spec.tabs[0]);
  }
  return {
    update() {
      pickersByWindow.get(win.root)?.update();
    },
  };
}

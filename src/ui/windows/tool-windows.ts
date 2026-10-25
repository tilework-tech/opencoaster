import { button, element } from '../dom';
import type { IconName } from '../icons';
import type { ToolMode, UiContext, WindowController } from '../ui-types';
import { SCENERY_CATALOG, SceneryCategory } from '../../sim/map/scenery';
import type { SceneryItem } from '../../sim/map/scenery';

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
      help: 'Choose a scenery category and item, then place it on land you own.',
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

export const WATER_WINDOW: ToolWindowSpec = {
  id: 'water',
  title: 'Water',
  tabs: [
    {
      id: 'water',
      label: 'Water',
      icon: 'water',
      tool: 'select',
      help: 'Water tools are not available in this version.',
    },
  ],
};

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
      if (tab.scenery) {
        const category = element('select', 'scenery-category');
        category.setAttribute('aria-label', 'Scenery category');
        const item = element('select', 'scenery-item');
        item.setAttribute('aria-label', 'Scenery item');
        const categories = [
          [SceneryCategory.Trees, 'Trees'],
          [SceneryCategory.Shrubs, 'Shrubs and ornaments'],
          [SceneryCategory.Gardens, 'Gardens'],
          [SceneryCategory.Fences, 'Fences and walls'],
        ] as const;
        for (const [value, label] of categories) category.append(new Option(label, value));
        const updateItems = (): void => {
          const definitions = SCENERY_CATALOG.map((definition, index) => ({
            definition,
            index,
          })).filter(({ definition }) => definition.category === category.value);
          item.replaceChildren(
            ...definitions.map(
              ({ definition, index }) =>
                new Option(
                  `${definition.name} · $${(definition.priceCents / 100).toFixed(2)}`,
                  String(index),
                ),
            ),
          );
          ctx.actions.setSceneryItem(Number(item.value) as SceneryItem);
        };
        category.addEventListener('change', updateItems);
        item.addEventListener('change', () =>
          ctx.actions.setSceneryItem(Number(item.value) as SceneryItem),
        );
        updateItems();
        const rotate = button('Rotate piece', () => ctx.actions.rotatePiece(), 'ui-button');
        rotate.setAttribute('aria-label', 'Rotate scenery piece');
        pane.append(category, item, rotate);
      }
    }
    if (spec.tabs.length === 1) select(spec.tabs[0]);
  }
  return { update() {} };
}

import { button, element } from '../dom';
import type { IconName } from '../icons';
import type { ToolMode, UiContext, WindowController } from '../ui-types';
import { SCENERY_CATALOG, SceneryCategory } from '../../sim/map/scenery';
import type { SceneryItem } from '../../sim/map/scenery';
import { PathStyle } from '../../sim/map/tile-map';

interface ToolTab {
  id: string;
  label: string;
  icon: IconName;
  tool: ToolMode;
  help: string;
  /** Label for the alternate action toggle (lower, remove) when the tool has one. */
  alternate?: string;
  /** Offers the 1×1 to 5×5 brush size selector. */
  brush?: boolean;
  path?: boolean;
  scenery?: boolean;
}

interface ToolWindowSpec {
  id: string;
  title: string;
  tabs: readonly ToolTab[];
}

export const LAND_WINDOW: ToolWindowSpec = {
  id: 'land',
  title: 'Land',
  tabs: [
    {
      id: 'terrain',
      label: 'Raise or lower land',
      icon: 'land',
      tool: 'land',
      help: 'Tap a tile to raise it by one step. Switch to Lower to dig instead.',
      alternate: 'Lower',
      brush: true,
    },
  ],
};

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

export const PATH_WINDOW: ToolWindowSpec = {
  id: 'paths',
  title: 'Footpaths',
  tabs: [
    {
      id: 'path',
      label: 'Footpath',
      icon: 'paths',
      tool: 'path',
      help: 'Tap tiles to lay footpath. Connect it to the park entrance and to each ride entrance and exit.',
      path: true,
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
  let queue = false;
  let slopeDirection = -1;
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
      ctx.actions.setPathOptions(false, -1);
      ctx.actions.setBrush(1);
      ctx.chooseTool('select');
    },
  });
  if (created) {
    for (const tab of spec.tabs) {
      const pane = win.panes.get(tab.id) ?? win.pane();
      pane.append(element('p', 'ui-help', tab.help));
      if (tab.brush) {
        const size = element('select', 'brush-size');
        size.setAttribute('aria-label', 'Brush size');
        for (let n = 1; n <= 5; n++) size.append(new Option(`${n}×${n}`, String(n)));
        size.addEventListener('change', () => ctx.actions.setBrush(Number(size.value)));
        const label = element('label', 'coaster-row');
        label.append(element('span', '', 'Brush size'), size);
        pane.append(label);
      }
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
      if (tab.path) {
        const style = element('select', 'path-style');
        style.setAttribute('aria-label', 'Path surface style');
        for (const [value, label] of [
          [PathStyle.Tarmac, 'Tarmac'],
          [PathStyle.CrazyPaving, 'Crazy paving'],
          [PathStyle.Dirt, 'Dirt'],
        ] as const)
          style.append(new Option(label, String(value)));
        style.addEventListener('change', () => ctx.actions.setPathStyle(Number(style.value)));
        const queueToggle = button(
          'Queue line',
          () => {
            queue = !queue;
            queueToggle.setAttribute('aria-pressed', String(queue));
            style.disabled = queue;
            ctx.actions.setPathOptions(queue, slopeDirection);
          },
          'ui-button',
        );
        queueToggle.setAttribute('aria-pressed', 'false');
        const slopeToggle = button(
          'Follow terrain slope',
          () => {
            slopeDirection = slopeDirection < 0 ? 0 : -1;
            slopeToggle.setAttribute('aria-pressed', String(slopeDirection >= 0));
            direction.hidden = slopeDirection < 0;
            ctx.actions.setPathOptions(queue, slopeDirection);
          },
          'ui-button',
        );
        slopeToggle.setAttribute('aria-pressed', 'false');
        const direction = element('select', 'path-slope-direction');
        direction.setAttribute('aria-label', 'Slope direction');
        for (const [value, label] of ['North', 'East', 'South', 'West'].entries())
          direction.append(new Option(label, String(value)));
        direction.hidden = true;
        direction.addEventListener('change', () => {
          slopeDirection = Number(direction.value);
          ctx.actions.setPathOptions(queue, slopeDirection);
        });
        const removeToggle = button(
          'Remove footpath',
          () => {
            const on = removeToggle.getAttribute('aria-pressed') !== 'true';
            removeToggle.setAttribute('aria-pressed', String(on));
            ctx.actions.setAlternate(on);
          },
          'ui-button',
        );
        removeToggle.setAttribute('aria-pressed', 'false');
        pane.append(style, queueToggle, slopeToggle, direction, removeToggle);
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
        pane.append(category, item);
      }
    }
    if (spec.tabs.length === 1) select(spec.tabs[0]);
  }
  return { update() {} };
}

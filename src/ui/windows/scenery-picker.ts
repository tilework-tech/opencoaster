import { element } from '../dom';
import { formatMoney } from '../format';
import type { UiContext } from '../ui-types';
import { SCENERY_CATALOG, SCENERY_GROUPS, SceneryItem, isWallScenery } from '../../sim/map/scenery';
import type { SceneryDefinition, SceneryCategory } from '../../sim/map/scenery';
import { spritePages } from '../../render/sprite-pages';
import { placedSceneryKey, wallSpriteName } from '../../render/world-art';

/** CSS pixels of the square thumbnail canvas. */
const THUMBNAIL_SIZE = 56;

export interface SceneryEntry {
  index: SceneryItem;
  definition: SceneryDefinition;
}

/** Catalog items of one browse group, in catalog order. */
export function sceneryInGroup(category: SceneryCategory): SceneryEntry[] {
  return SCENERY_CATALOG.flatMap((definition, index) =>
    definition.category === category ? [{ index: index as SceneryItem, definition }] : [],
  );
}

/** Atlas key of the picture a menu card shows for an item at a camera rotation. */
export function sceneryThumbnailKey(definition: SceneryDefinition, rotation: number): string {
  return isWallScenery(SCENERY_CATALOG.indexOf(definition))
    ? wallSpriteName(definition.sprite, 0, 0, rotation)
    : placedSceneryKey(definition, 0, 0, 0, 0, rotation);
}

/** Whether the Rotate control changes how a piece is placed or looks. */
export function sceneryRotates(item: SceneryItem): boolean {
  const definition = SCENERY_CATALOG[item];
  return !!definition && (isWallScenery(item) || definition.directional === true);
}

export function sceneryTooltip(definition: SceneryDefinition): string {
  return `${definition.name}, ${formatMoney(definition.priceCents)}. ${definition.blurb}`;
}

function drawThumbnail(canvas: HTMLCanvasElement, key: string): boolean {
  const entry = spritePages.resolve(key);
  const frame = entry?.frames[0];
  const image = frame && spritePages.pageImage(frame.page);
  if (!frame || !image) return false;
  const ratio = window.devicePixelRatio || 1;
  const pixels = Math.round(THUMBNAIL_SIZE * ratio);
  canvas.width = pixels;
  canvas.height = pixels;
  const context = canvas.getContext('2d');
  if (!context) return false;
  context.clearRect(0, 0, pixels, pixels);
  context.imageSmoothingEnabled = false;
  const scale = Math.min(pixels / frame.width, pixels / frame.height, 2 * ratio);
  const width = Math.round(frame.width * scale);
  const height = Math.round(frame.height * scale);
  context.drawImage(
    image,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    Math.round((pixels - width) / 2),
    Math.round((pixels - height) / 2),
    width,
    height,
  );
  return true;
}

/**
 * Place-scenery pane: group buttons, a grid of picture cards for the chosen group, and a line
 * describing the selected piece. Picking a card arms that item for the Scenery tool.
 */
export function buildSceneryPicker(ctx: UiContext, pane: HTMLElement): { update(): void } {
  pane.classList.add('scenery-pane');
  const groups = element('div', 'scenery-groups');
  groups.setAttribute('role', 'group');
  groups.setAttribute('aria-label', 'Scenery category');
  const grid = element('div', 'card-grid scenery-grid');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Scenery item');
  const detail = element('p', 'ui-help scenery-detail');
  detail.setAttribute('role', 'status');
  const rotate = element('button', 'ui-button');
  rotate.type = 'button';
  rotate.textContent = 'Rotate piece';
  rotate.setAttribute('aria-label', 'Rotate scenery piece');
  rotate.addEventListener('click', () => ctx.actions.rotatePiece());

  let category = SCENERY_GROUPS[0]!.category;
  let selected: SceneryItem = SceneryItem.OakTree;
  const cards: Array<{
    button: HTMLButtonElement;
    canvas: HTMLCanvasElement;
    entry: SceneryEntry;
  }> = [];
  const groupButtons = new Map<SceneryCategory, HTMLButtonElement>();
  let stamp = '';

  const choose = (entry: SceneryEntry): void => {
    selected = entry.index;
    ctx.actions.setSceneryItem(entry.index);
    refreshSelection();
  };

  function refreshSelection(): void {
    for (const card of cards)
      card.button.setAttribute('aria-pressed', String(card.entry.index === selected));
    const definition = SCENERY_CATALOG[selected]!;
    detail.textContent = `${definition.name} · ${formatMoney(definition.priceCents)} · ${definition.blurb}`;
    const turns = sceneryRotates(selected);
    rotate.disabled = !turns;
    rotate.title = turns ? 'Turn the piece before placing it.' : 'Looks the same from every side.';
  }

  function showGroup(next: SceneryCategory): void {
    category = next;
    for (const [value, groupButton] of groupButtons)
      groupButton.setAttribute('aria-pressed', String(value === next));
    cards.length = 0;
    grid.replaceChildren();
    for (const entry of sceneryInGroup(next)) {
      const card = element('button', 'ride-card scenery-card');
      card.type = 'button';
      card.dataset.sceneryItem = String(entry.index);
      card.title = sceneryTooltip(entry.definition);
      card.setAttribute(
        'aria-label',
        `${entry.definition.name}, ${formatMoney(entry.definition.priceCents)}`,
      );
      const canvas = element('canvas', 'scenery-thumbnail');
      canvas.setAttribute('aria-hidden', 'true');
      card.append(
        canvas,
        element('span', 'ride-card-name', entry.definition.name),
        element('span', 'ride-card-cost', formatMoney(entry.definition.priceCents)),
      );
      card.addEventListener('click', () => choose(entry));
      grid.append(card);
      cards.push({ button: card, canvas, entry });
    }
    stamp = '';
    const first = cards.find((card) => card.entry.index === selected) ?? cards[0];
    if (first) choose(first.entry);
  }

  for (const group of SCENERY_GROUPS) {
    const groupButton = element('button', 'ui-button scenery-group', group.label);
    groupButton.type = 'button';
    groupButton.setAttribute('aria-pressed', 'false');
    groupButton.addEventListener('click', () => showGroup(group.category));
    groupButtons.set(group.category, groupButton);
    groups.append(groupButton);
  }
  const footer = element('div', 'scenery-footer');
  footer.append(detail, rotate);
  pane.append(groups, grid, footer);
  showGroup(category);

  return {
    /** Draws card pictures once their atlas pages are loaded, and again when the view turns. */
    update() {
      const next = `${ctx.actions.camera().rotation}:${spritePages.version}:${category}`;
      if (next === stamp) return;
      let complete = true;
      for (const card of cards)
        complete =
          drawThumbnail(
            card.canvas,
            sceneryThumbnailKey(card.entry.definition, ctx.actions.camera().rotation),
          ) && complete;
      if (complete) stamp = next;
    },
  };
}

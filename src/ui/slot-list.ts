import { formatCents } from './hud';
import type { SaveSlotMeta } from '../save/slot-store';
import { gameDate } from '../sim/economy/calendar';
import { button, element } from './dom';

export interface SlotRowActions {
  load(slot: SaveSlotMeta): void;
  /** Omitted for read-only lists. */
  overwrite?(slot: SaveSlotMeta): void;
  remove?(slot: SaveSlotMeta): void;
}

/** One saved game: its name, scenario, in-game date, cash and loan, with its actions. */
export function slotRow(
  slot: SaveSlotMeta,
  scenarioName: string,
  actions: SlotRowActions,
): HTMLElement {
  const row = element('div', 'slot-row');
  const info = element('div', 'slot-info');
  const date = gameDate(slot.tick);
  info.append(
    element('strong', 'slot-name', slot.name),
    element(
      'span',
      'slot-meta',
      `${scenarioName} · Year ${date.year}, ${date.monthName} · cash ${formatCents(slot.cash)} · loan ${formatCents(slot.loan)}`,
    ),
    element('span', 'slot-meta', `Saved ${new Date(slot.savedAt).toLocaleString()}`),
  );
  const buttons = element('div', 'slot-actions');
  buttons.append(button('Load', () => actions.load(slot)));
  if (actions.overwrite) buttons.append(button('Overwrite', () => actions.overwrite?.(slot)));
  if (actions.remove) buttons.append(button('Delete', () => actions.remove?.(slot)));
  row.append(info, buttons);
  return row;
}

import { summarizeSave } from './save';
import type { SaveSlotMeta, SlotStore } from './slot-store';

/** Anything that can produce save bytes for the running game (the worker client in practice). */
export interface SaveSource {
  save(): Promise<Uint8Array>;
}

export interface SaveRequest {
  /** Existing slot id to overwrite, or a fresh id for a new slot. */
  id: string;
  name: string;
  scenarioId: string;
  savedAt: number;
}

/** Serialises the running game into a slot. Returns the listing entry that was written. */
export async function saveGameToSlot(
  source: SaveSource,
  store: SlotStore,
  request: SaveRequest,
): Promise<SaveSlotMeta> {
  const bytes = await source.save();
  const summary = summarizeSave(bytes);
  const meta: SaveSlotMeta = {
    id: request.id,
    name: request.name,
    savedAt: request.savedAt,
    scenarioId: request.scenarioId,
    tick: summary.tick,
    cash: summary.cash,
    loan: summary.loan,
  };
  await store.put({ ...meta, bytes });
  return meta;
}

/** A save file name that is safe on every platform, derived from the scenario and time. */
export function exportFileName(scenarioId: string, savedAt: number): string {
  const stamp = new Date(savedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `opencoaster-${scenarioId.replace(/[^a-z0-9-]/gi, '')}-${stamp}.ocsave`;
}

/** Default slot name shown in the listing, e.g. "Starter Park · 24 Oct 2026, 09:30". */
export function defaultSlotName(scenarioName: string, savedAt: number): string {
  const when = new Date(savedAt).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${scenarioName} · ${when}`;
}

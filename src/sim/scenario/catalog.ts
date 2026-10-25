import { parseScenarioFile } from './scenario-file';
import { SANDBOX_ID } from './scenario';
import type { ScenarioDef } from './scenario';

/** The starter scenario heads the list (and its tab), so New game offers it first; the rest follow in file-name order. */
export const STARTER_ID = 'starter';

/**
 * Every `scenarios/*.json` file is a scenario. Adding a file adds a playable scenario; the title
 * screen groups them into tabs by each file's `category`.
 */
const files = import.meta.glob<unknown>('./scenarios/*.json', { eager: true, import: 'default' });

/** Parsed, validated scenarios in file-name order. Throws on a malformed file or duplicate id. */
export const SCENARIOS: readonly ScenarioDef[] = buildCatalog(files);

export function findScenario(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/** Name shown for a saved game's scenario id, including the non-scenario ids above. */
export function scenarioDisplayName(id: string): string {
  if (id === SANDBOX_ID) return 'Sandbox';
  return findScenario(id)?.name ?? 'Imported game';
}

export function buildCatalog(modules: Record<string, unknown>): ScenarioDef[] {
  const seen = new Set<string>();
  const defs = Object.keys(modules)
    .sort()
    .map((path) => {
      const def = parseScenarioFile(modules[path]);
      if (seen.has(def.id)) throw new Error(`Duplicate scenario id ${def.id} in ${path}`);
      seen.add(def.id);
      return def;
    });
  return [...defs.filter((d) => d.id === STARTER_ID), ...defs.filter((d) => d.id !== STARTER_ID)];
}

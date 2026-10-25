import type { SimClient } from '../../worker/sim-client';
import type { GameUI } from '../../ui/game-ui';
import type { TitleScreen } from '../../ui/title-screen';
import type { SaveMenu } from '../../ui/save-menu';
import type { ScenarioDialog } from '../../ui/scenario-dialog';
import type { GameSpeed } from '../../ui/settings';
import type { SaveSlotMeta, SlotStore } from '../../save/slot-store';
import { createMemorySlotStore, openIndexedDbSlotStore } from '../../save/slot-store';
import { defaultSlotName, exportFileName, saveGameToSlot } from '../../save/game-saves';
import { summarizeSave } from '../../save/save';
import { loadScenarioProgress, markScenarioCompleted } from '../../save/scenario-progress';
import type { ScenarioProgress } from '../../save/scenario-progress';
import { IMPORTED_ID, SANDBOX_ID } from '../../sim/scenario/scenario';
import type { ScenarioDef } from '../../sim/scenario/scenario';
import { DEFAULT_MAP_SIZE } from '../../sim/core/constants';
import { scenarioDisplayName, SCENARIOS } from '../../sim/scenario/catalog';
import { downloadBytes } from '../../ui/dom';
import type { PlayerSettings } from '../../ui/settings';
import { saveSettings } from '../../ui/settings';

export interface GameInfo {
  scenarioId: string;
  scenarioName: string;
}

export interface Session extends GameInfo {
  outcomeShown: boolean;
  winRecorded: boolean;
  resumed: boolean;
}

export interface SaveLoadDependencies {
  root: HTMLElement;
  sim: SimClient;
  slots: SlotStore;
  settings: PlayerSettings;
  getSpeed: () => GameSpeed;
  getUserPaused: () => boolean;
  gameUi: GameUI;
  clearGuestSelection: () => void;
  audio: { reset(): void };
  titleScreen: TitleScreen;
  saveMenu: SaveMenu;
  outcomeDialog: ScenarioDialog;
  syncPause: () => void;
}

export function readScenarioProgress(): ScenarioProgress {
  try {
    return loadScenarioProgress();
  } catch {
    return {};
  }
}

export function openSlotStore(): Promise<{ store: SlotStore; note: string }> {
  return openIndexedDbSlotStore()
    .then((store) => ({ store, note: '' }))
    .catch((err: unknown) => ({
      store: createMemorySlotStore(),
      note: `Saved games will not persist in this browser: ${(err as Error).message}`,
    }));
}

export function createSaveLoadController(deps: SaveLoadDependencies) {
  let session: Session | null = null;

  function persistSettings(): void {
    saveSettings({ ...deps.settings, speed: deps.getSpeed(), paused: deps.getUserPaused() });
  }

  function begin(game: GameInfo, resumed: boolean): void {
    deps.audio.reset();
    session = { ...game, outcomeShown: false, winRecorded: false, resumed };
    deps.clearGuestSelection();
    deps.root.classList.remove('title-open');
    deps.gameUi.onGameStart(!resumed);
    deps.titleScreen.hide();
    deps.saveMenu.close();
    deps.outcomeDialog.hide();
    deps.syncPause();
  }

  function startNewGame(def: ScenarioDef): void {
    deps.sim.startGame({
      seed: def.seed,
      width: def.mapWidth,
      height: def.mapHeight,
      initialGuests: 0,
      scenario: def,
    });
    begin({ scenarioId: def.id, scenarioName: def.name }, false);
  }

  function startSandbox(): void {
    deps.sim.startGame({
      seed: 1,
      width: DEFAULT_MAP_SIZE,
      height: DEFAULT_MAP_SIZE,
      initialGuests: 1000,
    });
    begin({ scenarioId: SANDBOX_ID, scenarioName: scenarioDisplayName(SANDBOX_ID) }, false);
  }

  async function loadBytes(bytes: Uint8Array, game: GameInfo): Promise<void> {
    summarizeSave(bytes);
    const previous = session;
    session = null;
    try {
      await deps.sim.load(bytes);
    } catch (err) {
      session = previous;
      throw err;
    }
    begin(game, true);
  }

  async function requireSlot(id: string) {
    const slot = await deps.slots.get(id);
    if (!slot) throw new Error('That save no longer exists.');
    return slot;
  }

  function gameOf(slot: SaveSlotMeta): GameInfo {
    return {
      scenarioId: slot.scenarioId,
      scenarioName: scenarioDisplayName(slot.scenarioId),
    };
  }

  async function loadSlotFromTitle(slot: SaveSlotMeta): Promise<void> {
    try {
      await loadBytes((await requireSlot(slot.id)).bytes, gameOf(slot));
    } catch (err) {
      deps.titleScreen.showError(`Could not load that save: ${(err as Error).message}`);
    }
  }

  async function importFromTitle(file: File): Promise<void> {
    try {
      await loadBytes(new Uint8Array(await file.arrayBuffer()), {
        scenarioId: IMPORTED_ID,
        scenarioName: scenarioDisplayName(IMPORTED_ID),
      });
    } catch (err) {
      deps.titleScreen.showError(`Could not import that file: ${(err as Error).message}`);
    }
  }

  function openSaveMenu(): void {
    const current = session;
    if (!current) return;
    deps.saveMenu.open({
      scenarioName: current.scenarioName,
      defaultSlotName: defaultSlotName(current.scenarioName, Date.now()),
    });
    deps.syncPause();
  }

  function goToTitle(): void {
    session = null;
    deps.saveMenu.close();
    deps.outcomeDialog.hide();
    deps.root.classList.add('title-open');
    deps.titleScreen.show();
    deps.syncPause();
  }

  function requireSession(): Session {
    if (!session) throw new Error('No game is running.');
    return session;
  }

  async function recordSave(id: string, name: string): Promise<void> {
    const current = requireSession();
    await saveGameToSlot(deps.sim, deps.slots, {
      id,
      name,
      scenarioId: current.scenarioId,
      savedAt: Date.now(),
    });
  }

  async function loadSave(slot: SaveSlotMeta): Promise<void> {
    await loadBytes((await requireSlot(slot.id)).bytes, gameOf(slot));
  }

  async function exportSave(): Promise<void> {
    const current = requireSession();
    downloadBytes(await deps.sim.save(), exportFileName(current.scenarioId, Date.now()));
  }

  async function importSave(file: File): Promise<void> {
    await loadBytes(new Uint8Array(await file.arrayBuffer()), {
      scenarioId: IMPORTED_ID,
      scenarioName: scenarioDisplayName(IMPORTED_ID),
    });
  }

  function recordScenarioWin(scenarioId: string): void {
    if (!SCENARIOS.some((scenario) => scenario.id === scenarioId)) return;
    try {
      markScenarioCompleted(scenarioId, Date.now());
    } catch {
      // Storage full or blocked: the win simply is not remembered.
    }
  }

  return {
    current: () => session,
    persistSettings,
    begin,
    startNewGame,
    startSandbox,
    loadBytes,
    loadSlotFromTitle,
    importFromTitle,
    openSaveMenu,
    goToTitle,
    requireSession,
    recordSave,
    loadSave,
    removeSave: (slot: SaveSlotMeta) => deps.slots.remove(slot.id),
    exportSave,
    importSave,
    recordScenarioWin,
    defaultSlotName,
  };
}

import { SimClient } from './worker/sim-client';
import { createRenderer } from './render/create-renderer';
import type { Camera, MapData } from './render/renderer';
import { pickTile, project } from './render/projection';
import type { Rotation } from './render/projection';
import { Hud } from './ui/hud';
import { GameUI, guestDetailsText } from './ui/game-ui';
import type { GuestSelection, ToolMode } from './ui/game-ui';
import { TitleScreen } from './ui/title-screen';
import { SaveMenu } from './ui/save-menu';
import { ScenarioDialog } from './ui/scenario-dialog';
import { downloadBytes } from './ui/dom';
import { loadSettings, saveSettings } from './ui/settings';
import type { GameSpeed } from './ui/settings';
import { DEFAULT_MAP_SIZE, TILE_UNITS } from './sim/core/constants';
import { PathAddition } from './sim/map/paths';
import { CoasterPanel } from './ui/coaster-panel';
import { TrackPreviewOverlay } from './ui/track-preview';
import { SCENARIOS, scenarioDisplayName } from './sim/scenario/catalog';
import { IMPORTED_ID, SANDBOX_ID } from './sim/scenario/scenario';
import { ScenarioStatus } from './sim/scenario/scenario';
import type { ScenarioDef } from './sim/scenario/scenario';
import { createMemorySlotStore, openIndexedDbSlotStore } from './save/slot-store';
import type { SaveSlotMeta, SlotStore } from './save/slot-store';
import { defaultSlotName, exportFileName, saveGameToSlot } from './save/game-saves';
import { summarizeSave } from './save/save';

const root = document.getElementById('app') as HTMLElement;
const selection = createRenderer(document.getElementById('game') as HTMLCanvasElement);
const canvas = selection.canvas;
const renderer = selection.renderer;

const sim = new SimClient();
sim.onMap = (map) => renderer.setMap(map);

const { store: slots, note: storeNote } = await openSlotStore();

interface GameInfo {
  scenarioId: string;
  scenarioName: string;
}

/**
 * The game the player is in. `resumed` marks a loaded game whose outcome has not been seen
 * active yet: if it is already finished, the objective strip states the result and no dialog opens.
 */
interface Session extends GameInfo {
  outcomeShown: boolean;
  resumed: boolean;
}

const settings = loadSettings();
let speed: GameSpeed = settings.speed;
let userPaused = settings.paused;
let lastSentPause: boolean | null = null;
let session: Session | null = null;
sim.setSpeed(speed);

const camera: Camera = { x: 0, y: (DEFAULT_MAP_SIZE * 32) / 2, zoom: 1, rotation: 0 };
const hud = new Hud(root);
let selectedTool: ToolMode = 'select';
let selectedGuest: GuestSelection | null = null;
let ridePlacement: { rideId: number; part: 'entrance' | 'exit' } | null = null;
let patrolKind: number | null = null;
const coasterPanel = new CoasterPanel(root, {
  command: (command) => sim.command(command),
  selectTool: (tool) => gameUi.selectTool(tool),
  snapshot: () => sim.latest,
  map: () => sim.map,
  status: (text) => gameUi.setToolStatus(text),
});
const trackPreview = new TrackPreviewOverlay(root);
const gameUi = new GameUI(root, {
  setPaused(value) {
    userPaused = value;
    persistSettings();
    syncPause();
  },
  setSpeed(next) {
    speed = next as GameSpeed;
    sim.setSpeed(next);
    persistSettings();
  },
  rotate(direction) {
    camera.rotation = ((camera.rotation + direction + 4) % 4) as Rotation;
  },
  setTool(tool) {
    selectedTool = tool;
    coasterPanel.setTool(tool);
  },
  spawnGuests() {
    sim.command({ type: 'spawnGuests', count: 1000 });
  },
  openMenu() {
    openSaveMenu();
  },
  hireStaff(kind) {
    sim.command({ type: 'hireStaff', kind });
  },
  setPatrolKind(kind) {
    patrolKind = kind;
  },
  renameStaff(staffId, name) {
    sim.command({ type: 'renameStaff', staffId, name });
  },
  fireStaff(staffId) {
    sim.command({ type: 'fireStaff', staffId });
  },
  setRidePrice(rideId, priceCents) {
    sim.command({ type: 'setRidePrice', rideId, priceCents });
  },
  setRideStatus(rideId, status) {
    sim.command({ type: 'setRideStatus', rideId, status });
  },
  placeRidePart(rideId, part) {
    ridePlacement = { rideId, part };
    gameUi.selectTool('ride');
    gameUi.setToolStatus(`Click a tile next to ride ${rideId} to place its ${part}.`);
  },
});
gameUi.syncPaused(userPaused);

const outcomeDialog = new ScenarioDialog(root);
const outcomeActions = {
  keepPlaying() {
    outcomeDialog.hide();
    syncPause();
  },
  openMenu() {
    outcomeDialog.hide();
    openSaveMenu();
  },
  backToTitle() {
    goToTitle();
  },
};

const titleScreen = new TitleScreen(root, SCENARIOS, slots, {
  newGame: (def) => startNewGame(def),
  sandbox: () => startSandbox(),
  loadSlot: (slot) => void loadSlotFromTitle(slot),
  importFile: (file) => void importFromTitle(file),
});

const saveMenu = new SaveMenu(root, slots, {
  save: async (id, name) => {
    const current = requireSession();
    await saveGameToSlot(sim, slots, {
      id,
      name,
      scenarioId: current.scenarioId,
      savedAt: Date.now(),
    });
  },
  load: async (slot) => {
    await loadBytes((await requireSlot(slot.id)).bytes, gameOf(slot));
  },
  remove: async (slot) => {
    await slots.remove(slot.id);
  },
  exportFile: async () => {
    const current = requireSession();
    downloadBytes(await sim.save(), exportFileName(current.scenarioId, Date.now()));
  },
  importFile: async (file) => {
    await loadBytes(new Uint8Array(await file.arrayBuffer()), {
      scenarioId: IMPORTED_ID,
      scenarioName: scenarioDisplayName(IMPORTED_ID),
    });
  },
  backToTitle: () => goToTitle(),
});

function persistSettings(): void {
  saveSettings({ speed, paused: userPaused });
}

function overlayOpen(): boolean {
  return titleScreen.visible || saveMenu.isOpen || outcomeDialog.visible;
}

/** The worker pauses while the player has paused or a menu/outcome dialog is open. */
function syncPause(): void {
  const effective = userPaused || overlayOpen();
  if (effective === lastSentPause) return;
  lastSentPause = effective;
  sim.setPaused(effective);
}

function begin(game: GameInfo, resumed: boolean): void {
  session = { ...game, outcomeShown: false, resumed };
  selectedGuest = null;
  root.classList.remove('title-open');
  titleScreen.hide();
  saveMenu.close();
  outcomeDialog.hide();
  syncPause();
}

function startNewGame(def: ScenarioDef): void {
  sim.startGame({
    seed: def.seed,
    width: def.mapWidth,
    height: def.mapHeight,
    initialGuests: 0,
    scenario: def,
  });
  begin({ scenarioId: def.id, scenarioName: def.name }, false);
}

function startSandbox(): void {
  sim.startGame({
    seed: 1,
    width: DEFAULT_MAP_SIZE,
    height: DEFAULT_MAP_SIZE,
    initialGuests: 1000,
  });
  begin({ scenarioId: SANDBOX_ID, scenarioName: scenarioDisplayName(SANDBOX_ID) }, false);
}

async function loadBytes(bytes: Uint8Array, game: GameInfo): Promise<void> {
  // Check the header before the worker is touched, so a bad file leaves the current game running.
  summarizeSave(bytes);
  // No game is current while the load is in flight, so a save cannot be labelled with the old scenario.
  const previous = session;
  session = null;
  try {
    await sim.load(bytes);
  } catch (err) {
    session = previous;
    throw err;
  }
  begin(game, true);
}

async function loadSlotFromTitle(slot: SaveSlotMeta): Promise<void> {
  try {
    await loadBytes((await requireSlot(slot.id)).bytes, gameOf(slot));
  } catch (err) {
    titleScreen.showError(`Could not load that save: ${(err as Error).message}`);
  }
}

async function importFromTitle(file: File): Promise<void> {
  try {
    await loadBytes(new Uint8Array(await file.arrayBuffer()), {
      scenarioId: IMPORTED_ID,
      scenarioName: scenarioDisplayName(IMPORTED_ID),
    });
  } catch (err) {
    titleScreen.showError(`Could not import that file: ${(err as Error).message}`);
  }
}

function openSaveMenu(): void {
  const current = session;
  if (!current) return;
  saveMenu.open({
    scenarioName: current.scenarioName,
    defaultSlotName: defaultSlotName(current.scenarioName, Date.now()),
  });
  syncPause();
}

function goToTitle(): void {
  session = null;
  saveMenu.close();
  outcomeDialog.hide();
  root.classList.add('title-open');
  titleScreen.show();
  syncPause();
}

function requireSession(): Session {
  if (!session) throw new Error('No game is running.');
  return session;
}

async function requireSlot(id: string) {
  const slot = await slots.get(id);
  if (!slot) throw new Error('That save no longer exists.');
  return slot;
}

function gameOf(slot: SaveSlotMeta): GameInfo {
  return {
    scenarioId: slot.scenarioId,
    scenarioName: scenarioDisplayName(slot.scenarioId),
  };
}

async function openSlotStore(): Promise<{ store: SlotStore; note: string }> {
  try {
    return { store: await openIndexedDbSlotStore(), note: '' };
  } catch (err) {
    return {
      store: createMemorySlotStore(),
      note: `Saved games will not persist in this browser: ${(err as Error).message}`,
    };
  }
}

root.classList.add('title-open');
titleScreen.show();
if (storeNote) titleScreen.showError(storeNote);

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
}
window.addEventListener('resize', resize);
resize();

const keys = new Set<string>();
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (event.repeat && ['q', 'e', 'g', ' '].includes(key)) return;
  keys.add(key);
  if (key === 'q') camera.rotation = ((camera.rotation + 3) % 4) as Rotation;
  if (key === 'e') camera.rotation = ((camera.rotation + 1) % 4) as Rotation;
  const onControl =
    event.target instanceof HTMLButtonElement ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLTextAreaElement;
  if (key === 'g' && session && !overlayOpen() && !onControl) {
    sim.command({ type: 'spawnGuests', count: 1000 });
  }
  if (session && !overlayOpen() && selectedTool === 'track' && !onControl && key === 'enter')
    coasterPanel.placeAtCursor();
  if (session && !overlayOpen() && selectedTool === 'track' && !onControl && key === 'backspace') {
    event.preventDefault();
    coasterPanel.removeLast();
  }
  if (key === ' ' && session && !overlayOpen()) {
    event.preventDefault();
    gameUi.togglePause();
    gameUi.setToolStatus(userPaused ? 'Simulation paused.' : 'Simulation resumed.');
  }
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener(
  'wheel',
  (event) => {
    const rect = canvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const anchorX = camera.x + (localX - rect.width / 2) / camera.zoom;
    const anchorY = camera.y + (localY - rect.height / 2) / camera.zoom;
    camera.zoom = Math.max(0.25, Math.min(4, camera.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    camera.x = anchorX - (localX - rect.width / 2) / camera.zoom;
    camera.y = anchorY - (localY - rect.height / 2) / camera.zoom;
    event.preventDefault();
  },
  { passive: false },
);

let pointerDown: { id: number; x: number; y: number; moved: boolean } | null = null;
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  pointerDown = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (selectedTool === 'track' && sim.map) {
    const rect = canvas.getBoundingClientRect();
    coasterPanel.setHover(
      pickTile(event.clientX - rect.left, event.clientY - rect.top, sim.map, camera, {
        width: rect.width,
        height: rect.height,
      }),
    );
  }
  if (!pointerDown || pointerDown.id !== event.pointerId) return;
  const dx = event.clientX - pointerDown.x;
  const dy = event.clientY - pointerDown.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) pointerDown.moved = true;
  if (!pointerDown.moved) return;
  camera.x -= event.movementX / camera.zoom;
  camera.y -= event.movementY / camera.zoom;
});
canvas.addEventListener('pointerup', (event) => {
  if (!pointerDown || pointerDown.id !== event.pointerId) return;
  if (!pointerDown.moved) handleCanvasClick(event);
  pointerDown = null;
});
canvas.addEventListener('pointercancel', () => (pointerDown = null));

function handleCanvasClick(event: PointerEvent): void {
  const rect = canvas.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const map = sim.map;
  if (!map) return;
  const tile = pickTile(localX, localY, map, camera, { width: rect.width, height: rect.height });
  if (selectedTool !== 'select') {
    if (!tile) {
      gameUi.setToolStatus(
        `${selectedTool[0].toUpperCase()}${selectedTool.slice(1)} tool · outside the park map.`,
      );
      return;
    }
    const [x, y] = tile;
    if (selectedTool === 'land') {
      sim.command({ type: event.shiftKey ? 'lowerLand' : 'raiseLand', x, y, width: 1, height: 1 });
      gameUi.setToolStatus(
        `${event.shiftKey ? 'Lowering' : 'Raising'} land at ${x}, ${y}. Hold Shift to lower.`,
      );
    } else if (selectedTool === 'path') {
      sim.command({ type: 'placePath', x, y });
      gameUi.setToolStatus(`Path placement requested at ${x}, ${y}.`);
    } else if (
      selectedTool === 'bin' ||
      selectedTool === 'bench' ||
      selectedTool === 'shelter' ||
      selectedTool === 'lamp'
    ) {
      sim.command({
        type: 'setPathAddition',
        x,
        y,
        addition:
          selectedTool === 'bin'
            ? PathAddition.Bin
            : selectedTool === 'bench'
              ? PathAddition.Bench
              : selectedTool === 'shelter'
                ? PathAddition.Shelter
                : PathAddition.Lamp,
      });
      gameUi.setToolStatus(`${selectedTool} placement requested at ${x}, ${y}.`);
    } else if (selectedTool === 'flowerbed') {
      sim.command({ type: 'setFlowerBed', x, y, enabled: !event.shiftKey });
      gameUi.setToolStatus(
        `${event.shiftKey ? 'Flower bed removal' : 'Flower bed planting'} requested at ${x}, ${y}.`,
      );
    } else if (selectedTool === 'patrol') {
      if (patrolKind === null) {
        gameUi.setToolStatus('Choose a staff role or person in the Staff panel first.');
        return;
      }
      sim.command({
        type: 'setStaffKindPatrolTile',
        kind: patrolKind,
        x,
        y,
        enabled: !event.shiftKey,
      });
      gameUi.setToolStatus(
        `${event.shiftKey ? 'Patrol tile removed from' : 'Patrol tile added to'} ${x}, ${y}.`,
      );
    } else if (selectedTool === 'ride') {
      if (ridePlacement) {
        sim.command({
          type: ridePlacement.part === 'entrance' ? 'placeRideEntrance' : 'placeRideExit',
          rideId: ridePlacement.rideId,
          x,
          y,
        });
        gameUi.setToolStatus(
          `Placing ${ridePlacement.part} for ride ${ridePlacement.rideId} at ${x}, ${y}.`,
        );
        ridePlacement = null;
      } else {
        gameUi.setToolStatus(coasterPanel.createRideAt(x, y));
      }
    } else {
      gameUi.setToolStatus(coasterPanel.handleTileClick(x, y));
    }
    return;
  }
  const guestDetails = findGuestAt(localX, localY, rect.width, rect.height, map, camera);
  selectedGuest =
    guestDetails && sim.latest ? { details: guestDetails, tick: sim.latest.tick } : null;
  if (selectedGuest) gameUi.openGuestPanel();
  gameUi.setToolStatus(tile ? `Tile ${tile[0]}, ${tile[1]}` : 'Outside the park map.');
  gameUi.update(sim.latest, sim.stats, selectedGuest);
}

function findGuestAt(
  screenX: number,
  screenY: number,
  viewportWidth: number,
  viewportHeight: number,
  map: MapData,
  cam: Camera,
): string | null {
  const layer = sim.latest?.guests;
  if (!layer) return null;
  const projected = new Float64Array(2);
  let nearest = -1;
  let nearestDistance = 13 * 13;
  for (let i = 0, offset = 0; i < layer.count; i++, offset += 4) {
    project(
      layer.data[offset],
      layer.data[offset + 1],
      layer.data[offset + 2],
      map.width,
      map.height,
      cam.rotation,
      projected,
    );
    const x = viewportWidth / 2 + (projected[0] - cam.x) * cam.zoom;
    const y = viewportHeight / 2 + (projected[1] - cam.y) * cam.zoom;
    const dx = x - screenX;
    const dy = y - screenY;
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearest = i;
      nearestDistance = distance;
    }
  }
  if (nearest < 0) return null;
  const offset = nearest * 4;
  const x = layer.data[offset];
  const y = layer.data[offset + 1];
  const state = layer.data[offset + 3] >>> 8;
  const tileX = Math.floor(x / TILE_UNITS);
  const tileY = Math.floor(y / TILE_UNITS);
  const detailOffset = nearest * 12;
  const snapshot = sim.latest;
  const details = snapshot?.guestDetails;
  const inspection = details
    ? guestDetailsText({
        happiness: details[detailOffset],
        hunger: details[detailOffset + 1],
        thirst: details[detailOffset + 2],
        toilet: details[detailOffset + 3],
        nausea: details[detailOffset + 4],
        energy: details[detailOffset + 5],
        cash: details[detailOffset + 6],
        thoughts: Array.from(
          { length: 4 },
          (_, i) => details[detailOffset + 8 + ((details[detailOffset + 7] + i) & 3)],
        ),
      })
    : '';
  return `Guest ${nearest + 1}\nTile  ${tileX}, ${tileY}\nState  ${guestState(state)}${inspection ? `\n${inspection}` : ''}`;
}

function guestState(state: number): string {
  return (
    ['walking', 'queueing', 'riding', 'leaving', 'shopping', 'waiting to board'][state] ??
    `state ${state}`
  );
}

let last = performance.now();
let fps = 60;
let renderMs = 0;
function frame(now: number): void {
  const dt = now - last;
  last = now;
  fps = fps * 0.95 + (1000 / Math.max(dt, 1)) * 0.05;
  const pan = (0.6 * dt) / camera.zoom;
  if (keys.has('a')) camera.x -= pan;
  if (keys.has('d')) camera.x += pan;
  if (keys.has('w')) camera.y -= pan;
  if (keys.has('s')) camera.y += pan;
  const latest = sim.latest;
  if (session && latest) {
    if (latest.scenario.status === ScenarioStatus.Active) {
      session.resumed = false;
    } else if (!session.outcomeShown) {
      session.outcomeShown = true;
      if (!session.resumed) {
        outcomeDialog.show(latest.scenario.status, session.scenarioName, outcomeActions);
      }
    }
  }
  syncPause();
  const renderStart = performance.now();
  renderer.draw(sim.latest, camera);
  renderMs = performance.now() - renderStart;
  hud.update(
    sim.stats,
    fps,
    camera.rotation,
    renderMs,
    renderer.visibleSpriteCount,
    renderer.backend,
  );
  gameUi.update(sim.latest, sim.stats, selectedGuest);
  coasterPanel.update();
  const rect = canvas.getBoundingClientRect();
  trackPreview.draw(
    sim.map ? coasterPanel.ghost() : null,
    sim.map ?? { width: 0, height: 0 },
    camera,
    { width: rect.width, height: rect.height },
    window.devicePixelRatio || 1,
  );
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => {
  gameUi.dispose();
  coasterPanel.dispose();
  trackPreview.dispose();
  renderer.dispose();
});

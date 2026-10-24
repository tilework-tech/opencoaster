import { SimClient } from './worker/sim-client';
import { createRenderer } from './render/create-renderer';
import type { Camera, MapData } from './render/renderer';
import { pickTile, project } from './render/projection';
import type { Rotation } from './render/projection';
import { Hud } from './ui/hud';
import { GameUI } from './ui/game-ui';
import type { GuestSelection, ToolMode } from './ui/game-ui';
import { WindowManager } from './ui/window-manager';
import { DEFAULT_ZOOM, stepZoom } from './ui/zoom';
import './ui/ui.css';
import { TitleScreen } from './ui/title-screen';
import { SaveMenu } from './ui/save-menu';
import { ScenarioDialog } from './ui/scenario-dialog';
import { downloadBytes } from './ui/dom';
import { loadSettings, saveSettings } from './ui/settings';
import type { GameSpeed } from './ui/settings';
import { DEFAULT_MAP_SIZE, TILE_UNITS, Z_STEP } from './sim/core/constants';
import { PathFlag } from './sim/map/tile-map';
import { PathAddition } from './sim/map/paths';
import { CoasterPanel } from './ui/coaster-panel';
import { RIDE_CATALOG } from './sim/rides/ride-types';
import { TrackPreviewOverlay } from './ui/track-preview';
import { SCENARIOS, scenarioDisplayName } from './sim/scenario/catalog';
import { IMPORTED_ID, SANDBOX_ID } from './sim/scenario/scenario';
import { ScenarioStatus } from './sim/scenario/scenario';
import type { ScenarioDef } from './sim/scenario/scenario';
import { createMemorySlotStore, openIndexedDbSlotStore } from './save/slot-store';
import type { SaveSlotMeta, SlotStore } from './save/slot-store';
import { defaultSlotName, exportFileName, saveGameToSlot } from './save/game-saves';
import { summarizeSave } from './save/save';
import { registerPwa } from './pwa/register';
import { capDevicePixelRatio, zoomCameraAt } from './input/camera-controls';
import { PointerInput } from './input/pointer-input';
import type { PointerSample } from './input/pointer-input';
import { findRideIdAtTile } from './input/object-picking';
import { GUEST_DETAIL_STRIDE } from './worker/snapshot';

const root = document.getElementById('app') as HTMLElement;
const selection = createRenderer(document.getElementById('game') as HTMLCanvasElement);
const canvas = selection.canvas;
const renderer = selection.renderer;
registerPwa();

const sim = new SimClient();
sim.onMap = (map) => {
  renderer.setMap(map);
  camera.x = (map.width - map.height) * 16;
  camera.y = (map.width + map.height) * 8;
};

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
let hiddenPaused = document.visibilityState === 'hidden';
let lastSentPause: boolean | null = null;
let session: Session | null = null;
sim.setSpeed(speed);

const camera: Camera = { x: 0, y: (DEFAULT_MAP_SIZE * 32) / 2, zoom: DEFAULT_ZOOM, rotation: 0 };
const hud = new Hud(root);
let selectedTool: ToolMode = 'select';
let selectedGuest: GuestSelection | null = null;
let ridePlacement: { rideId: number; part: 'entrance' | 'exit' } | null = null;
let patrolKind: number | null = null;
let alternate = false;
let pathQueue = false;
let pathSlope = -1;
let brush = 1;
const windows = new WindowManager(root);
const coasterPanel = new CoasterPanel(windows, {
  command: (command) => sim.command(command),
  selectTool: (tool) => gameUi.selectTool(tool),
  snapshot: () => sim.latest,
  map: () => sim.map,
  status: (text) => gameUi.setToolStatus(text),
});
const patrolOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
patrolOverlay.classList.add('patrol-overlay');
patrolOverlay.setAttribute('aria-hidden', 'true');
root.append(patrolOverlay);
let patrolOverlaySignature = '';
const trackPreview = new TrackPreviewOverlay(root);
const gameUi = new GameUI(root, windows, {
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
  zoom(direction) {
    camera.zoom = stepZoom(camera.zoom, direction);
  },
  command(command) {
    sim.command(command);
  },
  setAlternate(on) {
    alternate = on;
  },
  setBrush(size) {
    brush = Math.max(1, Math.min(5, Math.round(size)));
  },
  setPathOptions(queue, slope) {
    pathQueue = queue;
    pathSlope = slope;
  },
  locate(x, y) {
    centreOnTile(x, y);
  },
  chooseRideType(type) {
    coasterPanel.rideType = type;
    ridePlacement = null;
    gameUi.selectTool('ride');
    gameUi.setToolStatus(`${RIDE_CATALOG[type].name} selected. Tap a tile you own to build it.`);
  },
  editTrack(rideId) {
    coasterPanel.setActiveRide(rideId);
    gameUi.selectTool('track');
  },
  map: () => sim.map,
  camera: () => camera,
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
  setRideTrains(rideId, trains, cars) {
    sim.command({ type: 'setRideTrains', rideId, trains, cars });
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
gameUi.syncSpeed(speed);

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
  const effective = userPaused || hiddenPaused || overlayOpen();
  if (effective === lastSentPause) return;
  lastSentPause = effective;
  sim.setPaused(effective);
}

function begin(game: GameInfo, resumed: boolean): void {
  session = { ...game, outcomeShown: false, resumed };
  selectedGuest = null;
  root.classList.remove('title-open');
  gameUi.onGameStart(!resumed);
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
  const rect = canvas.getBoundingClientRect();
  const dpr = capDevicePixelRatio(window.devicePixelRatio || 1);
  renderer.resize(rect.width, rect.height, dpr);
}
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
screen.orientation?.addEventListener('change', resize);
new ResizeObserver(resize).observe(canvas);
resize();

document.addEventListener('visibilitychange', () => {
  hiddenPaused = document.visibilityState === 'hidden';
  syncPause();
});

const keys = new Set<string>();
function downloadScreenshot(): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `opencoaster-screenshot-${Date.now()}.png`;
    link.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}
window.addEventListener('keydown', (event) => {
  const typing =
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLTextAreaElement;
  const onButton = event.target instanceof HTMLButtonElement;
  keys.add(event.key.toLowerCase());
  if (!session || overlayOpen()) return;
  if (event.ctrlKey && event.key.toLowerCase() === 's' && !typing) {
    event.preventDefault();
    downloadScreenshot();
    return;
  }
  if (event.key === 'Delete' && selectedTool === 'track' && !typing) {
    event.preventDefault();
    coasterPanel.removeLast();
    return;
  }
  if (typing && !['Escape', 'PageUp', 'PageDown', 'F1', 'F2', 'F3', 'F4', 'F5'].includes(event.key))
    return;
  if (onButton && (event.key === ' ' || event.key === 'Enter')) return;
  if (event.repeat && event.key !== 'PageUp' && event.key !== 'PageDown') return;
  if (gameUi.handleShortcut(event)) event.preventDefault();
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));

/** Smallest wheel travel that counts as one zoom step; trackpads send many small deltas. */
const WHEEL_STEP = 60;
let wheelAccum = 0;
window.addEventListener(
  'wheel',
  (event) => {
    if (event.target !== canvas) return;
    wheelAccum += event.deltaY;
    event.preventDefault();
    if (Math.abs(wheelAccum) < WHEEL_STEP) return;
    const rect = canvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    zoomCameraAt(camera, stepZoom(camera.zoom, wheelAccum < 0 ? 1 : -1), localX, localY, {
      width: rect.width,
      height: rect.height,
    });
    wheelAccum = 0;
  },
  { passive: false },
);

function centreOnTile(x: number, y: number): void {
  const map = sim.map;
  if (!map) return;
  const out = new Float64Array(2);
  project(
    x * TILE_UNITS + TILE_UNITS / 2,
    y * TILE_UNITS + TILE_UNITS / 2,
    0,
    map.width,
    map.height,
    camera.rotation,
    out,
  );
  camera.x = out[0];
  camera.y = out[1];
}

function localPosition(x: number, y: number): [number, number] {
  const rect = canvas.getBoundingClientRect();
  return [x - rect.left, y - rect.top];
}

function pointerSample(event: PointerEvent): PointerSample {
  return {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    pointerType: event.pointerType,
    shiftKey: event.shiftKey,
  };
}

let pinchStartZoom: number | null = null;
let lastPaintTile: string | null = null;
const pointerInput = new PointerInput({
  tool: () => selectedTool,
  pan(dx, dy) {
    camera.x -= dx / camera.zoom;
    camera.y -= dy / camera.zoom;
  },
  zoomStart() {
    pinchStartZoom = camera.zoom;
  },
  zoom(scale, x, y) {
    if (pinchStartZoom === null) return;
    const [localX, localY] = localPosition(x, y);
    const rect = canvas.getBoundingClientRect();
    zoomCameraAt(camera, pinchStartZoom * scale, localX, localY, {
      width: rect.width,
      height: rect.height,
    });
  },
  zoomEnd() {
    pinchStartZoom = null;
  },
  rotate(direction) {
    camera.rotation = ((camera.rotation + direction + 4) % 4) as Rotation;
  },
  tap(x, y, shiftKey) {
    handleCanvasClick(x, y, shiftKey);
  },
  hold(x, y) {
    if (selectedTool === 'path') removePathAt(x, y);
    else handleCanvasClick(x, y, false, true);
  },
  paint(x, y, shiftKey) {
    const map = sim.map;
    if (!map) return;
    const [localX, localY] = localPosition(x, y);
    const rect = canvas.getBoundingClientRect();
    const tile = pickTile(localX, localY, map, camera, {
      width: rect.width,
      height: rect.height,
    });
    if (!tile) return;
    const key = `${tile[0]}:${tile[1]}`;
    if (key === lastPaintTile) return;
    lastPaintTile = key;
    handleCanvasClick(x, y, shiftKey);
  },
});
canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  lastPaintTile = null;
  pointerInput.pointerDown(pointerSample(event));
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
  pointerInput.pointerMove(pointerSample(event));
});
canvas.addEventListener('pointerup', (event) => {
  pointerInput.pointerUp(pointerSample(event));
});
canvas.addEventListener('pointercancel', (event) => pointerInput.pointerCancel(event.pointerId));
canvas.addEventListener('contextmenu', (event) => {
  if (selectedTool !== 'path') return;
  event.preventDefault();
  removePathAt(event.clientX, event.clientY);
});

function removePathAt(clientX: number, clientY: number): void {
  const rect = canvas.getBoundingClientRect();
  const map = sim.map;
  if (!map) return;
  const tile = pickTile(clientX - rect.left, clientY - rect.top, map, camera, {
    width: rect.width,
    height: rect.height,
  });
  if (!tile) return;
  sim.command({ type: 'removePath', x: tile[0], y: tile[1] });
  gameUi.setToolStatus(`Path removal requested at ${tile[0]}, ${tile[1]}.`);
}

function handleCanvasClick(
  clientX: number,
  clientY: number,
  shiftKey = false,
  forceSelect = false,
): void {
  const rect = canvas.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const map = sim.map;
  if (!map) return;
  const tile = pickTile(localX, localY, map, camera, { width: rect.width, height: rect.height });
  if (selectedTool !== 'select' && !forceSelect) {
    if (!tile) {
      gameUi.setToolStatus(
        `${selectedTool[0].toUpperCase()}${selectedTool.slice(1)} tool · outside the park map.`,
      );
      return;
    }
    const [x, y] = tile;
    if (selectedTool === 'land') {
      const lower = shiftKey || alternate;
      const origin = Math.floor((brush - 1) / 2);
      sim.command({
        type: lower ? 'lowerLand' : 'raiseLand',
        x: Math.max(0, x - origin),
        y: Math.max(0, y - origin),
        width: brush,
        height: brush,
      });
      gameUi.setToolStatus(`${lower ? 'Lowering' : 'Raising'} land at ${x}, ${y}.`);
    } else if (selectedTool === 'path') {
      if (alternate) {
        sim.command({ type: 'removePath', x, y });
        gameUi.setToolStatus(`Path removal requested at ${x}, ${y}.`);
      } else {
        sim.command({ type: 'placePath', x, y, queue: pathQueue, slope: pathSlope });
        gameUi.setToolStatus(`Path placement requested at ${x}, ${y}.`);
      }
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
      sim.command({ type: 'setFlowerBed', x, y, enabled: !(shiftKey || alternate) });
      gameUi.setToolStatus(
        `${shiftKey || alternate ? 'Flower bed removal' : 'Flower bed planting'} requested at ${x}, ${y}.`,
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
        enabled: !(shiftKey || alternate),
      });
      gameUi.setToolStatus(
        `${shiftKey || alternate ? 'Patrol tile removed from' : 'Patrol tile added to'} ${x}, ${y}.`,
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
  const guest = findGuestAt(localX, localY, rect.width, rect.height, map, camera);
  selectedGuest = guest;
  let selectionStatus = tile ? `Tile ${tile[0]}, ${tile[1]}` : 'Outside the park map.';
  if (guest) gameUi.openGuestPanel();
  else if (forceSelect && tile) {
    const rideId = sim.latest ? findRideIdAtTile(sim.latest, tile[0], tile[1]) : null;
    if (rideId !== null) {
      gameUi.openRide(rideId);
      selectionStatus = `Ride ${rideId} information opened.`;
    }
  }
  gameUi.setToolStatus(selectionStatus);
  gameUi.update(sim.latest, sim.stats, selectedGuest);
}

function findGuestAt(
  screenX: number,
  screenY: number,
  viewportWidth: number,
  viewportHeight: number,
  map: MapData,
  cam: Camera,
): GuestSelection | null {
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
  const detailOffset = nearest * GUEST_DETAIL_STRIDE;
  const snapshot = sim.latest;
  const details = snapshot?.guestDetails;
  if (!snapshot || !details) return null;
  return {
    id: snapshot.guestIds[nearest],
    number: nearest + 1,
    tileX,
    tileY,
    state: guestState(state),
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
    tick: snapshot.tick,
  };
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
function drawPatrolOverlay(): void {
  if (!session || selectedTool !== 'patrol' || patrolKind === null || !sim.map || !sim.latest) {
    patrolOverlay.setAttribute('hidden', '');
    patrolOverlaySignature = '';
    return;
  }
  patrolOverlay.removeAttribute('hidden');
  const map = sim.map;
  const snapshot = sim.latest;
  const mapSize = map.width * map.height;
  const start = patrolKind * mapSize;
  const mask = snapshot.patrolAreas;
  const rect = canvas.getBoundingClientRect();
  const signature = [
    snapshot.tick,
    patrolKind,
    camera.x,
    camera.y,
    camera.zoom,
    camera.rotation,
    rect.width,
    rect.height,
  ].join(':');
  if (signature === patrolOverlaySignature) return;
  patrolOverlaySignature = signature;
  const polygons: SVGPolygonElement[] = [];
  const point = new Float64Array(2);
  const surfaceHeights = Float32Array.from(map.heights, (height) => height * Z_STEP);
  const hasPath = new Uint8Array(mapSize);
  for (let path = 0; path < map.pathCount; path++) {
    const offset = path * 5;
    const x = map.pathElements[offset]!;
    const y = map.pathElements[offset + 1]!;
    const tile = y * map.width + x;
    if (hasPath[tile]) continue;
    const flags = map.pathElements[offset + 3]!;
    surfaceHeights[tile] =
      map.pathElements[offset + 2]! * Z_STEP + ((flags & PathFlag.Sloped) !== 0 ? Z_STEP / 2 : 0);
    hasPath[tile] = 1;
  }
  for (let tile = 0; tile < mapSize; tile++) {
    if (mask[start + tile] !== 1) continue;
    const x = tile % map.width;
    const y = Math.floor(tile / map.width);
    project(
      x * TILE_UNITS + TILE_UNITS / 2,
      y * TILE_UNITS + TILE_UNITS / 2,
      surfaceHeights[tile]!,
      map.width,
      map.height,
      camera.rotation,
      point,
    );
    const cx = rect.width / 2 + (point[0] - camera.x) * camera.zoom;
    const cy = rect.height / 2 + (point[1] - camera.y) * camera.zoom;
    const halfX = 32 * camera.zoom;
    const halfY = 16 * camera.zoom;
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute(
      'points',
      `${cx},${cy - halfY} ${cx + halfX},${cy} ${cx},${cy + halfY} ${cx - halfX},${cy}`,
    );
    polygons.push(polygon);
  }
  patrolOverlay.replaceChildren(...polygons);
}
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
  drawPatrolOverlay();
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
    capDevicePixelRatio(window.devicePixelRatio || 1),
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

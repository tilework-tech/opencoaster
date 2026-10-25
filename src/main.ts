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
import { PathFlag, PathStyle, Surface } from './sim/map/tile-map';
import { PathAddition } from './sim/map/paths';
import { SceneryItem } from './sim/map/scenery';
import { CoasterPanel } from './ui/coaster-panel';
import { RIDE_CATALOG } from './sim/rides/ride-types';
import { TrackPreviewOverlay } from './ui/track-preview';
import type { RidePlacementGhost } from './ui/track-preview';
import { ridePlacementValid } from './render/placement-art';
import { facilityFacingFromPaths } from './render/world-art';
import { SCENARIOS, scenarioDisplayName } from './sim/scenario/catalog';
import { IMPORTED_ID, SANDBOX_ID } from './sim/scenario/scenario';
import { ScenarioStatus } from './sim/scenario/scenario';
import type { ScenarioDef } from './sim/scenario/scenario';
import { createMemorySlotStore, openIndexedDbSlotStore } from './save/slot-store';
import type { SaveSlotMeta, SlotStore } from './save/slot-store';
import { defaultSlotName, exportFileName, saveGameToSlot } from './save/game-saves';
import { summarizeSave } from './save/save';
import { loadScenarioProgress, markScenarioCompleted } from './save/scenario-progress';
import type { ScenarioProgress } from './save/scenario-progress';
import { registerPwa } from './pwa/register';
import { capDevicePixelRatio, zoomCameraAt } from './input/camera-controls';
import { PointerInput } from './input/pointer-input';
import type { PointerSample } from './input/pointer-input';
import { findRideIdAtTile } from './input/object-picking';
import { GUEST_DETAIL_STRIDE, RideFlag, RideInfo, RIDE_INFO_STRIDE } from './worker/snapshot';
import { AudioEngine } from './audio/audio';
import { PIECES } from './sim/track/catalog';
import { PieceFlag } from './sim/track/track-types';
import { rotateTile } from './sim/track/construction';

const root = document.getElementById('app') as HTMLElement;
const selection = createRenderer(document.getElementById('game') as HTMLCanvasElement);
const canvas = selection.canvas;
const renderer = selection.renderer;
registerPwa();

const sim = new SimClient();
sim.onMap = (map, newGame) => {
  renderer.setMap(map);
  if (!newGame) return;
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
  winRecorded: boolean;
  resumed: boolean;
}

const settings = loadSettings();
const audio = new AudioEngine(settings);
document.addEventListener('pointerdown', () => void audio.unlock().catch(() => undefined), true);
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element) || !target.closest('button, [role="button"], input, select, a'))
    return;
  void audio
    .unlock()
    .then(() => audio.playUi('click'))
    .catch(() => undefined);
});
document.addEventListener('keydown', () => void audio.unlock().catch(() => undefined), true);
let speed: GameSpeed = settings.speed;
let userPaused = settings.paused;
let hiddenPaused = document.visibilityState === 'hidden';
let lastSentPause: boolean | null = null;
let session: Session | null = null;
sim.setSpeed(speed);

const camera: Camera = { x: 0, y: (DEFAULT_MAP_SIZE * 32) / 2, zoom: DEFAULT_ZOOM, rotation: 0 };
if (import.meta.env.DEV) (window as unknown as { __camera: Camera }).__camera = camera;
const hud = new Hud(root);
let selectedTool: ToolMode = 'select';
let selectedGuest: GuestSelection | null = null;
let ridePlacement: { rideId: number; part: 'entrance' | 'exit' } | null = null;
let rideHover: [number, number] | null = null;
let ridePlacementCommandPending = false;
let ridePlacementFeedbackSeq = -1;
let pendingRideCreation: { rideIds: number[]; rideType: number } | null = null;
let openingStallRideId: number | null = null;
let stallFrontTile: [number, number] | null = null;
let rideSetupNotice: string | null = null;
let patrolKind: number | null = null;
let alternate = false;
let pathQueue = false;
let pathSlope = -1;
let pathStyle = PathStyle.Tarmac;
let sceneryItem = SceneryItem.OakTree;
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
const ridePlacementPreview = document.createElement('canvas');
ridePlacementPreview.className = 'ride-placement-preview';
ridePlacementPreview.setAttribute('aria-hidden', 'true');
root.append(ridePlacementPreview);
const ridePlacementTargets = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
ridePlacementTargets.classList.add('ride-placement-targets');
ridePlacementTargets.setAttribute('aria-label', 'Valid ride placement tiles');
root.append(ridePlacementTargets);
let ridePlacementTargetSignature = '';
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
  setPathStyle(style) {
    pathStyle = style as PathStyle;
  },
  setSceneryItem(item) {
    sceneryItem = item as SceneryItem;
  },
  locate(x, y) {
    centreOnTile(x, y);
  },
  chooseRideType(type) {
    coasterPanel.rideType = type;
    ridePlacement = null;
    rideHover = null;
    ridePlacementCommandPending = false;
    pendingRideCreation = null;
    rideSetupNotice = null;
    gameUi.selectTool('ride');
    gameUi.setToolStatus(`${RIDE_CATALOG[type].name} selected. Tap a tile you own to build it.`);
  },
  editTrack(rideId) {
    coasterPanel.setActiveRide(rideId);
    gameUi.selectTool('track');
  },
  map: () => sim.map,
  camera: () => camera,
  audioSettings: () => settings,
  setAudioSettings(next) {
    Object.assign(settings, next);
    audio.setSettings(settings);
    persistSettings();
  },
  playUiSound(name) {
    audio.playUi(name);
  },
  setTool(tool) {
    selectedTool = tool;
    rideSetupNotice = null;
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
    ridePlacementCommandPending = false;
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

const titleScreen = new TitleScreen(
  root,
  SCENARIOS,
  slots,
  {
    newGame: (def) => startNewGame(def),
    sandbox: () => startSandbox(),
    loadSlot: (slot) => void loadSlotFromTitle(slot),
    importFile: (file) => void importFromTitle(file),
  },
  readScenarioProgress,
);

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
  saveSettings({ ...settings, speed, paused: userPaused });
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
  audio.reset();
  session = { ...game, outcomeShown: false, winRecorded: false, resumed };
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
window.addEventListener('blur', () => keys.clear());

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
  if ((selectedTool === 'track' || selectedTool === 'ride') && sim.map) {
    const rect = canvas.getBoundingClientRect();
    const tile = pickTile(event.clientX - rect.left, event.clientY - rect.top, sim.map, camera, {
      width: rect.width,
      height: rect.height,
    });
    if (selectedTool === 'track') coasterPanel.setHover(tile);
    else rideHover = tile;
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
  rideSetupNotice = null;
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
        sim.command({
          type: 'placePath',
          x,
          y,
          style: pathStyle,
          queue: pathQueue,
          slope: pathSlope,
        });
        gameUi.setToolStatus(`Path placement requested at ${x}, ${y}.`);
      }
    } else if (selectedTool === 'scenery') {
      sim.command(
        shiftKey || alternate
          ? { type: 'removeScenery', x, y }
          : { type: 'placeScenery', x, y, item: sceneryItem },
      );
      gameUi.setToolStatus(
        `${shiftKey || alternate ? 'Scenery removal' : 'Scenery placement'} requested at ${x}, ${y}.`,
      );
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
        if (ridePlacementCommandPending) return;
        sim.command({
          type: ridePlacement.part === 'entrance' ? 'placeRideEntrance' : 'placeRideExit',
          rideId: ridePlacement.rideId,
          x,
          y,
        });
        gameUi.setToolStatus(
          `Placing ${ridePlacement.part} for ride ${ridePlacement.rideId} at ${x}, ${y}.`,
        );
        ridePlacementCommandPending = true;
        ridePlacementFeedbackSeq = sim.latest?.feedback.seq ?? -1;
      } else {
        const latest = sim.latest;
        pendingRideCreation = {
          rideIds: latest
            ? Array.from(
                { length: latest.rides.count },
                (_, index) => latest.rideInfo[index * RIDE_INFO_STRIDE + RideInfo.Id],
              )
            : [],
          rideType: coasterPanel.rideType,
        };
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
/** Progress lives in localStorage, which can be unavailable (private browsing); that reads as none. */
function readScenarioProgress(): ScenarioProgress {
  try {
    return loadScenarioProgress();
  } catch {
    return {};
  }
}

function recordScenarioWin(scenarioId: string): void {
  if (!SCENARIOS.some((scenario) => scenario.id === scenarioId)) return;
  try {
    markScenarioCompleted(scenarioId, Date.now());
  } catch {
    // Storage full or blocked: the win simply is not remembered.
  }
}

function advanceRideSetup(snapshot: NonNullable<typeof sim.latest>): void {
  if (pendingRideCreation && snapshot.rides.count > pendingRideCreation.rideIds.length) {
    const created = rideRow(
      snapshot,
      pendingRideCreation.rideType,
      undefined,
      pendingRideCreation.rideIds,
    );
    pendingRideCreation = null;
    if (created !== null) {
      const type = snapshot.rideInfo[created * RIDE_INFO_STRIDE + RideInfo.Type];
      const def = RIDE_CATALOG[type as keyof typeof RIDE_CATALOG];
      if (!def?.usesTrack) {
        const rideId = snapshot.rideInfo[created * RIDE_INFO_STRIDE + RideInfo.Id];
        if (def.category === 'stall' || def.category === 'facility') {
          const front = findStallFront(snapshot, created, def.footprint);
          if (front) {
            ridePlacement = { rideId, part: 'entrance' };
            stallFrontTile = [front.entrance.x, front.entrance.y];
            openingStallRideId = rideId;
            ridePlacementCommandPending = true;
            sim.command({ type: 'placeRideEntrance', rideId, ...front.entrance });
            gameUi.setToolStatus(`${def.name} front faces the path; opening…`);
          } else {
            ridePlacement = { rideId, part: 'entrance' };
            ridePlacementCommandPending = false;
            gameUi.selectTool('ride');
            gameUi.setToolStatus(`Place ${def.name.toLowerCase()} entrance facing a path.`);
          }
        } else {
          ridePlacement = { rideId, part: 'entrance' };
          ridePlacementCommandPending = false;
          gameUi.selectTool('ride');
          gameUi.setToolStatus(`Place entrance next to ${def.name}.`);
        }
      }
    }
  }

  if (!ridePlacement) return;
  const row = rideRow(snapshot, undefined, ridePlacement.rideId);
  if (row === null) return;
  const offset = row * RIDE_INFO_STRIDE;
  const type = snapshot.rideInfo[offset + RideInfo.Type];
  const def = RIDE_CATALOG[type as keyof typeof RIDE_CATALOG];
  const flags = snapshot.rideInfo[offset + RideInfo.Flags];
  if (ridePlacementCommandPending && snapshot.feedback.seq !== ridePlacementFeedbackSeq)
    ridePlacementCommandPending = false;
  if (ridePlacement.part === 'entrance' && flags & RideFlag.EntrancePlaced) {
    ridePlacementCommandPending = false;
    if (openingStallRideId === ridePlacement.rideId) {
      sim.command({ type: 'setRideStatus', rideId: ridePlacement.rideId, status: 'open' });
      openingStallRideId = null;
      ridePlacement = null;
      stallFrontTile = null;
      rideSetupNotice = `${def?.name ?? 'Stall'} is open.`;
      gameUi.setToolStatus(rideSetupNotice);
    } else if (def?.category === 'stall' || def?.category === 'facility') {
      sim.command({ type: 'setRideStatus', rideId: ridePlacement.rideId, status: 'open' });
      gameUi.openRide(ridePlacement.rideId);
      ridePlacement = null;
      gameUi.setToolStatus(`${def.name} entrance placed.`);
    } else {
      ridePlacement = { rideId: ridePlacement.rideId, part: 'exit' };
      gameUi.setToolStatus('Place exit next to the ride.');
    }
  } else if (ridePlacement.part === 'exit' && flags & RideFlag.ExitPlaced) {
    gameUi.openRide(ridePlacement.rideId);
    ridePlacement = null;
    ridePlacementCommandPending = false;
    rideSetupNotice = 'Ride setup complete. Test the ride before opening it.';
    gameUi.setToolStatus(rideSetupNotice);
  } else if (!ridePlacementCommandPending) {
    gameUi.setToolStatus(`Place ${ridePlacement.part} next to the ride.`);
  }
}

function rideRow(
  snapshot: NonNullable<typeof sim.latest>,
  type?: number,
  rideId?: number,
  excludedRideIds: readonly number[] = [],
): number | null {
  for (let index = 0; index < snapshot.rides.count; index++) {
    const offset = index * RIDE_INFO_STRIDE;
    if (
      (type === undefined || snapshot.rideInfo[offset + RideInfo.Type] === type) &&
      (rideId === undefined || snapshot.rideInfo[offset + RideInfo.Id] === rideId) &&
      !excludedRideIds.includes(snapshot.rideInfo[offset + RideInfo.Id]!)
    )
      return index;
  }
  return null;
}

function findStallFront(
  snapshot: NonNullable<typeof sim.latest>,
  row: number,
  footprint: readonly (readonly [number, number])[],
): { entrance: { x: number; y: number } } | null {
  const offset = row * RIDE_INFO_STRIDE;
  const x = snapshot.rideInfo[offset + RideInfo.RideX];
  const y = snapshot.rideInfo[offset + RideInfo.RideY];
  const map = sim.map;
  if (!map) return null;
  const directions = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const;
  for (const [dx, dy] of directions) {
    for (const [fx, fy] of footprint) {
      const entrance = { x: x + fx + dx, y: y + fy + dy };
      const pathX = entrance.x + dx;
      const pathY = entrance.y + dy;
      if (
        entrance.x >= 0 &&
        entrance.y >= 0 &&
        entrance.x < map.width &&
        entrance.y < map.height &&
        map.surface[entrance.y * map.width + entrance.x] === Surface.Path
      )
        return { entrance };
      if (
        pathX >= 0 &&
        pathY >= 0 &&
        pathX < map.width &&
        pathY < map.height &&
        map.surface[pathY * map.width + pathX] === Surface.Path
      )
        return { entrance };
    }
  }
  return null;
}

function drawRidePlacementPreview(width: number, height: number): void {
  const canvas = ridePlacementPreview;
  const ratio = capDevicePixelRatio(window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const snapshot = sim.latest;
  const map = sim.map;
  ridePlacementTargets.setAttribute('viewBox', `0 0 ${width} ${height}`);
  ridePlacementTargets.setAttribute('width', String(width));
  ridePlacementTargets.setAttribute('height', String(height));
  const placement =
    ridePlacement ?? (selectedTool === 'track' ? coasterPanel.boardingPlacement() : null);
  if ((!placement && !stallFrontTile) || !snapshot || !map) {
    if (ridePlacementTargetSignature) {
      ridePlacementTargets.replaceChildren();
      ridePlacementTargetSignature = '';
    }
    return;
  }
  const targetNodes: SVGPolygonElement[] = [];
  const allCandidates: { x: number; y: number }[] = [];
  if (placement) {
    const row = rideRow(snapshot, undefined, placement.rideId);
    if (row !== null) {
      const offset = row * RIDE_INFO_STRIDE;
      const x = snapshot.rideInfo[offset + RideInfo.RideX];
      const y = snapshot.rideInfo[offset + RideInfo.RideY];
      const def =
        RIDE_CATALOG[snapshot.rideInfo[offset + RideInfo.Type] as keyof typeof RIDE_CATALOG];
      const boardingCells: [number, number][] = [];
      if (def?.usesTrack) {
        const rideId = snapshot.rideInfo[offset + RideInfo.Id];
        for (let trackIndex = 0; trackIndex < snapshot.tracks.count; trackIndex++) {
          const trackOffset = trackIndex * 4;
          const packed = snapshot.tracks.data[trackOffset + 3];
          if (packed >>> 16 !== rideId) continue;
          const piece = PIECES[packed & 0xff];
          if (!piece || !(piece.flags & PieceFlag.Station)) continue;
          const trackX = Math.floor(snapshot.tracks.data[trackOffset] / 256);
          const trackY = Math.floor(snapshot.tracks.data[trackOffset + 1] / 256);
          const direction = (packed >>> 8) & 0xff;
          for (const cell of piece.footprint) {
            const [rx, ry] = rotateTile(cell.i, cell.j, direction);
            boardingCells.push([trackX + rx, trackY + ry]);
          }
        }
      }
      if (boardingCells.length === 0)
        boardingCells.push(
          ...(def?.footprint ?? [[0, 0]]).map(([fx, fy]) => [x + fx, y + fy] as [number, number]),
        );
      for (const [cellX, cellY] of boardingCells) {
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ]) {
          const candidate = { x: cellX + dx, y: cellY + dy };
          if (!allCandidates.some((cell) => cell.x === candidate.x && cell.y === candidate.y))
            allCandidates.push(candidate);
        }
      }
    }
  }
  if (
    stallFrontTile &&
    !allCandidates.some((cell) => cell.x === stallFrontTile?.[0] && cell.y === stallFrontTile?.[1])
  )
    allCandidates.push({ x: stallFrontTile[0], y: stallFrontTile[1] });
  const point = new Float64Array(2);
  for (const candidate of allCandidates) {
    if (candidate.x < 0 || candidate.y < 0 || candidate.x >= map.width || candidate.y >= map.height)
      continue;
    const index = candidate.y * map.width + candidate.x;
    let occupiedByTrack = false;
    for (let trackIndex = 0; trackIndex < snapshot.tracks.count && !occupiedByTrack; trackIndex++) {
      const offset = trackIndex * 4;
      const packed = snapshot.tracks.data[offset + 3];
      const piece = PIECES[packed & 0xff];
      if (!piece) continue;
      const trackX = Math.floor(snapshot.tracks.data[offset] / 256);
      const trackY = Math.floor(snapshot.tracks.data[offset + 1] / 256);
      const trackZ = Math.floor(snapshot.tracks.data[offset + 2] / 256);
      const direction = (packed >>> 8) & 0xff;
      occupiedByTrack = piece.footprint.some((cell) => {
        const [rx, ry] = rotateTile(cell.i, cell.j, direction);
        return (
          trackX + rx === candidate.x &&
          trackY + ry === candidate.y &&
          trackZ * Z_STEP + cell.zMin <= (map.heights[index] + 2) * Z_STEP
        );
      });
    }
    const row = placement ? rideRow(snapshot, undefined, placement.rideId) : null;
    const infoOffset = row === null ? -1 : row * RIDE_INFO_STRIDE;
    const flags = row === null ? 0 : snapshot.rideInfo[infoOffset + RideInfo.Flags];
    const occupiedBoardingTile =
      ((flags & RideFlag.EntrancePlaced) !== 0 &&
        snapshot.rideInfo[infoOffset + RideInfo.EntranceX] === candidate.x &&
        snapshot.rideInfo[infoOffset + RideInfo.EntranceY] === candidate.y) ||
      ((flags & RideFlag.ExitPlaced) !== 0 &&
        snapshot.rideInfo[infoOffset + RideInfo.ExitX] === candidate.x &&
        snapshot.rideInfo[infoOffset + RideInfo.ExitY] === candidate.y);
    const existingPath =
      map.surface[index] === Surface.Path || map.surface[index] === Surface.Queue;
    const valid =
      snapshot.buildable[index] !== 0 &&
      (existingPath ||
        (map.surface[index] !== Surface.Water &&
          map.slope[index] === 0 &&
          (map.waterLevel?.[index] ?? 0) <= map.heights[index])) &&
      !occupiedByTrack &&
      !occupiedBoardingTile;
    context.fillStyle = valid ? 'rgba(70, 225, 115, .48)' : 'rgba(230, 70, 65, .46)';
    context.strokeStyle = 'rgba(255,255,220,.9)';
    context.lineWidth = 1.5;
    context.beginPath();
    const points: string[] = [];
    for (const [dx, dy, first] of [
      [0, 0, true],
      [1, 0, false],
      [1, 1, false],
      [0, 1, false],
    ] as const) {
      project(
        (candidate.x + dx) * TILE_UNITS,
        (candidate.y + dy) * TILE_UNITS,
        (map.heights[index] ?? 0) * Z_STEP,
        map.width,
        map.height,
        camera.rotation as Rotation,
        point,
      );
      const px = width / 2 + (point[0] - camera.x) * camera.zoom;
      const py = height / 2 + (point[1] - camera.y) * camera.zoom;
      points.push(`${px},${py}`);
      if (first) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
    context.fill();
    context.stroke();
    if (valid && placement) {
      const target = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      target.classList.add('ride-placement-target');
      target.setAttribute('points', points.join(' '));
      target.setAttribute('role', 'button');
      target.setAttribute('tabindex', '0');
      target.setAttribute(
        'aria-label',
        `Place ${placement.part} at tile ${candidate.x}, ${candidate.y}`,
      );
      const place = () => {
        if (selectedTool === 'track') {
          gameUi.setToolStatus(coasterPanel.handleTileClick(candidate.x, candidate.y));
        } else if (ridePlacement && !ridePlacementCommandPending) {
          sim.command({
            type: ridePlacement.part === 'entrance' ? 'placeRideEntrance' : 'placeRideExit',
            rideId: ridePlacement.rideId,
            x: candidate.x,
            y: candidate.y,
          });
          ridePlacementCommandPending = true;
          ridePlacementFeedbackSeq = snapshot.feedback.seq;
          gameUi.setToolStatus(`Placing ${ridePlacement.part} at ${candidate.x}, ${candidate.y}…`);
        }
      };
      target.addEventListener('click', place);
      target.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          place();
        }
      });
      targetNodes.push(target);
    }
  }
  const signature = targetNodes
    .map((target) => `${target.getAttribute('aria-label')}:${target.getAttribute('points')}`)
    .join('|');
  if (signature !== ridePlacementTargetSignature) {
    ridePlacementTargets.replaceChildren(...targetNodes);
    ridePlacementTargetSignature = signature;
  }
  canvas.classList.toggle('ride-stall-front-preview', stallFrontTile !== null);
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
    if (latest.scenario.status === ScenarioStatus.Won && !session.winRecorded) {
      session.winRecorded = true;
      recordScenarioWin(session.scenarioId);
    }
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
  camera.showGridlines = localStorage.getItem('opencoaster-option-gridlines') === 'true';
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
  if (latest) advanceRideSetup(latest);
  if (rideSetupNotice) gameUi.setToolStatus(rideSetupNotice);
  const rect = canvas.getBoundingClientRect();
  if (sim.latest && sim.map) {
    audio.update(
      sim.latest,
      {
        width: rect.width,
        height: rect.height,
        mapWidth: sim.map.width,
        mapHeight: sim.map.height,
      },
      camera,
    );
  }
  coasterPanel.update();
  const rideGhost: RidePlacementGhost | null =
    selectedTool === 'ride' && !ridePlacement && rideHover && sim.map && latest
      ? {
          type: coasterPanel.rideType,
          x: rideHover[0],
          y: rideHover[1],
          facing: facilityFacingFromPaths(rideHover[0], rideHover[1], sim.map),
          valid: ridePlacementValid(
            coasterPanel.rideType,
            rideHover[0],
            rideHover[1],
            sim.map,
            latest,
          ),
          tick: latest.tick,
        }
      : null;
  trackPreview.draw(
    sim.map ? coasterPanel.ghost() : null,
    sim.map ?? { width: 0, height: 0 },
    camera,
    { width: rect.width, height: rect.height },
    capDevicePixelRatio(window.devicePixelRatio || 1),
    rideGhost,
  );
  drawRidePlacementPreview(rect.width, rect.height);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => {
  gameUi.dispose();
  audio.dispose();
  coasterPanel.dispose();
  trackPreview.dispose();
  renderer.dispose();
});

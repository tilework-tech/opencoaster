import { SimClient } from '../../worker/sim-client';
import { createRenderer } from '../../render/create-renderer';
import type { Camera } from '../../render/renderer';
import { project } from '../../render/projection';
import type { Rotation } from '../../render/projection';
import { Hud } from '../../ui/hud';
import { GameUI } from '../../ui/game-ui';
import type { GuestSelection, ToolMode } from '../../ui/game-ui';
import { WindowManager } from '../../ui/window-manager';
import { DEFAULT_ZOOM, stepZoom } from '../../ui/zoom';
import '../../ui/ui.css';
import { TitleScreen } from '../../ui/title-screen';
import { SaveMenu } from '../../ui/save-menu';
import { ScenarioDialog } from '../../ui/scenario-dialog';
import { loadSettings } from '../../ui/settings';
import type { GameSpeed } from '../../ui/settings';
import { DEFAULT_MAP_SIZE, TILE_UNITS, Z_STEP } from '../../sim/core/constants';
import { PathFlag, PathStyle } from '../../sim/map/tile-map';
import { SceneryItem } from '../../sim/map/scenery';
import { CoasterPanel } from '../../ui/coaster-panel';
import { TrackPreviewOverlay } from '../../ui/track-preview';
import { SCENARIOS } from '../../sim/scenario/catalog';
import { ScenarioStatus } from '../../sim/scenario/scenario';
import { createSaveLoadController, openSlotStore, readScenarioProgress } from '../save-load';
import { registerPwa } from '../../pwa/register';
import { capDevicePixelRatio } from '../../input/camera-controls';
import { centreOnTile, connectCameraInput } from '../input';
import { AudioEngine } from '../../audio/audio';
import { createToolController } from '../tools';
import { createRideSetup } from '../ride-setup';

export async function bootstrap(): Promise<void> {
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

  const settings = loadSettings();
  const audio = new AudioEngine(settings);
  document.addEventListener('pointerdown', () => void audio.unlock().catch(() => undefined), true);
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (
      !(target instanceof Element) ||
      !target.closest('button, [role="button"], input, select, a')
    )
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
  sim.setSpeed(speed);

  const camera: Camera = { x: 0, y: (DEFAULT_MAP_SIZE * 32) / 2, zoom: DEFAULT_ZOOM, rotation: 0 };
  if (import.meta.env.DEV) (window as unknown as { __camera: Camera }).__camera = camera;
  const hud = new Hud(root);
  let selectedTool: ToolMode = 'select';
  let selectedGuest: GuestSelection | null = null;
  let rideHover: [number, number] | null = null;
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
  const rideSetupState: { current: ReturnType<typeof createRideSetup> } = {
    current: undefined!,
  };
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
      centreOnTile(x, y, sim, camera);
    },
    chooseRideType(type) {
      rideSetupState.current.chooseRideType(type);
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
      rideSetupState.current?.clearNotice();
      coasterPanel.setTool(tool);
    },
    spawnGuests() {
      sim.command({ type: 'spawnGuests', count: 1000 });
    },
    openMenu() {
      saveLoad.openSaveMenu();
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
      rideSetupState.current.placeRidePart(rideId, part);
    },
  });
  gameUi.syncPaused(userPaused);
  gameUi.syncSpeed(speed);

  rideSetupState.current = createRideSetup({
    sim,
    gameUi,
    coasterPanel,
    camera,
    selectedTool: () => selectedTool,
    preview: ridePlacementPreview,
    targets: ridePlacementTargets,
    setRideHover: (tile) => (rideHover = tile),
  });

  const outcomeDialog = new ScenarioDialog(root);
  const outcomeActions = {
    keepPlaying() {
      outcomeDialog.hide();
      syncPause();
    },
    openMenu() {
      outcomeDialog.hide();
      saveLoad.openSaveMenu();
    },
    backToTitle() {
      saveLoad.goToTitle();
    },
  };

  const titleScreen = new TitleScreen(
    root,
    SCENARIOS,
    slots,
    {
      newGame: (def) => saveLoad.startNewGame(def),
      sandbox: () => saveLoad.startSandbox(),
      loadSlot: (slot) => void saveLoad.loadSlotFromTitle(slot),
      importFile: (file) => void saveLoad.importFromTitle(file),
    },
    readScenarioProgress,
  );

  const saveMenu = new SaveMenu(root, slots, {
    save: (id, name) => saveLoad.recordSave(id, name),
    load: (slot) => saveLoad.loadSave(slot),
    remove: (slot) => saveLoad.removeSave(slot),
    exportFile: () => saveLoad.exportSave(),
    importFile: (file) => saveLoad.importSave(file),
    backToTitle: () => saveLoad.goToTitle(),
  });

  const saveLoad = createSaveLoadController({
    root,
    sim,
    slots,
    settings,
    getSpeed: () => speed,
    getUserPaused: () => userPaused,
    gameUi,
    clearGuestSelection: () => (selectedGuest = null),
    audio,
    titleScreen,
    saveMenu,
    outcomeDialog,
    syncPause: () => syncPause(),
  });

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

  function persistSettings(): void {
    saveLoad.persistSettings();
  }

  root.classList.add('title-open');
  titleScreen.show();
  if (storeNote) titleScreen.showError(storeNote);

  const toolController = createToolController({
    canvas,
    sim,
    camera,
    gameUi,
    coasterPanel,
    selectedTool: () => selectedTool,
    selectedGuest: () => selectedGuest,
    setSelectedGuest: (guest) => (selectedGuest = guest),
    alternate: () => alternate,
    brush: () => brush,
    pathOptions: () => ({ queue: pathQueue, slope: pathSlope }),
    pathStyle: () => pathStyle,
    sceneryItem: () => sceneryItem,
    patrolKind: () => patrolKind,
    clearRideSetupNotice: rideSetupState.current.clearNotice,
    rideTileClick: rideSetupState.current.rideTileClick,
  });

  const keys = connectCameraInput({
    canvas,
    renderer,
    sim,
    camera,
    gameUi,
    coasterPanel,
    selectedTool: () => selectedTool,
    gameActive: () => saveLoad.current() !== null,
    overlayOpen,
    setHiddenPaused: (value) => (hiddenPaused = value),
    syncPause,
    handleCanvasClick: toolController.handleCanvasClick,
    removePathAt: toolController.removePathAt,
    setRideHover: (tile) => (rideHover = tile),
  });

  let last = performance.now();
  let fps = 60;
  let renderMs = 0;
  function drawPatrolOverlay(): void {
    if (
      !saveLoad.current() ||
      selectedTool !== 'patrol' ||
      patrolKind === null ||
      !sim.map ||
      !sim.latest
    ) {
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
    const session = saveLoad.current();
    if (session && latest) {
      if (latest.scenario.status === ScenarioStatus.Won && !session.winRecorded) {
        session.winRecorded = true;
        saveLoad.recordScenarioWin(session.scenarioId);
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
    if (latest) rideSetupState.current.advance(latest);
    const rideNotice = rideSetupState.current.notice();
    if (rideNotice) gameUi.setToolStatus(rideNotice);
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
    const rideGhost =
      selectedTool === 'ride' &&
      !rideSetupState.current.hasPlacement() &&
      rideHover &&
      sim.map &&
      latest
        ? rideSetupState.current.createRideGhost(rideHover[0], rideHover[1], latest.tick)
        : null;
    trackPreview.draw(
      sim.map ? coasterPanel.ghost() : null,
      sim.map ?? { width: 0, height: 0 },
      camera,
      { width: rect.width, height: rect.height },
      capDevicePixelRatio(window.devicePixelRatio || 1),
      rideGhost,
    );
    rideSetupState.current.drawPreview(rect.width, rect.height);
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
}

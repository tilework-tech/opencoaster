import { SimClient } from '../../worker/sim-client';
import { createRenderer } from '../../render/create-renderer';
import type { Camera } from '../../render/renderer';
import { project } from '../../render/projection';
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
import { PathFlag } from '../../sim/map/tile-map';
import { SceneryItem } from '../../sim/map/scenery';
import { CoasterPanel } from '../../ui/coaster-panel';
import { rideGhostSprites, TrackPreviewOverlay } from '../../ui/track-preview';
import type { SpriteGhost } from '../../render/renderer';
import { ScenerySpotPreview } from '../tools/scenery-preview';
import type { PlacementHover } from '../input';
import { SCENARIOS } from '../../sim/scenario/catalog';
import { ScenarioStatus } from '../../sim/scenario/scenario';
import { createSaveLoadController, openSlotStore, readScenarioProgress } from '../save-load';
import { registerPwa } from '../../pwa/register';
import { capDevicePixelRatio, rotateCameraAtCenter } from '../../input/camera-controls';
import { centreOnTile, connectCameraInput } from '../input';
import { AudioEngine } from '../../audio/audio';
import { createToolController } from '../tools';
import { BuildHoverFeedback, buildHoverGhost } from '../tools/build-hover-feedback';
import { PathFeedback } from '../tools/path-feedback';
import { PathTool } from '../tools/path/controller';
import { LandController } from '../tools/land-controller';
import { createPathState } from '../tools/path/state';
import { createRideSetup } from '../ride-setup';
import { AdaptiveResolution } from '../../render/adaptive-resolution';
import { scenarioOpeningPosition } from './opening-camera';

export async function bootstrap(): Promise<void> {
  const root = document.getElementById('app') as HTMLElement;
  const selection = createRenderer(document.getElementById('game') as HTMLCanvasElement);
  const canvas = selection.canvas;
  const renderer = selection.renderer;
  registerPwa();

  const sim = new SimClient();
  sim.onMap = (map, newGame) => {
    renderer.setMap(map);
    if (import.meta.env.DEV) (window as unknown as { __map?: typeof map }).__map = map;
    if (!newGame) return;
    [camera.x, camera.y] = scenarioOpeningPosition(map, camera.rotation);
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
  let placementHover: PlacementHover | null = null;
  let buildHoverTile: [number, number] | null = null;
  let sceneryRotation = 0;
  let patrolKind: number | null = null;
  let alternate = false;
  const pathState = createPathState();
  let sceneryItem = SceneryItem.OakTree;
  const landHolder: { controller?: LandController } = {};
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
  const scenerySpot = new ScenerySpotPreview(root, sim);
  const pathFeedback = new PathFeedback(root);
  const pathTool = new PathTool({
    sim,
    state: pathState,
    camera,
    renderer,
    canvas,
    overlay: root,
    setStatus: (text) => gameUi.setToolStatus(text),
  });
  const buildHoverFeedback = new BuildHoverFeedback(root);
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
      rotateCameraAtCenter(camera, sim.map, direction, viewport, sim.latest ?? undefined);
    },
    rotateConstruction() {
      return rideSetupState.current.rotatePlacement();
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
    setLand(settings) {
      landHolder.controller?.configure(settings);
    },
    footpath: pathTool,
    setSceneryItem(item) {
      sceneryItem = item as SceneryItem;
    },
    rotatePiece() {
      if (rideSetupState.current.rotatePlacement()) return;
      sceneryRotation = (sceneryRotation + 1) % 4;
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
    demolishRide(rideId) {
      sim.command({ type: 'demolishRide', rideId });
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
    setPlacementHover: (hover) => (placementHover = hover),
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

  const viewport = { width: 0, height: 0 };
  const landController = new LandController({
    parent: root,
    canvas,
    sim,
    camera,
    gameUi,
    viewport,
    active: () => selectedTool === 'land',
    paused: () => userPaused || hiddenPaused,
  });
  landHolder.controller = landController;
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
    land: landController,
    pathFeedback,
    pathTool,
    sceneryItem: () => sceneryItem,
    sceneryRotation: () => sceneryRotation,
    patrolKind: () => patrolKind,
    clearRideSetupNotice: rideSetupState.current.clearNotice,
    rideTileClick: rideSetupState.current.rideTileClick,
  });

  const resolution = new AdaptiveResolution();
  let appliedScale = resolution.scale;
  let resizeCanvas: () => void = () => undefined;
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
    pathDrag: toolController.pathDrag,
    land: landController,
    setPlacementHover: (hover) => (placementHover = hover),
    setBuildHover: (tile, x, y) => {
      buildHoverTile = tile;
      buildHoverFeedback.pointAt(x, y);
    },
    viewport,
    renderScale: () => appliedScale,
    registerResize: (resize) => (resizeCanvas = resize),
  });

  /** Minimum time between HUD text writes; keeps DOM churn off the frame path. */
  const HUD_INTERVAL_MS = 50;
  /** Minimum time between panel refreshes; direct user actions refresh their panel immediately. */
  const PANEL_INTERVAL_MS = 100;
  /** Smallest change in the display-rate estimate worth telling the worker about. */
  const SNAPSHOT_INTERVAL_STEP_MS = 4;

  let last = performance.now();
  let fps = 60;
  let frameEmaMs = 1000 / 60;
  let renderMs = 0;
  let lastHud = -Infinity;
  let lastPanel = -Infinity;
  let requestedSnapshotMs = 0;

  function refreshPanels(now: number): void {
    if (now - lastPanel < PANEL_INTERVAL_MS) return;
    lastPanel = now;
    gameUi.update(sim.latest, sim.stats, selectedGuest);
    coasterPanel.update();
  }

  /** Asks the worker for snapshots no faster than frames are being drawn. */
  function syncSnapshotRate(): void {
    const wanted = Math.max(0, Math.min(100, Math.round(frameEmaMs - 2)));
    if (Math.abs(wanted - requestedSnapshotMs) < SNAPSHOT_INTERVAL_STEP_MS) return;
    requestedSnapshotMs = wanted;
    sim.setSnapshotInterval(wanted);
  }

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
    const rect = viewport;
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
    frameEmaMs = frameEmaMs * 0.95 + Math.min(dt, 100) * 0.05;
    resolution.record(dt);
    if (resolution.scale !== appliedScale) {
      appliedScale = resolution.scale;
      resizeCanvas();
    }
    syncSnapshotRate();
    const pan = (0.6 * dt) / camera.zoom;
    if (keys.has('a')) camera.x -= pan;
    if (keys.has('d')) camera.x += pan;
    if (keys.has('w')) camera.y -= pan;
    if (keys.has('s')) camera.y += pan;
    const latest = sim.latest;
    if (import.meta.env.DEV)
      (window as unknown as { __snapshot?: typeof latest }).__snapshot = latest;
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
    if (now - lastHud >= HUD_INTERVAL_MS) {
      lastHud = now;
      gameUi.syncRotation(camera.rotation);
      hud.update(
        sim.stats,
        fps,
        camera.rotation,
        renderMs,
        renderer.visibleSpriteCount,
        renderer.backend,
      );
    }
    refreshPanels(now);
    if (latest) rideSetupState.current.advance(latest);
    const rideNotice = rideSetupState.current.notice();
    if (rideNotice) gameUi.setToolStatus(rideNotice);
    if (sim.latest && sim.map) {
      audio.update(
        sim.latest,
        {
          width: viewport.width,
          height: viewport.height,
          mapWidth: sim.map.width,
          mapHeight: sim.map.height,
        },
        camera,
      );
    }
    coasterPanel.update();
    const spriteGhosts: SpriteGhost[] = [];
    const rideGhost =
      selectedTool === 'ride' &&
      !rideSetupState.current.hasPlacement() &&
      placementHover &&
      sim.map &&
      latest
        ? rideSetupState.current.createRideGhost(placementHover.tile[0], placementHover.tile[1])
        : null;
    if (rideGhost && sim.map)
      spriteGhosts.push(...rideGhostSprites(rideGhost, sim.map, camera.rotation));
    if (selectedTool === 'scenery' && placementHover && sim.map) {
      const [x, y] = placementHover.tile;
      const sceneryGhost = scenerySpot.update(
        {
          x,
          y,
          level: sim.map.heights[y * sim.map.width + x] ?? 0,
          item: sceneryItem,
          rotation: sceneryRotation,
          clientX: placementHover.clientX,
          clientY: placementHover.clientY,
        },
        now,
      );
      if (sceneryGhost) spriteGhosts.push(sceneryGhost);
    } else {
      scenerySpot.hide();
    }
    renderer.setSpriteGhosts(spriteGhosts);
    const pathGhost =
      latest && sim.map ? pathFeedback.update(latest.feedback, sim.map.width, now) : null;
    const hoverGhost =
      latest && sim.map
        ? buildHoverGhost(
            selectedTool,
            buildHoverTile,
            sim.map.width,
            sim.map.height,
            latest.buildable,
          )
        : null;
    pathFeedback.setOwnershipWarning(hoverGhost !== null);
    buildHoverFeedback.update(hoverGhost);
    trackPreview.draw(
      sim.map ? coasterPanel.ghost() : null,
      sim.map ?? { width: 0, height: 0 },
      camera,
      viewport,
      capDevicePixelRatio(window.devicePixelRatio || 1) * appliedScale,
      pathGhost ?? hoverGhost,
    );
    landController.update(now);
    rideSetupState.current.drawPreview(viewport.width, viewport.height);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('beforeunload', () => {
    gameUi.dispose();
    audio.dispose();
    coasterPanel.dispose();
    trackPreview.dispose();
    scenerySpot.dispose();
    pathFeedback.dispose();
    landController.dispose();
    buildHoverFeedback.dispose();
    renderer.dispose();
  });
}

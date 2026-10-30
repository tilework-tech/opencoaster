import type { Camera } from '../../render/renderer';
import { project } from '../../render/projection';
import type { Rotation } from '../../render/projection';
import type { GameUI, ToolMode } from '../../ui/game-ui';
import type { RidePlacementGhost } from '../../ui/track-preview';
import type { PlacementHover } from '../input';
import type { CoasterPanel } from '../../ui/coaster-panel';
import { ridePlacementLevel, ridePlacementValid } from '../../render/placement-art';
import { RIDE_CATALOG, RideType } from '../../sim/rides/ride-types';
import {
  DEFAULT_TOWER_HEIGHT,
  MAX_TOWER_HEIGHT,
  MIN_TOWER_HEIGHT,
  observationTowerCost,
} from '../../sim/rides/observation-tower';
import { formatMoney } from '../../ui/format';
import { FeedbackDomain } from '../../sim/core/feedback';
import { rideFootprintTiles } from '../../sim/rides/ride-footprint';
import { DIR_DX, DIR_DY, Surface } from '../../sim/map/tile-map';
import { RIDE_INFO_STRIDE, RideFlag, RideInfo } from '../../worker/snapshot';
import type { SimClient } from '../../worker/sim-client';
import { PIECES } from '../../sim/track/catalog';
import { PieceFlag } from '../../sim/track/track-types';
import { rotateTile } from '../../sim/track/construction';
import { TILE_UNITS, Z_STEP } from '../../sim/core/constants';
import { capDevicePixelRatio } from '../../input/camera-controls';
import { feedbackMessage } from '../../ui/track-tool';
import { isShopCategory } from '../../sim/rides/ride-operations';
import { RideResult } from '../../sim/rides/ride-results';
import {
  autoStallFacing,
  stallFloorLevel,
  stallFrontProblemInMap,
  stallFrontTile,
} from '../../sim/rides/stall-front';
import type { FootpathControls } from '../../ui/ui-types';

interface RidePlacement {
  rideId: number;
  part: 'entrance' | 'exit';
}

interface StallGhost {
  x: number;
  y: number;
  /** Direction the window faces: 0 = +x, 1 = +y, 2 = -x, 3 = -y. */
  facing: number;
  /** Height level of the stall floor. */
  floor: number;
  /** `RideResult` for what the window finds in front; `Ok` when guests could buy there. */
  problem: number;
  /** Whether the stall itself may be built on the tile. */
  buildable: boolean;
}

interface PendingRideCreation {
  rideIds: number[];
  rideType: number;
}

export interface RideSetupDependencies {
  sim: SimClient;
  gameUi: GameUI;
  coasterPanel: CoasterPanel;
  camera: Camera;
  selectedTool: () => ToolMode;
  preview: HTMLCanvasElement;
  targets: SVGSVGElement;
  setPlacementHover: (hover: PlacementHover | null) => void;
  footpath: FootpathControls;
}

const QUEUE_PROMPT =
  'Build the queue: drag from the highlighted entrance out to a path. Guests only line up once the queue reaches a path.';

export function createRideSetup(deps: RideSetupDependencies) {
  const { sim, gameUi, coasterPanel, camera } = deps;
  const ridePlacementPreview = deps.preview;
  const ridePlacementTargets = deps.targets;
  let ridePlacement: RidePlacement | null = null;
  let ridePlacementCommandPending = false;
  let ridePlacementFeedbackSeq = -1;
  let ridePlacementFeedbackMessage: string | null = null;
  let pendingRideCreation: PendingRideCreation | null = null;
  /** The stall just built, whose front stays highlighted until the player moves on. */
  let builtStallRideId: number | null = null;
  /** Tile of the stall just built; hovering it keeps showing what was built rather than a new preview. */
  let builtStallTile: string | null = null;
  /** The stall preview under the cursor this frame: where its window looks and what it finds there. */
  let stallGhost: StallGhost | null = null;
  /** Whether `stallGhost` was measured for the frame being drawn. */
  let stallGhostFresh = false;
  let stallGhostSignature = '';
  /** True once the player turns the stall being placed; until then it faces a usable path itself. */
  let placementDirChosen = false;
  let rideSetupNotice: string | null = null;
  let ridePlacementTargetSignature = '';
  /** Quarter turns the ride being placed is rotated by. */
  let placementDir = 0;
  let placementTowerHeight = DEFAULT_TOWER_HEIGHT;

  const rotateButton = document.createElement('button');
  rotateButton.type = 'button';
  rotateButton.className = 'ride-rotate-button';
  rotateButton.textContent = 'Rotate ride';
  rotateButton.setAttribute('aria-label', 'Rotate ride (T)');
  rotateButton.setAttribute('aria-keyshortcuts', 'T');
  rotateButton.hidden = true;
  rotateButton.addEventListener('click', () => rotatePlacement());
  ridePlacementPreview.parentElement?.append(rotateButton);
  const towerHeightControl = document.createElement('div');
  towerHeightControl.className = 'tower-height-control';
  towerHeightControl.hidden = true;
  const lowerTower = document.createElement('button');
  lowerTower.type = 'button';
  lowerTower.className = 'ui-button';
  lowerTower.textContent = '−';
  lowerTower.setAttribute('aria-label', 'Lower tower by one section');
  const towerHeightLabel = document.createElement('span');
  const raiseTower = document.createElement('button');
  raiseTower.type = 'button';
  raiseTower.className = 'ui-button';
  raiseTower.textContent = '+';
  raiseTower.setAttribute('aria-label', 'Raise tower by one section');
  lowerTower.addEventListener('click', () => {
    placementTowerHeight = Math.max(MIN_TOWER_HEIGHT, placementTowerHeight - 1);
    gameUi.setToolStatus(`Observation Tower height: ${placementTowerHeight} levels.`);
    drawRidePlacementPreview(ridePlacementPreview.clientWidth, ridePlacementPreview.clientHeight);
  });
  raiseTower.addEventListener('click', () => {
    placementTowerHeight = Math.min(MAX_TOWER_HEIGHT, placementTowerHeight + 1);
    gameUi.setToolStatus(`Observation Tower height: ${placementTowerHeight} levels.`);
    drawRidePlacementPreview(ridePlacementPreview.clientWidth, ridePlacementPreview.clientHeight);
  });
  towerHeightControl.append(lowerTower, towerHeightLabel, raiseTower);
  ridePlacementPreview.parentElement?.append(towerHeightControl);
  /** The ride whose queue the player is being asked to build; its entrance is highlighted. */
  let queuePromptRideId: number | null = null;
  /** Snapshots left in which the prompt is shown again, after the ride feedback line has had its say. */
  let queuePromptRepeats = 0;

  function chooseRideType(type: number): void {
    coasterPanel.rideType = type;
    ridePlacement = null;
    rideHoverClear();
    ridePlacementCommandPending = false;
    ridePlacementFeedbackMessage = null;
    pendingRideCreation = null;
    rideSetupNotice = null;
    placementDir = 0;
    placementDirChosen = false;
    builtStallRideId = null;
    builtStallTile = null;
    placementTowerHeight = DEFAULT_TOWER_HEIGHT;
    gameUi.selectTool('ride');
    const def = RIDE_CATALOG[type as keyof typeof RIDE_CATALOG];
    gameUi.setToolStatus(
      isShopCategory(def.category)
        ? `${def.name} selected. Its service window faces the highlighted edge; press T or Rotate to turn it, then tap a tile you own.`
        : `${def.name} selected. Tap a tile you own to build it${
            def.footprint.length > 1 ? '; press T to rotate it' : ''
          }.`,
    );
  }

  /** Turns the ride about to be placed a quarter turn; false when nothing is being placed. */
  function rotatePlacement(): boolean {
    if (ridePlacement || deps.selectedTool() !== 'ride') return false;
    const def = RIDE_CATALOG[coasterPanel.rideType];
    const stall = isShopCategory(def.category);
    if (!stall && def.footprint.length <= 1) return false;
    if (stall && !placementDirChosen && stallGhost) placementDir = stallGhost.facing;
    placementDir = (placementDir + 1) & 3;
    placementDirChosen = true;
    stallGhostSignature = '';
    gameUi.setToolStatus(
      stall
        ? `${def.name} turned: its window faces ${screenDirectionName(placementDir)}.`
        : `${def.name} rotated.`,
    );
    return true;
  }

  /** Screen direction, in the current view, of world direction `dir` (0 = +x … 3 = -y). */
  function screenDirectionName(dir: number): string {
    const map = sim.map;
    const width = map?.width ?? 1;
    const height = map?.height ?? 1;
    const from = new Float64Array(2);
    const to = new Float64Array(2);
    const rotation = camera.rotation as Rotation;
    project(0, 0, 0, width, height, rotation, from);
    project(DIR_DX[dir]! * TILE_UNITS, DIR_DY[dir]! * TILE_UNITS, 0, width, height, rotation, to);
    return `${to[1]! < from[1]! ? 'up' : 'down'}-${to[0]! < from[0]! ? 'left' : 'right'}`;
  }

  /** Facing the stall being placed would take on (`x`, `y`) and what its window finds there. */
  function stallPlacement(x: number, y: number): StallGhost | null {
    const map = sim.map;
    const snapshot = sim.latest;
    const def = RIDE_CATALOG[coasterPanel.rideType];
    if (!map || !snapshot || !def || !isShopCategory(def.category)) return null;
    const tile = y * map.width + x;
    const floor = stallFloorLevel(map.heights[tile] ?? 0, map.slope[tile] ?? 0);
    const buildable = (tile: number) => snapshot.buildable[tile] === 1;
    const facing = placementDirChosen
      ? placementDir
      : autoStallFacing(map, x, y, floor, placementDir, buildable);
    return {
      x,
      y,
      facing,
      floor,
      problem: stallFrontProblemInMap(map, x, y, facing, floor, buildable),
      buildable: ridePlacementValid(coasterPanel.rideType, x, y, 0, map, snapshot),
    };
  }

  function rideHoverClear(): void {
    deps.setPlacementHover(null);
  }

  function placeRidePart(rideId: number, part: 'entrance' | 'exit'): void {
    ridePlacement = { rideId, part };
    ridePlacementCommandPending = false;
    ridePlacementFeedbackMessage = null;
    gameUi.selectTool('ride');
    const snapshot = sim.latest;
    const row = snapshot ? rideRow(snapshot, undefined, rideId) : null;
    const def =
      row === null
        ? undefined
        : RIDE_CATALOG[
            snapshot!.rideInfo[row * RIDE_INFO_STRIDE + RideInfo.Type] as keyof typeof RIDE_CATALOG
          ];
    gameUi.setToolStatus(
      def && isShopCategory(def.category)
        ? `Click the side the ${def.name}'s window should face.`
        : `Click a tile next to ride ${rideId} to place its ${part}.`,
    );
  }

  /** Opens Footpaths with Queue line on and highlights the ride's entrance until its queue is built. */
  function promptQueue(rideId: number): void {
    queuePromptRideId = rideId;
    ridePlacement = null;
    ridePlacementCommandPending = false;
    deps.footpath.setMode('line');
    deps.footpath.setQueue(true);
    gameUi.openWindow('paths');
    gameUi.selectTool('path');
    queuePromptRepeats = 3;
    gameUi.setToolStatus(QUEUE_PROMPT);
  }

  function advanceQueuePrompt(snapshot: NonNullable<typeof sim.latest>): void {
    if (queuePromptRideId === null) return;
    const row = rideRow(snapshot, undefined, queuePromptRideId);
    const flags = row === null ? 0 : snapshot.rideInfo[row * RIDE_INFO_STRIDE + RideInfo.Flags];
    if (row === null || deps.selectedTool() !== 'path') {
      queuePromptRideId = null;
      queuePromptRepeats = 0;
    } else if (flags & RideFlag.QueueConnected && flags & RideFlag.HasQueue) {
      queuePromptRideId = null;
      queuePromptRepeats = 0;
      gameUi.setToolStatus('Queue connected. Test the ride, then open it.');
    } else if (queuePromptRepeats > 0) {
      queuePromptRepeats--;
      gameUi.setToolStatus(QUEUE_PROMPT);
    }
  }

  function drawQueuePrompt(context: CanvasRenderingContext2D): void {
    const snapshot = sim.latest;
    const map = sim.map;
    if (queuePromptRideId === null || !snapshot || !map) return;
    const row = rideRow(snapshot, undefined, queuePromptRideId);
    if (row === null) return;
    const offset = row * RIDE_INFO_STRIDE;
    const tileX = snapshot.rideInfo[offset + RideInfo.EntranceX];
    const tileY = snapshot.rideInfo[offset + RideInfo.EntranceY];
    const index = tileY * map.width + tileX;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
    const point = new Float64Array(2);
    context.fillStyle = `rgba(255, 214, 84, ${0.25 + 0.25 * pulse})`;
    context.strokeStyle = 'rgba(255, 236, 150, .95)';
    context.lineWidth = 2.5;
    context.beginPath();
    for (const [dx, dy, first] of [
      [0, 0, true],
      [1, 0, false],
      [1, 1, false],
      [0, 1, false],
    ] as const) {
      project(
        (tileX + dx) * TILE_UNITS,
        (tileY + dy) * TILE_UNITS,
        (map.heights[index] ?? 0) * Z_STEP,
        map.width,
        map.height,
        camera.rotation as Rotation,
        point,
      );
      const px = context.canvas.clientWidth / 2 + (point[0] - camera.x) * camera.zoom;
      const py = context.canvas.clientHeight / 2 + (point[1] - camera.y) * camera.zoom;
      if (first) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
    context.fill();
    context.stroke();
  }

  function rideTileClick(x: number, y: number): void {
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
      ridePlacementFeedbackMessage = null;
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
      const stall = stallPlacement(x, y);
      gameUi.setToolStatus(
        coasterPanel.createRideAt(
          x,
          y,
          stall ? stall.facing : placementDir,
          coasterPanel.rideType === RideType.ObservationTower ? placementTowerHeight : undefined,
        ),
      );
    }
  }

  function advanceRideSetup(snapshot: NonNullable<typeof sim.latest>): void {
    advanceQueuePrompt(snapshot);
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
          if (isShopCategory(def.category)) {
            ridePlacement = null;
            ridePlacementCommandPending = false;
            gameUi.selectTool('ride');
            const offset = created * RIDE_INFO_STRIDE;
            const x = snapshot.rideInfo[offset + RideInfo.RideX];
            const y = snapshot.rideInfo[offset + RideInfo.RideY];
            const [fx, fy] = stallFrontTile(x, y, snapshot.rideInfo[offset + RideInfo.Dir]);
            const problem = snapshot.rideInfo[offset + RideInfo.StallFront];
            builtStallRideId = rideId;
            builtStallTile = `${x},${y}`;
            rideSetupNotice =
              problem === RideResult.Ok
                ? `${def.name} is open, serving from the footpath at ${fx}, ${fy}.`
                : `${def.name} is open but guests cannot reach it: ${
                    feedbackMessage(FeedbackDomain.Ride, problem).text
                  }`;
            gameUi.setToolStatus(rideSetupNotice);
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
    if (ridePlacementCommandPending && snapshot.feedback.seq !== ridePlacementFeedbackSeq) {
      ridePlacementCommandPending = false;
      if (
        snapshot.feedback.domain === FeedbackDomain.Ride &&
        snapshot.feedback.subject === ridePlacement.rideId &&
        snapshot.feedback.code !== 0
      ) {
        ridePlacementFeedbackMessage = feedbackMessage(
          FeedbackDomain.Ride,
          snapshot.feedback.code,
        ).text;
        gameUi.setToolStatus(ridePlacementFeedbackMessage);
        return;
      }
      if (def && isShopCategory(def.category)) {
        const [fx, fy] = stallFrontTile(
          snapshot.rideInfo[offset + RideInfo.RideX],
          snapshot.rideInfo[offset + RideInfo.RideY],
          snapshot.rideInfo[offset + RideInfo.Dir],
        );
        gameUi.openRide(ridePlacement.rideId);
        ridePlacement = null;
        gameUi.setToolStatus(
          `${def.name} turned: it now serves from the footpath at ${fx}, ${fy}.`,
        );
        return;
      }
    }
    if (def && isShopCategory(def.category)) {
      if (!ridePlacementCommandPending)
        gameUi.setToolStatus(
          ridePlacementFeedbackMessage ?? `Click the side the ${def.name}'s window should face.`,
        );
      return;
    }
    if (ridePlacement.part === 'entrance' && flags & RideFlag.EntrancePlaced) {
      ridePlacementCommandPending = false;
      ridePlacement = { rideId: ridePlacement.rideId, part: 'exit' };
      ridePlacementFeedbackMessage = null;
      gameUi.setToolStatus('Place exit next to the ride.');
    } else if (ridePlacement.part === 'exit' && flags & RideFlag.ExitPlaced) {
      const rideId = ridePlacement.rideId;
      gameUi.openRide(rideId);
      ridePlacement = null;
      ridePlacementFeedbackMessage = null;
      ridePlacementCommandPending = false;
      if (flags & RideFlag.QueueConnected) {
        rideSetupNotice = 'Ride setup complete. Test the ride before opening it.';
        gameUi.setToolStatus(rideSetupNotice);
      } else {
        promptQueue(rideId);
      }
    } else if (!ridePlacementCommandPending) {
      gameUi.setToolStatus(
        ridePlacementFeedbackMessage ?? `Place ${ridePlacement.part} next to the ride.`,
      );
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

  function drawRidePlacementPreview(width: number, height: number): void {
    const canvas = ridePlacementPreview;
    const ratio = capDevicePixelRatio(window.devicePixelRatio || 1);
    if (
      canvas.width !== Math.round(width * ratio) ||
      canvas.height !== Math.round(height * ratio)
    ) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    drawQueuePrompt(context);
    const snapshot = sim.latest;
    const map = sim.map;
    const selectedDef = RIDE_CATALOG[coasterPanel.rideType];
    const placingStall = isShopCategory(selectedDef.category);
    rotateButton.hidden =
      ridePlacement !== null ||
      deps.selectedTool() !== 'ride' ||
      (!placingStall && selectedDef.footprint.length <= 1);
    const rotateLabel = placingStall ? 'Rotate stall (T)' : 'Rotate ride (T)';
    if (rotateButton.getAttribute('aria-label') !== rotateLabel) {
      rotateButton.setAttribute('aria-label', rotateLabel);
      rotateButton.textContent = placingStall ? 'Rotate stall' : 'Rotate ride';
    }
    let ghost =
      deps.selectedTool() === 'ride' && !ridePlacement && stallGhostFresh ? stallGhost : null;
    if (ghost && builtStallTile !== null) {
      if (builtStallTile === `${ghost.x},${ghost.y}`) ghost = null;
      else builtStallTile = null;
    }
    stallGhostFresh = false;
    if (deps.selectedTool() !== 'ride') {
      builtStallRideId = null;
      builtStallTile = null;
    }
    let stallFrontShown = false;
    if (snapshot && map && ghost) {
      drawStallFront(
        context,
        map,
        ghost.x,
        ghost.y,
        ghost.facing,
        ghost.floor,
        ghost.buildable ? ghost.problem : RideResult.Blocked,
      );
      stallFrontShown = true;
      announceStallGhost(ghost);
    } else if (snapshot && map && builtStallRideId !== null && deps.selectedTool() === 'ride') {
      const row = rideRow(snapshot, undefined, builtStallRideId);
      if (row !== null) {
        const offset = row * RIDE_INFO_STRIDE;
        drawStallFront(
          context,
          map,
          snapshot.rideInfo[offset + RideInfo.RideX],
          snapshot.rideInfo[offset + RideInfo.RideY],
          snapshot.rideInfo[offset + RideInfo.Dir],
          stallFloorLevel(
            map.heights[
              snapshot.rideInfo[offset + RideInfo.RideY] * map.width +
                snapshot.rideInfo[offset + RideInfo.RideX]
            ] ?? 0,
            map.slope[
              snapshot.rideInfo[offset + RideInfo.RideY] * map.width +
                snapshot.rideInfo[offset + RideInfo.RideX]
            ] ?? 0,
          ),
          snapshot.rideInfo[offset + RideInfo.StallFront],
        );
        stallFrontShown = true;
      }
    }
    canvas.classList.toggle('ride-stall-front-preview', stallFrontShown);
    const selectedTower = coasterPanel.rideType === RideType.ObservationTower;
    towerHeightControl.hidden =
      !selectedTower || ridePlacement !== null || deps.selectedTool() !== 'ride';
    const towerCost = observationTowerCost(
      RIDE_CATALOG[RideType.ObservationTower].cost,
      placementTowerHeight,
    );
    towerHeightLabel.textContent = `${placementTowerHeight} levels (${MIN_TOWER_HEIGHT}–${MAX_TOWER_HEIGHT}) · ${formatMoney(towerCost)}`;
    lowerTower.disabled = placementTowerHeight <= MIN_TOWER_HEIGHT;
    raiseTower.disabled = placementTowerHeight >= MAX_TOWER_HEIGHT;
    ridePlacementTargets.setAttribute('viewBox', `0 0 ${width} ${height}`);
    ridePlacementTargets.setAttribute('width', String(width));
    ridePlacementTargets.setAttribute('height', String(height));
    const placement =
      ridePlacement ?? (deps.selectedTool() === 'track' ? coasterPanel.boardingPlacement() : null);
    if (!placement || !snapshot || !map) {
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
            ...(def
              ? rideFootprintTiles(def, x, y, snapshot.rideInfo[offset + RideInfo.Dir])
              : [[x, y] as [number, number]]),
          );
        const ownTiles = def?.usesTrack
          ? null
          : new Set(boardingCells.map(([cellX, cellY]) => `${cellX},${cellY}`));
        for (const [cellX, cellY] of boardingCells) {
          for (const [dx, dy] of [
            [1, 0],
            [0, 1],
            [-1, 0],
            [0, -1],
          ]) {
            const candidate = { x: cellX + dx, y: cellY + dy };
            if (ownTiles?.has(`${candidate.x},${candidate.y}`)) continue;
            if (!allCandidates.some((cell) => cell.x === candidate.x && cell.y === candidate.y))
              allCandidates.push(candidate);
          }
        }
      }
    }
    const occupiedRideTiles = new Set<number>();
    for (let rideIndex = 0; rideIndex < snapshot.rides.count; rideIndex++) {
      const offset = rideIndex * RIDE_INFO_STRIDE;
      const def =
        RIDE_CATALOG[snapshot.rideInfo[offset + RideInfo.Type] as keyof typeof RIDE_CATALOG];
      if (!def) continue;
      const rideX = snapshot.rideInfo[offset + RideInfo.RideX];
      const rideY = snapshot.rideInfo[offset + RideInfo.RideY];
      for (const [tileX, tileY] of rideFootprintTiles(
        def,
        rideX,
        rideY,
        snapshot.rideInfo[offset + RideInfo.Dir],
      )) {
        if (tileX >= 0 && tileY >= 0 && tileX < map.width && tileY < map.height)
          occupiedRideTiles.add(tileY * map.width + tileX);
      }
    }
    const point = new Float64Array(2);
    for (const candidate of allCandidates) {
      if (
        candidate.x < 0 ||
        candidate.y < 0 ||
        candidate.x >= map.width ||
        candidate.y >= map.height
      )
        continue;
      const index = candidate.y * map.width + candidate.x;
      let occupiedByTrack = false;
      for (
        let trackIndex = 0;
        trackIndex < snapshot.tracks.count && !occupiedByTrack;
        trackIndex++
      ) {
        const offset = trackIndex * 4;
        const packed = snapshot.tracks.data[offset + 3];
        const piece = PIECES[packed & 0xff];
        if (!piece) continue;
        const trackX = Math.floor(snapshot.tracks.data[offset] / 256);
        const trackY = Math.floor(snapshot.tracks.data[offset + 1] / 256);
        const trackZ = snapshot.tracks.data[offset + 2];
        const direction = (packed >>> 8) & 0xff;
        occupiedByTrack = piece.footprint.some((cell) => {
          const [rx, ry] = rotateTile(cell.i, cell.j, direction);
          return (
            trackX + rx === candidate.x &&
            trackY + ry === candidate.y &&
            trackZ + cell.zMin <= (map.heights[index] + 2) * Z_STEP
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
      const level = snapshot.buildable[index] !== 0;
      const dryAndLevel =
        map.surface[index] !== Surface.Water &&
        map.slope[index] === 0 &&
        (map.waterLevel?.[index] ?? 0) <= map.heights[index];
      const cutsPath =
        placement?.part === 'entrance' &&
        map.surface[index] === Surface.Path &&
        [
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ].filter(([dx, dy]) => {
          const nx = candidate.x + dx!;
          const ny = candidate.y + dy!;
          if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) return false;
          const side = map.surface[ny * map.width + nx];
          return side === Surface.Path || side === Surface.Queue;
        }).length >= 2;
      const placementDef = placement
        ? RIDE_CATALOG[snapshot.rideInfo[infoOffset + RideInfo.Type] as keyof typeof RIDE_CATALOG]
        : undefined;
      const turningStall = placementDef !== undefined && isShopCategory(placementDef.category);
      const stallProblem = turningStall
        ? stallTurnProblem(snapshot, map, infoOffset, candidate.x, candidate.y)
        : RideResult.Ok;
      const invalidReason = turningStall
        ? stallProblem === RideResult.Ok
          ? null
          : feedbackMessage(FeedbackDomain.Ride, stallProblem).text
        : !level
          ? 'You need to own the land or its construction rights.'
          : occupiedBoardingTile
            ? 'An entrance or exit is already placed here.'
            : cutsPath
              ? 'An entrance here would cut the footpath in two.'
              : occupiedByTrack
                ? 'Track occupies this tile.'
                : occupiedRideTiles.has(index)
                  ? 'Another ride occupies this tile.'
                  : !existingPath && !dryAndLevel
                    ? map.surface[index] === Surface.Water
                      ? 'This tile is under open water.'
                      : 'The ground must be level and dry.'
                    : null;
      const valid = invalidReason === null;
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
      if (placement) {
        const target = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        target.classList.add('ride-placement-target');
        target.setAttribute('points', points.join(' '));
        target.setAttribute('role', 'button');
        target.setAttribute('tabindex', '0');
        const candidateLabel = `tile ${candidate.x}, ${candidate.y}`;
        target.setAttribute(
          'aria-label',
          turningStall
            ? valid
              ? `Turn the window to face ${candidateLabel}`
              : `Window cannot face ${candidateLabel}: ${invalidReason}`
            : valid
              ? `Place ${placement.part} at ${candidateLabel}`
              : `${placement.part[0]!.toUpperCase()}${placement.part.slice(1)} unavailable at ${candidateLabel}: ${invalidReason}`,
        );
        const place = () => {
          if (!valid) {
            ridePlacementFeedbackMessage = invalidReason;
            gameUi.setToolStatus(invalidReason);
            return;
          }
          if (deps.selectedTool() === 'track') {
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
            ridePlacementFeedbackMessage = null;
            gameUi.setToolStatus(
              `Placing ${ridePlacement.part} at ${candidate.x}, ${candidate.y}…`,
            );
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
  }

  /** Why the stall at `offset` could not serve if turned toward the adjacent tile (`x`, `y`). */
  function stallTurnProblem(
    snapshot: NonNullable<typeof sim.latest>,
    map: NonNullable<typeof sim.map>,
    offset: number,
    x: number,
    y: number,
  ): RideResult {
    const rideX = snapshot.rideInfo[offset + RideInfo.RideX];
    const rideY = snapshot.rideInfo[offset + RideInfo.RideY];
    let dir = -1;
    for (let d = 0; d < 4; d++) if (rideX + DIR_DX[d]! === x && rideY + DIR_DY[d]! === y) dir = d;
    if (dir < 0) return RideResult.NotAdjacentToStation;
    const tile = rideY * map.width + rideX;
    return stallFrontProblemInMap(
      map,
      rideX,
      rideY,
      dir,
      stallFloorLevel(map.heights[tile] ?? 0, map.slope[tile] ?? 0),
      (index) => snapshot.buildable[index] === 1,
    );
  }

  /**
   * Outlines the tile in front of a stall's window and draws an arrow from the stall out through
   * its window edge: green when the window meets a usable footpath, red when it does not.
   */
  function drawStallFront(
    context: CanvasRenderingContext2D,
    map: NonNullable<typeof sim.map>,
    x: number,
    y: number,
    dir: number,
    floor: number,
    problem: number,
  ): void {
    const ok = problem === RideResult.Ok;
    const [fx, fy] = stallFrontTile(x, y, dir);
    const point = new Float64Array(2);
    const rotation = camera.rotation as Rotation;
    const screen = (wx: number, wy: number, level: number): [number, number] => {
      project(
        wx * TILE_UNITS,
        wy * TILE_UNITS,
        level * Z_STEP,
        map.width,
        map.height,
        rotation,
        point,
      );
      return [
        context.canvas.clientWidth / 2 + (point[0] - camera.x) * camera.zoom,
        context.canvas.clientHeight / 2 + (point[1] - camera.y) * camera.zoom,
      ];
    };
    const inside = fx >= 0 && fy >= 0 && fx < map.width && fy < map.height;
    if (inside) {
      const level = floor;
      context.beginPath();
      for (const [dx, dy, first] of [
        [0, 0, true],
        [1, 0, false],
        [1, 1, false],
        [0, 1, false],
      ] as const) {
        const [px, py] = screen(fx + dx, fy + dy, level);
        if (first) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.fillStyle = ok ? 'rgba(70, 225, 115, .42)' : 'rgba(230, 70, 65, .42)';
      context.strokeStyle = ok ? 'rgba(200, 255, 210, .95)' : 'rgba(255, 210, 200, .95)';
      context.lineWidth = 2;
      context.fill();
      context.stroke();
    }
    const ex = x + 0.5 + DIR_DX[dir]! * 0.5;
    const ey = y + 0.5 + DIR_DY[dir]! * 0.5;
    const sx = DIR_DY[dir]! * 0.42;
    const sy = -DIR_DX[dir]! * 0.42;
    const [e0x, e0y] = screen(ex - sx, ey - sy, floor);
    const [e1x, e1y] = screen(ex + sx, ey + sy, floor);
    const [mx, my] = screen(ex, ey, floor);
    const [tx, ty] = screen(x + 0.5 + DIR_DX[dir]! * 1.05, y + 0.5 + DIR_DY[dir]! * 1.05, floor);
    const colour = ok ? 'rgb(120, 255, 150)' : 'rgb(255, 110, 95)';
    const angle = Math.atan2(ty - my, tx - mx);
    const head = 10;
    const stroke = (lineWidth: number, style: string) => {
      context.strokeStyle = style;
      context.lineWidth = lineWidth;
      context.beginPath();
      context.moveTo(e0x, e0y);
      context.lineTo(e1x, e1y);
      context.moveTo(mx, my);
      context.lineTo(tx - Math.cos(angle) * head * 0.6, ty - Math.sin(angle) * head * 0.6);
      context.stroke();
    };
    context.lineCap = 'round';
    stroke(8, 'rgba(20, 20, 20, .85)');
    stroke(4, colour);
    context.beginPath();
    context.moveTo(tx + Math.cos(angle) * 2, ty + Math.sin(angle) * 2);
    context.lineTo(tx - Math.cos(angle - 0.55) * head, ty - Math.sin(angle - 0.55) * head);
    context.lineTo(tx - Math.cos(angle + 0.55) * head, ty - Math.sin(angle + 0.55) * head);
    context.closePath();
    context.fillStyle = colour;
    context.strokeStyle = 'rgba(20, 20, 20, .85)';
    context.lineWidth = 2;
    context.stroke();
    context.fill();
    context.lineCap = 'butt';
  }

  /** Describes the hovered stall preview in the tool status when it changes. */
  function announceStallGhost(ghost: StallGhost): void {
    const signature = `${ghost.x},${ghost.y},${ghost.facing},${ghost.problem},${ghost.buildable},${camera.rotation}`;
    if (signature === stallGhostSignature) return;
    stallGhostSignature = signature;
    const def = RIDE_CATALOG[coasterPanel.rideType];
    const [fx, fy] = stallFrontTile(ghost.x, ghost.y, ghost.facing);
    const facing = `${def.name} at ${ghost.x}, ${ghost.y}: window faces ${screenDirectionName(ghost.facing)}`;
    gameUi.setToolStatus(
      !ghost.buildable
        ? `${def.name} cannot be built at ${ghost.x}, ${ghost.y}: ${
            (sim.latest?.park.cash ?? 0) < def.cost
              ? 'not enough cash'
              : 'it needs clear, dry land you own'
          }.`
        : ghost.problem === RideResult.Ok
          ? `${facing} onto the footpath at ${fx}, ${fy}. T rotates.`
          : `${facing}. ${feedbackMessage(FeedbackDomain.Ride, ghost.problem).text}`,
    );
  }
  return {
    chooseRideType,
    rotatePlacement,
    placeRidePart,
    promptQueue,
    rideTileClick,
    clearNotice: () => (rideSetupNotice = null),
    notice: () => rideSetupNotice,
    hasPlacement: () => ridePlacement !== null,
    advance: advanceRideSetup,
    drawPreview: drawRidePlacementPreview,
    createRideGhost(x: number, y: number): RidePlacementGhost {
      const map = sim.map;
      const snapshot = sim.latest;
      if (!map || !snapshot) throw new Error('Ride placement requires a current map snapshot.');
      stallGhost = stallPlacement(x, y);
      stallGhostFresh = true;
      return {
        type: coasterPanel.rideType,
        x,
        y,
        facing: stallGhost?.facing ?? placementDir,
        dir: placementDir,
        baseLevel: ridePlacementLevel(coasterPanel.rideType, x, y, placementDir, map),
        valid: ridePlacementValid(
          coasterPanel.rideType,
          x,
          y,
          placementDir,
          map,
          snapshot,
          placementTowerHeight,
        ),
        towerHeight: placementTowerHeight,
      };
    },
  };
}

import type { Camera } from '../../render/renderer';
import { project } from '../../render/projection';
import type { Rotation } from '../../render/projection';
import type { GameUI, ToolMode } from '../../ui/game-ui';
import type { RidePlacementGhost } from '../../ui/track-preview';
import type { PlacementHover } from '../input';
import type { CoasterPanel } from '../../ui/coaster-panel';
import { ridePlacementLevel, ridePlacementValid } from '../../render/placement-art';
import { facilityFacingFromPaths } from '../../render/world-art';
import { RIDE_CATALOG } from '../../sim/rides/ride-types';
import { FeedbackDomain } from '../../sim/core/feedback';
import { rideFootprintTiles } from '../../sim/rides/ride-footprint';
import { Surface } from '../../sim/map/tile-map';
import { RIDE_INFO_STRIDE, RideFlag, RideInfo } from '../../worker/snapshot';
import type { SimClient } from '../../worker/sim-client';
import { PIECES } from '../../sim/track/catalog';
import { PieceFlag } from '../../sim/track/track-types';
import { rotateTile } from '../../sim/track/construction';
import { TILE_UNITS, Z_STEP } from '../../sim/core/constants';
import { capDevicePixelRatio } from '../../input/camera-controls';
import { feedbackMessage } from '../../ui/track-tool';

interface RidePlacement {
  rideId: number;
  part: 'entrance' | 'exit';
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
}

export function createRideSetup(deps: RideSetupDependencies) {
  const { sim, gameUi, coasterPanel, camera } = deps;
  const ridePlacementPreview = deps.preview;
  const ridePlacementTargets = deps.targets;
  let ridePlacement: RidePlacement | null = null;
  let ridePlacementCommandPending = false;
  let ridePlacementFeedbackSeq = -1;
  let ridePlacementFeedbackMessage: string | null = null;
  let pendingRideCreation: PendingRideCreation | null = null;
  let openingStallRideId: number | null = null;
  let stallFrontTile: [number, number] | null = null;
  let rideSetupNotice: string | null = null;
  let ridePlacementTargetSignature = '';
  /** Quarter turns the ride being placed is rotated by. */
  let placementDir = 0;

  const rotateButton = document.createElement('button');
  rotateButton.type = 'button';
  rotateButton.className = 'ride-rotate-button';
  rotateButton.textContent = 'Rotate ride';
  rotateButton.setAttribute('aria-label', 'Rotate ride (T)');
  rotateButton.hidden = true;
  rotateButton.addEventListener('click', () => rotatePlacement());
  ridePlacementPreview.parentElement?.append(rotateButton);

  function chooseRideType(type: number): void {
    coasterPanel.rideType = type;
    ridePlacement = null;
    rideHoverClear();
    ridePlacementCommandPending = false;
    ridePlacementFeedbackMessage = null;
    pendingRideCreation = null;
    rideSetupNotice = null;
    placementDir = 0;
    gameUi.selectTool('ride');
    const def = RIDE_CATALOG[type as keyof typeof RIDE_CATALOG];
    gameUi.setToolStatus(
      `${def.name} selected. Tap a tile you own to build it${
        def.footprint.length > 1 ? '; press T to rotate it' : ''
      }.`,
    );
  }

  /** Turns the ride about to be placed a quarter turn; false when nothing is being placed. */
  function rotatePlacement(): boolean {
    if (ridePlacement || deps.selectedTool() !== 'ride') return false;
    const def = RIDE_CATALOG[coasterPanel.rideType];
    if (def.footprint.length <= 1) return false;
    placementDir = (placementDir + 1) & 3;
    gameUi.setToolStatus(`${def.name} rotated.`);
    return true;
  }

  function rideHoverClear(): void {
    deps.setPlacementHover(null);
  }

  function placeRidePart(rideId: number, part: 'entrance' | 'exit'): void {
    ridePlacement = { rideId, part };
    ridePlacementCommandPending = false;
    ridePlacementFeedbackMessage = null;
    gameUi.selectTool('ride');
    gameUi.setToolStatus(`Click a tile next to ride ${rideId} to place its ${part}.`);
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
      gameUi.setToolStatus(coasterPanel.createRideAt(x, y, placementDir));
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
              ridePlacement = null;
              ridePlacementCommandPending = false;
              gameUi.selectTool('ride');
              gameUi.setToolStatus(`Build a path directly beside the ${def.name.toLowerCase()}.`);
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
    }
    if (ridePlacement.part === 'entrance' && flags & RideFlag.EntrancePlaced) {
      ridePlacementCommandPending = false;
      if (openingStallRideId === ridePlacement.rideId) {
        sim.command({ type: 'setRideStatus', rideId: ridePlacement.rideId, status: 'open' });
        openingStallRideId = null;
        ridePlacement = null;
        ridePlacementFeedbackMessage = null;
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
        ridePlacementFeedbackMessage = null;
        gameUi.setToolStatus('Place exit next to the ride.');
      }
    } else if (ridePlacement.part === 'exit' && flags & RideFlag.ExitPlaced) {
      gameUi.openRide(ridePlacement.rideId);
      ridePlacement = null;
      ridePlacementFeedbackMessage = null;
      ridePlacementCommandPending = false;
      rideSetupNotice = 'Ride setup complete. Test the ride before opening it.';
      gameUi.setToolStatus(rideSetupNotice);
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
    for (const [fx, fy] of footprint) {
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ] as const) {
        const entrance = { x: x + fx + dx, y: y + fy + dy };
        if (
          entrance.x >= 0 &&
          entrance.y >= 0 &&
          entrance.x < map.width &&
          entrance.y < map.height &&
          map.surface[entrance.y * map.width + entrance.x] === Surface.Path
        )
          return { entrance };
      }
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
    const snapshot = sim.latest;
    const map = sim.map;
    rotateButton.hidden =
      ridePlacement !== null ||
      deps.selectedTool() !== 'ride' ||
      RIDE_CATALOG[coasterPanel.rideType].footprint.length <= 1;
    ridePlacementTargets.setAttribute('viewBox', `0 0 ${width} ${height}`);
    ridePlacementTargets.setAttribute('width', String(width));
    ridePlacementTargets.setAttribute('height', String(height));
    const placement =
      ridePlacement ?? (deps.selectedTool() === 'track' ? coasterPanel.boardingPlacement() : null);
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
    if (
      stallFrontTile &&
      !allCandidates.some(
        (cell) => cell.x === stallFrontTile?.[0] && cell.y === stallFrontTile?.[1],
      )
    )
      allCandidates.push({ x: stallFrontTile[0], y: stallFrontTile[1] });
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
      const level = snapshot.buildable[index] !== 0;
      const dryAndLevel =
        map.surface[index] !== Surface.Water &&
        map.slope[index] === 0 &&
        (map.waterLevel?.[index] ?? 0) <= map.heights[index];
      const invalidReason = !level
        ? 'You need to own the land or its construction rights.'
        : occupiedBoardingTile
          ? 'An entrance or exit is already placed here.'
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
          valid
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
    canvas.classList.toggle('ride-stall-front-preview', stallFrontTile !== null);
  }
  return {
    chooseRideType,
    rotatePlacement,
    placeRidePart,
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
      return {
        type: coasterPanel.rideType,
        x,
        y,
        facing: facilityFacingFromPaths(x, y, map),
        dir: placementDir,
        baseLevel: ridePlacementLevel(coasterPanel.rideType, x, y, placementDir, map),
        valid: ridePlacementValid(coasterPanel.rideType, x, y, placementDir, map, snapshot),
      };
    },
  };
}

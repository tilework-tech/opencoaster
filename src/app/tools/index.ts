import type { Camera } from '../../render/renderer';
import { pickTile } from '../../render/projection';
import type { GameUI, GuestSelection, ToolMode } from '../../ui/game-ui';
import type { SimClient } from '../../worker/sim-client';
import { findRideIdAtTile } from '../../input/object-picking';
import type { CoasterPanel } from '../../ui/coaster-panel';
import type { SceneryItem } from '../../sim/map/scenery';
import {
  handleFlowerbedTool,
  handleLandPurchase,
  handlePathAdditionTool,
  handlePathTool,
  handlePatrolTool,
  handleSceneryTool,
} from './handlers';
import { findGuestAt } from './selection';
import type { PathFeedback } from './path-feedback';
import type { LandController } from './land-controller';
import type { AreaController } from './area-controller';
import type { PathTool } from './path/controller';
import type { Tile } from './path/run';
import { project } from '../../render/projection';
import { OWNED } from '../../sim/map/tile-map';
import { guestRowState } from '../../worker/snapshot';

type MovingPerson = { person: 'guest' | 'staff'; id: number };

export interface ToolControllerDependencies {
  canvas: HTMLCanvasElement;
  sim: SimClient;
  camera: Camera;
  gameUi: GameUI;
  coasterPanel: CoasterPanel;
  selectedTool: () => ToolMode;
  selectedGuest: () => GuestSelection | null;
  setSelectedGuest: (guest: GuestSelection | null) => void;
  alternate: () => boolean;
  land: LandController;
  areaTools: Record<'clear' | 'water', AreaController>;
  pathFeedback: PathFeedback;
  pathTool: PathTool;
  sceneryItem: () => SceneryItem;
  sceneryRotation: () => number;
  patrolStaffId: () => number | null;
  clearRideSetupNotice: () => void;
  rideTileClick: (x: number, y: number) => void;
}

export function createToolController(deps: ToolControllerDependencies) {
  let movingPerson: MovingPerson | null = null;
  const handlerDeps = {
    sim: deps.sim,
    gameUi: deps.gameUi,
    selectedTool: deps.selectedTool,
    alternate: deps.alternate,
    pathTool: deps.pathTool,
    sceneryItem: deps.sceneryItem,
    sceneryRotation: deps.sceneryRotation,
    patrolStaffId: deps.patrolStaffId,
  };

  function tileAt(clientX: number, clientY: number): Tile | null {
    const rect = deps.canvas.getBoundingClientRect();
    const map = deps.sim.map;
    if (!map) return null;
    const tile = pickTile(clientX - rect.left, clientY - rect.top, map, deps.camera, {
      width: rect.width,
      height: rect.height,
    });
    return tile ? { x: tile[0], y: tile[1] } : null;
  }

  function removePathAt(clientX: number, clientY: number): void {
    const tile = tileAt(clientX, clientY);
    if (!tile) return;
    deps.sim.command({ type: 'removePath', x: tile.x, y: tile.y });
    deps.gameUi.setToolStatus(`Path removal requested at ${tile.x}, ${tile.y}.`);
  }

  /** Line-mode footpath drags; the path tool previews the run and lays it on release. */
  const pathDrag = {
    start(clientX: number, clientY: number): boolean {
      if (deps.alternate()) return false;
      const tile = tileAt(clientX, clientY);
      if (!tile) return false;
      deps.pathTool.pointAt(clientX, clientY);
      return deps.pathTool.dragStart(tile);
    },
    move(clientX: number, clientY: number): void {
      deps.pathTool.pointAt(clientX, clientY);
      const tile = tileAt(clientX, clientY);
      if (tile) deps.pathTool.dragMove(tile);
    },
    end(): void {
      void deps.pathTool.dragEnd();
    },
    hover(clientX: number, clientY: number): void {
      deps.pathTool.pointAt(clientX, clientY);
      deps.pathTool.hover(deps.alternate() ? null : tileAt(clientX, clientY));
    },
    hoverEnd(): void {
      deps.pathTool.hoverEnd();
    },
    cancel(): void {
      deps.pathTool.dragCancel();
    },
  };

  function removeSceneryAt(clientX: number, clientY: number): void {
    const rect = deps.canvas.getBoundingClientRect();
    const map = deps.sim.map;
    if (!map) {
      deps.gameUi.setToolStatus('Scenery cannot be removed until the park map is ready.');
      return;
    }
    const tile = pickTile(clientX - rect.left, clientY - rect.top, map, deps.camera, {
      width: rect.width,
      height: rect.height,
    });
    if (!tile) {
      deps.gameUi.setToolStatus('No map tile under the pointer to remove scenery from.');
      return;
    }
    if (deps.sim.latest && findRideIdAtTile(deps.sim.latest, tile[0], tile[1]) !== null) {
      handleCanvasClick(clientX, clientY, false, true);
      return;
    }
    let hasScenery = false;
    const sceneryElements = map.sceneryElements ?? [];
    for (let item = 0; item < (map.sceneryCount ?? 0); item++) {
      const offset = item * 5;
      if (sceneryElements[offset] === tile[0] && sceneryElements[offset + 1] === tile[1]) {
        hasScenery = true;
        break;
      }
    }
    if (!hasScenery) {
      deps.gameUi.setToolStatus(`No scenery on tile ${tile[0]}, ${tile[1]} to remove.`);
      return;
    }
    deps.sim.command({ type: 'removeScenery', x: tile[0], y: tile[1] });
    deps.gameUi.setToolStatus(`Scenery removal requested at ${tile[0]}, ${tile[1]}.`);
  }

  function handleCanvasClick(
    clientX: number,
    clientY: number,
    shiftKey = false,
    forceSelect = false,
  ): void {
    deps.clearRideSetupNotice();
    deps.pathFeedback.pointAt(clientX, clientY);
    const rect = deps.canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const map = deps.sim.map;
    if (!map) return;
    const tile = pickTile(localX, localY, map, deps.camera, {
      width: rect.width,
      height: rect.height,
    });
    const selectedTool = deps.selectedTool();
    if (movingPerson && selectedTool === 'select' && !forceSelect) {
      const person = movingPerson;
      movingPerson = null;
      if (!tile) {
        deps.gameUi.setToolStatus('Drop refused: choose a tile inside the park map.');
        return;
      }
      const index = tile[1] * map.width + tile[0];
      const owned = ((map.ownership?.[index] ?? 0) & OWNED) !== 0;
      let walkable = false;
      for (let i = 0; i < (map.pathCount ?? 0); i++) {
        const offset = i * 6;
        if (map.pathElements?.[offset] === tile[0] && map.pathElements[offset + 1] === tile[1]) {
          walkable = true;
          break;
        }
      }
      const water = map.waterLevel?.[index] ?? 0;
      if (!walkable && !owned) {
        deps.gameUi.setToolStatus('Drop refused: destination must be a path or owned land.');
        return;
      }
      if (water > map.heights[index]!) {
        deps.gameUi.setToolStatus('Drop refused: destination is underwater.');
        return;
      }
      deps.sim.command({
        type: 'setPersonPosition',
        person: person.person,
        personId: person.id,
        x: tile[0],
        y: tile[1],
      });
      deps.gameUi.setToolStatus(
        `${person.person === 'guest' ? 'Guest' : 'Staff'} moved to tile ${tile[0]}, ${tile[1]}.`,
      );
      return;
    }
    if (selectedTool !== 'select' && !forceSelect) {
      if (!tile) {
        deps.gameUi.setToolStatus(
          `${selectedTool[0].toUpperCase()}${selectedTool.slice(1)} tool · outside the park map.`,
        );
        return;
      }
      const [x, y] = tile;
      if (selectedTool === 'land') deps.land.tap(clientX, clientY, shiftKey);
      else if (selectedTool === 'clear' || selectedTool === 'water')
        deps.areaTools[selectedTool].tap(clientX, clientY, shiftKey || deps.alternate());
      else if (selectedTool === 'buy-land') handleLandPurchase(handlerDeps, x, y, false);
      else if (selectedTool === 'buy-rights') handleLandPurchase(handlerDeps, x, y, true);
      else if (selectedTool === 'path') handlePathTool(handlerDeps, x, y);
      else if (selectedTool === 'scenery') handleSceneryTool(handlerDeps, x, y, shiftKey);
      else if (
        selectedTool === 'bin' ||
        selectedTool === 'bench' ||
        selectedTool === 'shelter' ||
        selectedTool === 'lamp'
      )
        handlePathAdditionTool(handlerDeps, x, y);
      else if (selectedTool === 'flowerbed') handleFlowerbedTool(handlerDeps, x, y, shiftKey);
      else if (selectedTool === 'patrol') handlePatrolTool(handlerDeps, x, y, shiftKey);
      else if (selectedTool === 'ride') deps.rideTileClick(x, y);
      else deps.gameUi.setToolStatus(deps.coasterPanel.handleTileClick(x, y));
      return;
    }
    const rideId =
      tile && deps.sim.latest ? findRideIdAtTile(deps.sim.latest, tile[0], tile[1]) : null;
    const guest =
      rideId === null
        ? findGuestAt(localX, localY, rect.width, rect.height, map, deps.camera, deps.sim)
        : null;
    let staffId: number | null = null;
    const snapshot = deps.sim.latest;
    if (!guest && snapshot) {
      const point = new Float64Array(2);
      let nearest = 18 * 18;
      for (let slot = 0; slot < snapshot.staff.count; slot++) {
        const offset = slot * 4;
        project(
          snapshot.staff.data[offset]!,
          snapshot.staff.data[offset + 1]!,
          snapshot.staff.data[offset + 2]!,
          map.width,
          map.height,
          deps.camera.rotation,
          point,
        );
        const dx = rect.width / 2 + (point[0] - deps.camera.x) * deps.camera.zoom - localX;
        const dy = rect.height / 2 + (point[1] - deps.camera.y) * deps.camera.zoom - localY;
        const distance = dx * dx + dy * dy;
        if (distance < nearest) {
          nearest = distance;
          staffId = snapshot.staffIds[slot]!;
        }
      }
    }
    deps.setSelectedGuest(guest);
    let selectionStatus = tile ? `Tile ${tile[0]}, ${tile[1]}` : 'Outside the park map.';
    if (rideId !== null) {
      deps.gameUi.openRide(rideId);
      selectionStatus = `Ride ${rideId} information opened.`;
    } else if (guest) deps.gameUi.openWindow(`guest-${guest.id}`);
    else if (staffId !== null) deps.gameUi.openWindow(`worker-${staffId}`);
    else if (tile && map.entranceX === tile[0] && map.entranceY === tile[1])
      deps.gameUi.openWindow('park');
    deps.gameUi.setToolStatus(selectionStatus);
    deps.gameUi.update(deps.sim.latest, deps.sim.stats, deps.selectedGuest());
  }

  function personDragStart(clientX: number, clientY: number): boolean {
    if (deps.selectedTool() !== 'select' || !deps.sim.latest) return false;
    const rect = deps.canvas.getBoundingClientRect();
    const map = deps.sim.map;
    if (!map) return false;
    if (movingPerson) return true;
    const guest = findGuestAt(
      clientX - rect.left,
      clientY - rect.top,
      rect.width,
      rect.height,
      map,
      deps.camera,
      deps.sim,
    );
    if (guest) {
      if (
        guest.state === 'queueing' ||
        guest.state === 'waiting to board' ||
        guest.state === 'riding'
      ) {
        deps.gameUi.setToolStatus('Pick up refused: guests on rides or in queues cannot be moved.');
        return true;
      }
      movingPerson = { person: 'guest', id: guest.id };
      return true;
    }
    const snapshot = deps.sim.latest;
    const point = new Float64Array(2);
    let best = -1;
    let distance = 18 * 18;
    for (let slot = 0; slot < snapshot.staff.count; slot++) {
      const offset = slot * 4;
      project(
        snapshot.staff.data[offset]!,
        snapshot.staff.data[offset + 1]!,
        snapshot.staff.data[offset + 2]!,
        map.width,
        map.height,
        deps.camera.rotation,
        point,
      );
      const dx =
        rect.width / 2 + (point[0] - deps.camera.x) * deps.camera.zoom - (clientX - rect.left);
      const dy =
        rect.height / 2 + (point[1] - deps.camera.y) * deps.camera.zoom - (clientY - rect.top);
      const next = dx * dx + dy * dy;
      if (next < distance) {
        distance = next;
        best = slot;
      }
    }
    if (best < 0) return false;
    movingPerson = { person: 'staff', id: snapshot.staffIds[best]! };
    return true;
  }

  function personDragMove(): void {
    if (!movingPerson) return;
    deps.gameUi.setToolStatus(
      `Moving ${movingPerson.person} ${movingPerson.id} · release to drop.`,
    );
  }

  function personDragEnd(clientX: number, clientY: number): void {
    if (!movingPerson) return;
    handleCanvasClick(clientX, clientY);
  }

  function personDragCancel(): void {
    movingPerson = null;
  }

  function beginPersonMove(person: 'guest' | 'staff', id: number): void {
    const guest = person === 'guest' ? (deps.sim.latest?.guestIds.indexOf(id) ?? -1) : -1;
    if (guest >= 0 && deps.sim.latest) {
      const state = guestRowState(deps.sim.latest.guests.data[guest * 4 + 3]!);
      if (state === 1 || state === 2 || state === 5) {
        deps.gameUi.setToolStatus('Pick up refused: guests on rides or in queues cannot be moved.');
        return;
      }
    }
    movingPerson = { person, id };
  }

  return {
    removePathAt,
    removeSceneryAt,
    handleCanvasClick,
    pathDrag,
    beginPersonMove,
    personDragStart,
    personDragMove,
    personDragEnd,
    personDragCancel,
  };
}

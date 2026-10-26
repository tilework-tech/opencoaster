import type { Camera, Renderer } from '../../render/renderer';
import { pickTile } from '../../render/projection';
import type { GameUI, GuestSelection, ToolMode } from '../../ui/game-ui';
import type { SimClient } from '../../worker/sim-client';
import { findRideIdAtTile } from '../../input/object-picking';
import type { CoasterPanel } from '../../ui/coaster-panel';
import type { SceneryItem } from '../../sim/map/scenery';
import { isWallScenery } from '../../sim/map/scenery';
import { nearestWallEdge } from '../../input/wall-edge';
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
import { RideInfo, RIDE_INFO_STRIDE } from '../../worker/snapshot';
import { RIDE_CATALOG, type RideType } from '../../sim/rides/ride-types';
import type { ObjectPickTarget } from '../../input/object-picking';
import { drawHeldSprite, drawSpriteOutline, heldLiftPixels, hoverGroup } from './object-overlay';
import { TILE_UNITS, Z_STEP } from '../../sim/core/constants';

type MovingPerson = { person: 'guest' | 'staff'; id: number; sprite?: ObjectPickTarget };

function tilesBetween(start: Tile, end: Tile): Tile[] {
  const points: Tile[] = [];
  let x = start.x;
  let y = start.y;
  const dx = Math.abs(end.x - x);
  const dy = Math.abs(end.y - y);
  const sx = x < end.x ? 1 : -1;
  const sy = y < end.y ? 1 : -1;
  let error = dx - dy;
  while (x !== end.x || y !== end.y) {
    const twice = error * 2;
    if (twice > -dy) {
      error -= dy;
      x += sx;
    }
    if (twice < dx) {
      error += dx;
      y += sy;
    }
    points.push({ x, y });
  }
  return points;
}

export interface ToolControllerDependencies {
  canvas: HTMLCanvasElement;
  renderer: Renderer;
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
  sceneryEdge: () => number | null;
  patrolStaffId: () => number | null;
  clearRideSetupNotice: () => void;
  rideTileClick: (x: number, y: number) => void;
}

export function createToolController(deps: ToolControllerDependencies) {
  let movingPerson: MovingPerson | null = null;
  let hoverOutline: HTMLCanvasElement | null = null;
  let hoveredTargetKey = '';
  let hoverOrigin = { x: 0, y: 0 };
  let hoveredObjectName: string | null = null;
  let objectPopup: HTMLDivElement | null = null;
  let liftedPerson: HTMLCanvasElement | null = null;
  let wallDragTiles = new Map<string, Tile>();
  let wallDragLast: Tile | null = null;
  let wallDragEdge = 0;
  let dropMarker: HTMLDivElement | null = null;
  let dropShadow: HTMLDivElement | null = null;
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

  function dropCheck(tile: Tile | null): { ok: boolean; reason: string } {
    const map = deps.sim.map;
    if (!tile || !map) return { ok: false, reason: 'choose a tile inside the park map.' };
    const index = tile.y * map.width + tile.x;
    const owned = ((map.ownership?.[index] ?? 0) & OWNED) !== 0;
    let walkable = false;
    for (let i = 0; i < (map.pathCount ?? 0); i++) {
      const offset = i * 6;
      if (map.pathElements?.[offset] === tile.x && map.pathElements[offset + 1] === tile.y) {
        walkable = true;
        break;
      }
    }
    if (!walkable && !owned)
      return { ok: false, reason: 'destination must be a path or owned land.' };
    if ((map.waterLevel?.[index] ?? 0) > map.heights[index]!)
      return { ok: false, reason: 'destination is underwater.' };
    return { ok: true, reason: '' };
  }

  function updatePersonMoveVisual(clientX: number, clientY: number): void {
    if (!movingPerson) return;
    const map = deps.sim.map;
    const rect = deps.canvas.getBoundingClientRect();
    liftedPerson ??= Object.assign(document.createElement('canvas'), {
      className: 'person-pickup-ghost',
    });
    dropMarker ??= Object.assign(document.createElement('div'), {
      className: 'person-drop-marker',
    });
    dropShadow ??= Object.assign(document.createElement('div'), {
      className: 'person-drop-shadow',
    });
    if (!liftedPerson.isConnected) document.body.append(liftedPerson);
    if (!dropMarker.isConnected) document.body.append(dropMarker);
    if (!dropShadow.isConnected) document.body.append(dropShadow);
    const sprite = movingPerson.sprite;
    if (sprite && liftedPerson.dataset.person !== `${movingPerson.person}:${movingPerson.id}`) {
      drawHeldSprite(liftedPerson, sprite);
      liftedPerson.dataset.person = `${movingPerson.person}:${movingPerson.id}`;
    }
    const lift = heldLiftPixels(deps.camera.zoom);
    Object.assign(liftedPerson.style, {
      left: `${clientX - (sprite?.anchorX ?? 8)}px`,
      top: `${clientY - lift - (sprite?.anchorY ?? 20)}px`,
    });
    const tile = tileAt(clientX, clientY);
    const check = dropCheck(tile);
    dropMarker.dataset.valid = String(check.ok);
    dropShadow.dataset.valid = String(check.ok);
    if (tile && map) {
      const point = new Float64Array(2);
      project(
        tile.x * TILE_UNITS + TILE_UNITS / 2,
        tile.y * TILE_UNITS + TILE_UNITS / 2,
        map.heights[tile.y * map.width + tile.x]! * Z_STEP,
        map.width,
        map.height,
        deps.camera.rotation,
        point,
      );
      const x = rect.left + rect.width / 2 + (point[0]! - deps.camera.x) * deps.camera.zoom;
      const y = rect.top + rect.height / 2 + (point[1]! - deps.camera.y) * deps.camera.zoom;
      const zoom = deps.camera.zoom;
      Object.assign(dropMarker.style, {
        left: `${x - 22 * zoom}px`,
        top: `${y - 11 * zoom}px`,
        width: `${44 * zoom}px`,
        height: `${22 * zoom}px`,
        display: 'block',
      });
      Object.assign(dropShadow.style, {
        left: `${clientX - 14 * zoom}px`,
        top: `${clientY - 6 * zoom}px`,
        width: `${28 * zoom}px`,
        height: `${12 * zoom}px`,
        display: 'block',
      });
    } else {
      dropMarker.style.display = 'none';
      dropShadow.style.display = 'none';
    }
    deps.gameUi.setToolStatus(check.ok ? 'Release to drop.' : `Drop refused: ${check.reason}`);
  }

  function hidePersonMoveVisual(): void {
    deps.renderer.setHeldPerson(null);
    if (liftedPerson) delete liftedPerson.dataset.person;
    if (liftedPerson) liftedPerson.remove();
    if (dropMarker) dropMarker.remove();
    if (dropShadow) dropShadow.remove();
  }

  function removePathAt(clientX: number, clientY: number): void {
    const tile = tileAt(clientX, clientY);
    if (!tile) return;
    deps.sim.command({ type: 'removePath', x: tile.x, y: tile.y });
    deps.gameUi.setToolStatus(`Path removal requested at ${tile.x}, ${tile.y}.`);
  }

  function pickedObject(clientX: number, clientY: number): ObjectPickTarget | null {
    const rect = deps.canvas.getBoundingClientRect();
    return deps.renderer.pickObject(
      deps.sim.latest,
      deps.camera,
      clientX - rect.left,
      clientY - rect.top,
      {
        width: rect.width,
        height: rect.height,
      },
    );
  }

  function hoverCanvas(clientX: number, clientY: number): void {
    if (movingPerson) {
      clearObjectHover();
      if (!movingPerson.sprite) {
        const rect = deps.canvas.getBoundingClientRect();
        const held = movingPerson;
        movingPerson.sprite = deps.renderer
          .objectTargets(deps.sim.latest, deps.camera, { width: rect.width, height: rect.height })
          .find((t) => t.personId === held.id && t.kind === held.person);
        deps.renderer.setHeldPerson(held.person, held.id);
      }
      updatePersonMoveVisual(clientX, clientY);
      return;
    }
    if (deps.selectedTool() !== 'select') {
      clearObjectHover();
      return;
    }
    const target = pickedObject(clientX, clientY);
    if (!target) {
      clearObjectHover();
      return;
    }
    deps.gameUi.setToolStatus(target.name);
    hoveredObjectName = target.name;
    if (!hoverOutline) {
      hoverOutline = document.createElement('canvas');
      hoverOutline.className = 'object-hover-outline';
      hoverOutline.setAttribute('aria-hidden', 'true');
      document.body.append(hoverOutline);
    }
    const rect = deps.canvas.getBoundingClientRect();
    const snapshot = deps.sim.latest;
    const viewport = { width: rect.width, height: rect.height };
    const flatRideIds = new Set<number>();
    for (let i = 0; snapshot && i < snapshot.rides.count; i++) {
      const offset = i * RIDE_INFO_STRIDE;
      if (!RIDE_CATALOG[snapshot.rideInfo[offset + RideInfo.Type]! as RideType]?.usesTrack)
        flatRideIds.add(snapshot.rideInfo[offset + RideInfo.Id]!);
    }
    const group = hoverGroup(
      target,
      deps.renderer.objectTargets(snapshot, deps.camera, viewport),
      flatRideIds,
    );
    const key = `${group.map((t) => t.id).join(',')}:${target.x}:${target.y}:${target.width}`;
    if (key !== hoveredTargetKey) {
      hoverOrigin = drawSpriteOutline(hoverOutline, group);
      hoveredTargetKey = key;
    }
    Object.assign(hoverOutline.style, {
      left: `${rect.left + hoverOrigin.x}px`,
      top: `${rect.top + hoverOrigin.y}px`,
      display: 'block',
    });
  }

  function clearObjectHover(): void {
    if (hoverOutline) hoverOutline.style.display = 'none';
    hoveredTargetKey = '';
    if (hoveredObjectName !== null) {
      deps.gameUi.setToolStatus('');
      hoveredObjectName = null;
    }
  }

  function showObjectInfo(target: ObjectPickTarget, clientY: number): void {
    objectPopup?.remove();
    const popup = document.createElement('div');
    popup.dataset.objectInfo = '';
    popup.className = 'object-info-popup';
    const title = document.createElement('strong');
    title.textContent = target.name;
    popup.append(title);
    if (target.state) {
      const state = document.createElement('span');
      state.textContent = target.state;
      popup.append(state);
    }
    const button = (label: string, action: () => void) => {
      const control = document.createElement('button');
      control.type = 'button';
      control.textContent = label;
      control.addEventListener('click', () => {
        action();
        popup.remove();
      });
      popup.append(control);
    };
    if (target.kind === 'scenery')
      button('Remove', () => {
        const scenery = deps.sim.map?.sceneryElements ?? [];
        const offset = (target.sceneryIndex ?? -1) * 5;
        const item = scenery[offset + 4] as SceneryItem | undefined;
        const edge = item !== undefined && isWallScenery(item) ? scenery[offset + 3] : undefined;
        deps.sim.command({ type: 'removeScenery', x: target.tileX, y: target.tileY, edge });
      });
    if (target.kind === 'path-addition') {
      const flags = deps.sim.map?.pathElements?.[target.pathIndex! * 6 + 3] ?? 0;
      const addition = flags & 0x1000 ? 1 : flags & 0x2000 ? 2 : flags & 0x4000 ? 3 : 4;
      button('Remove', () =>
        deps.sim.command({
          type: 'setPathAddition',
          x: target.tileX,
          y: target.tileY,
          addition: 0,
        }),
      );
      if (target.state === 'vandalised')
        button('Repair', () =>
          deps.sim.command({ type: 'setPathAddition', x: target.tileX, y: target.tileY, addition }),
        );
    }
    button('Done', () => {});
    Object.assign(popup.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      visibility: 'hidden',
    });
    document.body.append(popup);
    const canvasRect = deps.canvas.getBoundingClientRect();
    const box = {
      left: canvasRect.left + target.x,
      right: canvasRect.left + target.x + target.width,
      top: canvasRect.top + target.y,
      bottom: canvasRect.top + target.y + target.height,
    };
    const { width, height } = popup.getBoundingClientRect();
    const margin = 8;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const side =
      box.right + margin + width <= viewportWidth - margin
        ? box.right + margin
        : box.left - margin - width;
    const left = Math.max(margin, Math.min(side, viewportWidth - width - margin));
    const top = Math.max(margin, Math.min(clientY - height / 2, viewportHeight - height - margin));
    Object.assign(popup.style, { left: `${left}px`, top: `${top}px`, visibility: 'visible' });
    objectPopup = popup;
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

  const wallDrag = {
    start(clientX: number, clientY: number): boolean {
      if (!isWallScenery(deps.sceneryItem()) || deps.alternate()) return false;
      const tile = tileAt(clientX, clientY);
      const map = deps.sim.map;
      if (!tile || !map) return false;
      const rect = deps.canvas.getBoundingClientRect();
      wallDragEdge =
        deps.sceneryEdge() ??
        nearestWallEdge(
          clientX - rect.left,
          clientY - rect.top,
          map,
          deps.camera,
          { width: rect.width, height: rect.height },
          tile.x,
          tile.y,
        );
      wallDragTiles = new Map([[`${tile.x}:${tile.y}`, tile]]);
      wallDragLast = tile;
      return true;
    },
    move(clientX: number, clientY: number): void {
      const tile = tileAt(clientX, clientY);
      if (!tile || !wallDragLast) return;
      const start = wallDragTiles.values().next().value as Tile | undefined;
      if (start) {
        const dx = Math.abs(tile.x - start.x);
        const dy = Math.abs(tile.y - start.y);
        if (dx > dy && wallDragEdge % 2 === 0) wallDragEdge = wallDragEdge === 0 ? 1 : 3;
        else if (dy > dx && wallDragEdge % 2 === 1) wallDragEdge = wallDragEdge === 1 ? 0 : 2;
      }
      for (const point of tilesBetween(wallDragLast, tile))
        wallDragTiles.set(`${point.x}:${point.y}`, point);
      wallDragLast = tile;
    },
    end(): void {
      for (const tile of wallDragTiles.values())
        deps.sim.command({
          type: 'placeScenery',
          x: tile.x,
          y: tile.y,
          item: deps.sceneryItem(),
          rotation: wallDragEdge,
        });
      if (wallDragTiles.size)
        deps.gameUi.setToolStatus(`Wall run placement requested · ${wallDragTiles.size} tiles.`);
      wallDragTiles.clear();
      wallDragLast = null;
    },
    cancel(): void {
      wallDragTiles.clear();
      wallDragLast = null;
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
    const selectedTool = deps.selectedTool();
    const tile = pickTile(localX, localY, map, deps.camera, {
      width: rect.width,
      height: rect.height,
    });
    const object = selectedTool === 'select' || forceSelect ? pickedObject(clientX, clientY) : null;
    if (movingPerson && selectedTool === 'select' && !forceSelect) {
      const person = movingPerson;
      movingPerson = null;
      hidePersonMoveVisual();
      const check = dropCheck(tile ? { x: tile[0], y: tile[1] } : null);
      if (!check.ok || !tile) {
        deps.gameUi.setToolStatus(`Drop refused: ${check.reason}`);
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
      else if (selectedTool === 'scenery') {
        const edge = isWallScenery(deps.sceneryItem())
          ? (deps.sceneryEdge() ??
            nearestWallEdge(
              localX,
              localY,
              map,
              deps.camera,
              {
                width: rect.width,
                height: rect.height,
              },
              x,
              y,
            ))
          : undefined;
        handleSceneryTool(handlerDeps, x, y, shiftKey, edge);
      } else if (
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
    if (object) {
      deps.setSelectedGuest(null);
      if (object.kind === 'ride' && object.rideId !== undefined) {
        deps.gameUi.openRide(object.rideId);
        deps.gameUi.setToolStatus(`${object.name} information opened.`);
      } else if (object.kind === 'guest' && object.personId !== undefined) {
        const guest = findGuestAt(
          localX,
          localY,
          rect.width,
          rect.height,
          map,
          deps.camera,
          deps.sim,
        );
        deps.setSelectedGuest(guest);
        deps.gameUi.openWindow(`guest-${object.personId}`);
        deps.gameUi.setToolStatus(`${object.name} information opened.`);
      } else if (object.kind === 'staff' && object.personId !== undefined) {
        deps.gameUi.openWindow(`worker-${object.personId}`);
        deps.gameUi.setToolStatus(`${object.name} information opened.`);
      } else if (object.kind === 'park') {
        deps.gameUi.openWindow('park');
        deps.gameUi.setToolStatus('Park information opened.');
      } else {
        showObjectInfo(object, clientY);
        deps.gameUi.setToolStatus(object.name);
      }
      deps.gameUi.update(deps.sim.latest, deps.sim.stats, deps.selectedGuest());
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
      let rideName: string | undefined;
      if (snapshot) {
        for (let slot = 0; slot < snapshot.rides.count; slot++) {
          const offset = slot * RIDE_INFO_STRIDE;
          if (snapshot.rideInfo[offset + RideInfo.Id] === rideId) {
            const name = RIDE_CATALOG[snapshot.rideInfo[offset + RideInfo.Type]! as RideType]?.name;
            if (name) rideName = `${name} ${rideId + 1}`;
            break;
          }
        }
      }
      selectionStatus = `${rideName ?? `Ride ${rideId + 1}`} information opened.`;
    } else if (guest) deps.gameUi.openWindow(`guest-${guest.id}`);
    else if (staffId !== null) deps.gameUi.openWindow(`worker-${staffId}`);
    else if (tile && map.entranceX === tile[0] && map.entranceY === tile[1])
      deps.gameUi.openWindow('park');
    deps.gameUi.setToolStatus(selectionStatus);
    deps.gameUi.update(deps.sim.latest, deps.sim.stats, deps.selectedGuest());
  }

  function personDragStart(clientX: number, clientY: number): boolean {
    if (deps.selectedTool() !== 'select' || !deps.sim.latest) return false;
    if (!deps.sim.map) return false;
    if (movingPerson) return true;
    const target = pickedObject(clientX, clientY);
    if (target?.kind === 'guest' && target.personId !== undefined) {
      const snapshot = deps.sim.latest;
      const slot = snapshot.guestIds.indexOf(target.personId);
      if (slot < 0) return false;
      const state = guestRowState(snapshot.guests.data[slot * 4 + 3]!);
      if (state === 1 || state === 2 || state === 5) {
        deps.gameUi.setToolStatus('Pick up refused: guests on rides or in queues cannot be moved.');
        return true;
      }
      movingPerson = { person: 'guest', id: target.personId, sprite: target };
      clearObjectHover();
      deps.renderer.setHeldPerson('guest', target.personId);
      updatePersonMoveVisual(clientX, clientY);
      return true;
    }
    if (target?.kind !== 'staff' || target.personId === undefined) return false;
    movingPerson = { person: 'staff', id: target.personId, sprite: target };
    clearObjectHover();
    deps.renderer.setHeldPerson('staff', target.personId);
    updatePersonMoveVisual(clientX, clientY);
    return true;
  }

  function personDragMove(clientX: number, clientY: number): void {
    updatePersonMoveVisual(clientX, clientY);
  }

  function personDragEnd(clientX: number, clientY: number): void {
    if (!movingPerson) return;
    handleCanvasClick(clientX, clientY);
  }

  function personDragCancel(): void {
    movingPerson = null;
    hidePersonMoveVisual();
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
    deps.gameUi.setToolStatus(`Moving ${person} ${id} · choose a destination tile.`);
  }

  return {
    removePathAt,
    removeSceneryAt,
    handleCanvasClick,
    hoverCanvas,
    clearObjectHover,
    pathDrag,
    wallDrag,
    beginPersonMove,
    personDragStart,
    personDragMove,
    personDragEnd,
    personDragCancel,
  };
}

import type { Camera } from '../render/renderer';
import type { MapData } from '../render/renderer';
import type { Snapshot } from '../worker/snapshot';
import { pickTile, project, unrotatePoint } from '../render/projection';
import type { Rotation } from '../render/projection';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { PathFlag } from '../sim/map/tile-map';
import { stepZoom as stepUiZoom, ZOOM_LEVELS as UI_ZOOM_LEVELS } from '../ui/zoom';

export const ZOOM_LEVELS = UI_ZOOM_LEVELS;
export const MAX_DEVICE_PIXEL_RATIO = 2;

export function snapZoom(value: number): number {
  return ZOOM_LEVELS.reduce((closest, level) =>
    Math.abs(Math.log(level / value)) < Math.abs(Math.log(closest / value)) ? level : closest,
  );
}

export function zoomCameraAt(
  camera: Camera,
  targetZoom: number,
  screenX: number,
  screenY: number,
  viewport: { width: number; height: number },
): void {
  const worldX = camera.x + (screenX - viewport.width / 2) / camera.zoom;
  const worldY = camera.y + (screenY - viewport.height / 2) / camera.zoom;
  camera.zoom = snapZoom(targetZoom);
  camera.x = worldX - (screenX - viewport.width / 2) / camera.zoom;
  camera.y = worldY - (screenY - viewport.height / 2) / camera.zoom;
}

/** Finds the visible surface elevation nearest the centre of the viewport. */
export function getCenterFocusElevation(
  map: MapData,
  camera: Camera,
  viewport: { width: number; height: number },
  snapshot?: Pick<Snapshot, 'tracks'>,
): number {
  const tile = pickTile(viewport.width / 2, viewport.height / 2, map, camera, viewport);
  let elevation = 0;
  if (tile) {
    const index = tile[1] * map.width + tile[0];
    const slope = map.slope?.[index] ?? 0;
    const raisedCorners =
      (slope & 1) + ((slope >> 1) & 1) + ((slope >> 2) & 1) + ((slope >> 3) & 1);
    elevation = map.heights[index]! * Z_STEP + (raisedCorners * Z_STEP) / 4;
  }
  let nearestDistance = Number.POSITIVE_INFINITY;
  const projected = new Float64Array(2);
  const centerDistance = (x: number, y: number, z: number): number => {
    project(x, y, z, map.width, map.height, camera.rotation, projected);
    return Math.hypot(projected[0]! - camera.x, projected[1]! - camera.y);
  };
  const pathCount = Math.min(map.pathCount ?? 0, Math.floor((map.pathElements?.length ?? 0) / 6));
  for (let index = 0; index < pathCount; index++) {
    const offset = index * 6;
    const flags = map.pathElements![offset + 3]!;
    const z =
      map.pathElements![offset + 2]! * Z_STEP + ((flags & PathFlag.Sloped) !== 0 ? Z_STEP / 2 : 0);
    const distance = centerDistance(
      map.pathElements![offset]! * TILE_UNITS + TILE_UNITS / 2,
      map.pathElements![offset + 1]! * TILE_UNITS + TILE_UNITS / 2,
      z,
    );
    if (
      distance <= 24 &&
      (distance < nearestDistance || (distance === nearestDistance && z > elevation))
    ) {
      nearestDistance = distance;
      elevation = z;
    }
  }
  const tracks = snapshot?.tracks;
  if (tracks) {
    for (let offset = 0; offset < tracks.count * 4; offset += 4) {
      const x = tracks.data[offset]!;
      const y = tracks.data[offset + 1]!;
      const z = tracks.data[offset + 2]!;
      const distance = centerDistance(x, y, z);
      if (
        distance <= 32 &&
        (distance < nearestDistance || (distance === nearestDistance && z > elevation))
      ) {
        nearestDistance = distance;
        elevation = z;
      }
    }
  }
  return elevation;
}

/** Rotates around the world point projected to the viewport centre at `focusElevation`. */
export function rotateCameraAroundWorldPoint(
  camera: Camera,
  map: Pick<MapData, 'width' | 'height'>,
  direction: -1 | 1,
  focusElevation: number,
): void {
  const horizontal = camera.x / 32;
  const vertical = (camera.y + (focusElevation / Z_STEP) * 16) / 16;
  const rx = (horizontal + vertical) / 2;
  const ry = (vertical - horizontal) / 2;
  const [x, y] = unrotatePoint(rx, ry, map.width, map.height, camera.rotation);
  const rotation = ((camera.rotation + direction + 4) % 4) as Rotation;
  const projected = new Float64Array(2);
  project(
    x * TILE_UNITS,
    y * TILE_UNITS,
    focusElevation,
    map.width,
    map.height,
    rotation,
    projected,
  );
  camera.rotation = rotation;
  camera.x = projected[0]!;
  camera.y = projected[1]!;
}

export function rotateCameraAtCenter(
  camera: Camera,
  map: MapData | null,
  direction: -1 | 1,
  viewport: { width: number; height: number },
  snapshot?: Pick<Snapshot, 'tracks'>,
): void {
  if (!map) {
    camera.rotation = ((camera.rotation + direction + 4) % 4) as Rotation;
    return;
  }
  rotateCameraAroundWorldPoint(
    camera,
    map,
    direction,
    getCenterFocusElevation(map, camera, viewport, snapshot),
  );
}

export function stepZoom(currentZoom: number, direction: -1 | 1): number {
  return stepUiZoom(currentZoom, direction);
}

export function capDevicePixelRatio(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(devicePixelRatio, MAX_DEVICE_PIXEL_RATIO);
}

import { TILE_UNITS } from '../../sim/core/constants';
import { RideInfo, RIDE_INFO_STRIDE, SNAPSHOT_STRIDE } from '../../worker/snapshot';
import type { Snapshot } from '../../worker/snapshot';
import type { MapData } from '../../render/renderer';
import { element } from '../dom';
import type { TabSpec } from '../window-manager';
import type { UiContext, WindowController } from '../ui-types';

export const MAP_TABS: readonly TabSpec[] = [
  { id: 'people', label: 'Guests', icon: 'guests' },
  { id: 'rides', label: 'Objects', icon: 'rides' },
];

const SURFACE_COLOURS = [
  '#4f9a3c',
  '#d6c27a',
  '#3f86c4',
  '#8d8d8d',
  '#8a6a44',
  '#777b80',
  '#a79a72',
];
const TERRAIN_REFRESH_MS = 1500;

export interface MapPoint {
  x: number;
  y: number;
}

/** Diamond minimap projection: tile (x, y) of a `size`-tile-square map to canvas pixels. */
export function tileToMap(x: number, y: number, size: { width: number; height: number }): MapPoint {
  return { x: x - y + size.height, y: (x + y) / 2 };
}

export function mapToTile(
  px: number,
  py: number,
  size: { width: number; height: number },
): MapPoint {
  return {
    x: Math.floor((px - size.height + 2 * py) / 2),
    y: Math.floor((2 * py - px + size.height) / 2),
  };
}

/** Park overview: terrain diamond with guests/staff or rides; tapping it moves the camera. */
export function openMapWindow(ctx: UiContext): WindowController {
  const { window: win, created } = ctx.windows.open({
    id: 'map',
    title: 'Map',
    kind: 'map',
    width: 340,
    tabs: MAP_TABS,
  });
  const canvas = element('canvas', 'minimap');
  canvas.setAttribute('aria-label', 'Park map');
  const terrain = document.createElement('canvas');
  let drawnFor: MapData | null = null;
  let drawnAt = 0;
  let size = { width: 0, height: 0 };

  canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || size.width === 0) return;
    const px = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const py = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const tile = mapToTile(px, py, size);
    if (tile.x >= 0 && tile.y >= 0 && tile.x < size.width && tile.y < size.height)
      ctx.actions.locate(tile.x, tile.y);
  });
  if (created) {
    win.pane('people').append(canvas, element('p', 'ui-help', 'Tap the map to move the view.'));
  }
  const move = (): void => win.pane(win.activeTab).prepend(canvas);
  win.root.querySelector('.ui-tabs')?.addEventListener('click', move);

  const paintTerrain = (map: MapData): void => {
    terrain.width = map.width + map.height;
    terrain.height = Math.ceil((map.width + map.height) / 2) + 1;
    const g = terrain.getContext('2d');
    if (!g) return;
    g.fillStyle = '#0d1318';
    g.fillRect(0, 0, terrain.width, terrain.height);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = y * map.width + x;
        const wet = (map.waterLevel?.[i] ?? 0) > map.heights[i];
        g.fillStyle = wet
          ? SURFACE_COLOURS[2]
          : (SURFACE_COLOURS[map.surface[i]] ?? SURFACE_COLOURS[0]);
        const p = tileToMap(x, y, map);
        g.fillRect(p.x, p.y, 2, 1);
      }
    }
  };

  return {
    update(snapshot: Snapshot | null) {
      const map = ctx.actions.map();
      if (!map || !snapshot) return;
      const now = performance.now();
      if (map !== drawnFor || now - drawnAt > TERRAIN_REFRESH_MS) {
        drawnFor = map;
        drawnAt = now;
        size = { width: map.width, height: map.height };
        paintTerrain(map);
      }
      if (canvas.width !== terrain.width) {
        canvas.width = terrain.width;
        canvas.height = terrain.height;
      }
      const g = canvas.getContext('2d');
      if (!g) return;
      g.drawImage(terrain, 0, 0);
      if (win.activeTab === 'people') {
        g.fillStyle = '#ffffff';
        for (let i = 0, o = 0; i < snapshot.guests.count; i++, o += SNAPSHOT_STRIDE) {
          const p = tileToMap(
            snapshot.guests.data[o] / TILE_UNITS,
            snapshot.guests.data[o + 1] / TILE_UNITS,
            map,
          );
          g.fillRect(p.x, p.y, 1, 1);
        }
        g.fillStyle = '#ffd34d';
        for (let i = 0, o = 0; i < snapshot.staff.count; i++, o += SNAPSHOT_STRIDE) {
          const p = tileToMap(
            snapshot.staff.data[o] / TILE_UNITS,
            snapshot.staff.data[o + 1] / TILE_UNITS,
            map,
          );
          g.fillRect(p.x - 1, p.y - 1, 3, 3);
        }
      } else {
        g.fillStyle = '#ff5a4d';
        for (let i = 0; i < snapshot.rides.count; i++) {
          const o = i * RIDE_INFO_STRIDE;
          const p = tileToMap(
            snapshot.rideInfo[o + RideInfo.RideX],
            snapshot.rideInfo[o + RideInfo.RideY],
            map,
          );
          g.fillRect(p.x - 2, p.y - 2, 5, 5);
        }
      }
    },
  };
}

import type { Camera } from '../render/renderer';
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

export function stepZoom(currentZoom: number, direction: -1 | 1): number {
  return stepUiZoom(currentZoom, direction);
}

export function capDevicePixelRatio(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(devicePixelRatio, MAX_DEVICE_PIXEL_RATIO);
}

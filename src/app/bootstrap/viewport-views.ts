import {
  cameraForFollowPosition,
  parseFollowTarget,
  resolveFollowTarget,
} from '../../render/follow-target';
import type { Camera, MapData, RenderViewport } from '../../render/renderer';
import type { Snapshot } from '../../worker/snapshot';

/** Reads visible live-view slots after UI layout and maps them into main-canvas coordinates. */
export function collectLiveViewports(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  snapshot: Snapshot | null,
  map: MapData | null,
  mainCamera: Camera,
): RenderViewport[] {
  if (!snapshot || !map) return [];
  const canvasRect = canvas.getBoundingClientRect();
  const result: RenderViewport[] = [];
  for (const slot of root.querySelectorAll<HTMLElement>('[data-live-viewport]')) {
    const target = parseFollowTarget(slot.dataset.liveViewport ?? '');
    if (!target) continue;
    const position = resolveFollowTarget(snapshot, target);
    if (!position) continue;
    const bounds = slot.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) continue;
    let output = slot.querySelector<HTMLCanvasElement>('canvas');
    if (!output) {
      output = document.createElement('canvas');
      slot.append(output);
    }
    result.push({
      output,
      id:
        slot.dataset.liveViewportId ??
        (slot.dataset.liveViewportId = `live-${result.length}-${target.kind}-${target.id}`),
      camera: cameraForFollowPosition(
        position,
        map.width,
        map.height,
        target.kind === 'ride' ? 0.7 : 1.3,
        mainCamera.rotation,
      ),
      rect: {
        x: bounds.left - canvasRect.left,
        y: bounds.top - canvasRect.top,
        width: bounds.width,
        height: bounds.height,
      },
    });
  }
  return result;
}

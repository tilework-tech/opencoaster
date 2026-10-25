import type { Camera, Renderer } from '../../render/renderer';
import { pickTile, project } from '../../render/projection';
import type { Rotation } from '../../render/projection';
import { stepZoom } from '../../ui/zoom';
import type { ToolMode, GameUI } from '../../ui/game-ui';
import { capDevicePixelRatio, zoomCameraAt } from '../../input/camera-controls';
import { PointerInput } from '../../input/pointer-input';
import type { PointerSample } from '../../input/pointer-input';
import type { SimClient } from '../../worker/sim-client';
import type { CoasterPanel } from '../../ui/coaster-panel';
import type { LandController } from '../tools/land-controller';
import { TILE_UNITS } from '../../sim/core/constants';

export function centreOnTile(x: number, y: number, sim: SimClient, camera: Camera): void {
  const map = sim.map;
  if (!map) return;
  const out = new Float64Array(2);
  project(
    x * TILE_UNITS + TILE_UNITS / 2,
    y * TILE_UNITS + TILE_UNITS / 2,
    0,
    map.width,
    map.height,
    camera.rotation,
    out,
  );
  camera.x = out[0];
  camera.y = out[1];
}

/** Footpath run drags, in client pixels. `start` returns false when the drag should pan instead. */
export interface PathDragHandlers {
  start(clientX: number, clientY: number): boolean;
  move(clientX: number, clientY: number): void;
  end(): void;
  cancel(): void;
  /** Mouse hover without a button held: previews the piece under the pointer. */
  hover(clientX: number, clientY: number): void;
  hoverEnd(): void;
}

export interface CameraInputDependencies {
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  sim: SimClient;
  camera: Camera;
  gameUi: GameUI;
  coasterPanel: CoasterPanel;
  selectedTool: () => ToolMode;
  gameActive: () => boolean;
  overlayOpen: () => boolean;
  setHiddenPaused: (hidden: boolean) => void;
  syncPause: () => void;
  handleCanvasClick: (x: number, y: number, shiftKey?: boolean, forceSelect?: boolean) => void;
  removePathAt: (x: number, y: number) => void;
  pathDrag: PathDragHandlers;
  land: LandController;
  setRideHover: (tile: [number, number] | null) => void;
  /** Receives the canvas size in CSS pixels whenever it changes. */
  viewport: { width: number; height: number };
  /** Backing-buffer scale applied on top of the capped device pixel ratio. */
  renderScale: () => number;
  /** Hands back the resize routine so the frame loop can re-run it when the render scale changes. */
  registerResize: (resize: () => void) => void;
}

function localPosition(canvas: HTMLCanvasElement, x: number, y: number): [number, number] {
  const rect = canvas.getBoundingClientRect();
  return [x - rect.left, y - rect.top];
}

function pointerSample(event: PointerEvent): PointerSample {
  return {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    pointerType: event.pointerType,
    shiftKey: event.shiftKey,
  };
}

export function connectCameraInput(deps: CameraInputDependencies): Set<string> {
  const { canvas, renderer, sim, camera, gameUi, coasterPanel } = deps;
  const keys = new Set<string>();

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    deps.viewport.width = rect.width;
    deps.viewport.height = rect.height;
    renderer.resize(
      rect.width,
      rect.height,
      capDevicePixelRatio(window.devicePixelRatio || 1) * deps.renderScale(),
    );
  }
  deps.registerResize(resize);

  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  screen.orientation?.addEventListener('change', resize);
  new ResizeObserver(resize).observe(canvas);
  resize();

  document.addEventListener('visibilitychange', () => {
    deps.setHiddenPaused(document.visibilityState === 'hidden');
    deps.syncPause();
  });

  function downloadScreenshot(): void {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `opencoaster-screenshot-${Date.now()}.png`;
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  window.addEventListener('keydown', (event) => {
    const typing =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLTextAreaElement;
    const onButton = event.target instanceof HTMLButtonElement;
    keys.add(event.key.toLowerCase());
    if (!deps.gameActive() || deps.overlayOpen()) return;
    if (event.ctrlKey && event.key.toLowerCase() === 's' && !typing) {
      event.preventDefault();
      downloadScreenshot();
      return;
    }
    if (event.key === 'Delete' && deps.selectedTool() === 'track' && !typing) {
      event.preventDefault();
      coasterPanel.removeLast();
      return;
    }
    if (
      typing &&
      !['Escape', 'PageUp', 'PageDown', 'F1', 'F2', 'F3', 'F4', 'F5'].includes(event.key)
    )
      return;
    if (onButton && (event.key === ' ' || event.key === 'Enter')) return;
    if (event.repeat && event.key !== 'PageUp' && event.key !== 'PageDown') return;
    if (gameUi.handleShortcut(event)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  const wheelStep = 60;
  let wheelAccum = 0;
  window.addEventListener(
    'wheel',
    (event) => {
      if (event.target !== canvas) return;
      wheelAccum += event.deltaY;
      event.preventDefault();
      if (Math.abs(wheelAccum) < wheelStep) return;
      const rect = canvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      zoomCameraAt(camera, stepZoom(camera.zoom, wheelAccum < 0 ? 1 : -1), localX, localY, {
        width: rect.width,
        height: rect.height,
      });
      wheelAccum = 0;
    },
    { passive: false },
  );

  let pinchStartZoom: number | null = null;
  let lastPaintTile: string | null = null;
  const pointerInput = new PointerInput({
    tool: deps.selectedTool,
    pan(dx, dy) {
      camera.x -= dx / camera.zoom;
      camera.y -= dy / camera.zoom;
    },
    zoomStart() {
      pinchStartZoom = camera.zoom;
    },
    zoom(scale, x, y) {
      if (pinchStartZoom === null) return;
      const [localX, localY] = localPosition(canvas, x, y);
      const rect = canvas.getBoundingClientRect();
      zoomCameraAt(camera, pinchStartZoom * scale, localX, localY, {
        width: rect.width,
        height: rect.height,
      });
    },
    zoomEnd() {
      pinchStartZoom = null;
    },
    rotate(direction) {
      camera.rotation = ((camera.rotation + direction + 4) % 4) as Rotation;
    },
    tap(x, y, shiftKey) {
      deps.handleCanvasClick(x, y, shiftKey);
    },
    hold(x, y) {
      if (deps.selectedTool() === 'path') deps.removePathAt(x, y);
      else deps.handleCanvasClick(x, y, false, true);
    },
    pathDragStart(x, y) {
      return deps.pathDrag.start(x, y);
    },
    pathDragMove(x, y) {
      deps.pathDrag.move(x, y);
    },
    pathDragEnd() {
      deps.pathDrag.end();
    },
    pathDragCancel() {
      deps.pathDrag.cancel();
    },
    landPress(x, y) {
      deps.land.press(x, y);
    },
    landDragStart(x, y) {
      deps.land.dragStart(x, y);
    },
    landDragMove(x, y) {
      deps.land.dragMove(x, y);
    },
    landDragEnd() {
      deps.land.dragEnd();
    },
    paint(x, y, shiftKey) {
      const map = sim.map;
      if (!map) return;
      const [localX, localY] = localPosition(canvas, x, y);
      const rect = canvas.getBoundingClientRect();
      const tile = pickTile(localX, localY, map, camera, {
        width: rect.width,
        height: rect.height,
      });
      if (!tile) return;
      const key = `${tile[0]}:${tile[1]}`;
      if (key === lastPaintTile) return;
      lastPaintTile = key;
      deps.handleCanvasClick(x, y, shiftKey);
    },
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    lastPaintTile = null;
    pointerInput.pointerDown(pointerSample(event));
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (deps.selectedTool() === 'path' && event.pointerType === 'mouse' && event.buttons === 0)
      deps.pathDrag.hover(event.clientX, event.clientY);
    if (deps.selectedTool() === 'land' && event.pointerType === 'mouse' && event.buttons === 0)
      deps.land.hover(event.clientX, event.clientY);
    if ((deps.selectedTool() === 'track' || deps.selectedTool() === 'ride') && sim.map) {
      const rect = canvas.getBoundingClientRect();
      const tile = pickTile(event.clientX - rect.left, event.clientY - rect.top, sim.map, camera, {
        width: rect.width,
        height: rect.height,
      });
      if (deps.selectedTool() === 'track') coasterPanel.setHover(tile);
      else deps.setRideHover(tile);
    }
    pointerInput.pointerMove(pointerSample(event));
  });
  canvas.addEventListener('pointerup', (event) => {
    pointerInput.pointerUp(pointerSample(event));
  });
  canvas.addEventListener('pointercancel', (event) => pointerInput.pointerCancel(event.pointerId));
  canvas.addEventListener('pointerleave', (event) => {
    deps.pathDrag.hoverEnd();
    if (deps.selectedTool() === 'land' && event.buttons === 0) deps.land.leave();
  });
  canvas.addEventListener('contextmenu', (event) => {
    if (deps.selectedTool() !== 'path') return;
    event.preventDefault();
    deps.removePathAt(event.clientX, event.clientY);
  });

  return keys;
}

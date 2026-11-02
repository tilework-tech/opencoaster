import type { Camera, Renderer } from '../../render/renderer';
import { TILE_H, TILE_W, project } from '../../render/projection';
import { TILE_UNITS, TRACK_Z_STEP } from '../../sim/core/constants';
import type { Snapshot } from '../../worker/snapshot';
import { snapshotPiece } from '../../ui/track-selection';

/** An axis-aligned screen rectangle in CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Elements drawn over the game canvas that can hide the map beneath them. */
const COVER_SELECTOR =
  '.game-toolbar, .tool-status, .objective-strip, .status-bar, .hud, .ui-window';
/** The covers that move while a selection settles: windows opening, closing and placing themselves. */
const WINDOW_SELECTOR = '.ui-window';

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const clip = (r: Rect, to: Rect): Rect | null => {
  const x = Math.max(r.x, to.x);
  const y = Math.max(r.y, to.y);
  const width = Math.min(r.x + r.width, to.x + to.width) - x;
  const height = Math.min(r.y + r.height, to.y + to.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
};

/** The largest rectangle of the viewport that no cover overlaps. */
export function largestFreeRect(viewport: Rect, covers: readonly Rect[]): Rect {
  const clipped = covers.flatMap((cover) => clip(cover, viewport) ?? []);
  const xs = [
    ...new Set([
      viewport.x,
      viewport.x + viewport.width,
      ...clipped.flatMap((c) => [c.x, c.x + c.width]),
    ]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      viewport.y,
      viewport.y + viewport.height,
      ...clipped.flatMap((c) => [c.y, c.y + c.height]),
    ]),
  ].sort((a, b) => a - b);
  let best: Rect = { x: viewport.x, y: viewport.y, width: 0, height: 0 };
  for (let left = 0; left < xs.length; left++) {
    for (let right = left + 1; right < xs.length; right++) {
      for (let top = 0; top < ys.length; top++) {
        for (let bottom = top + 1; bottom < ys.length; bottom++) {
          const candidate = {
            x: xs[left],
            y: ys[top],
            width: xs[right] - xs[left],
            height: ys[bottom] - ys[top],
          };
          if (candidate.width * candidate.height <= best.width * best.height) continue;
          if (clipped.some((cover) => overlaps(candidate, cover))) break;
          best = candidate;
        }
      }
    }
  }
  return best;
}

/** A sprite's screen rectangle and the alpha mask drawn into it. */
export interface RailMask extends Rect {
  alphaWidth: number;
  alphaHeight: number;
  alpha: ArrayLike<number>;
}

const containsPoint = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/** Whether every opaque pixel of the masks is on screen and clear of every cover. */
function railsClear(masks: readonly RailMask[], viewport: Rect, covers: readonly Rect[]): boolean {
  for (const mask of masks) {
    for (let i = 0; i < mask.alpha.length; i++) {
      if (mask.alpha[i] === 0) continue;
      const x = mask.x + (((i % mask.alphaWidth) + 0.5) / mask.alphaWidth) * mask.width;
      const y = mask.y + ((Math.floor(i / mask.alphaWidth) + 0.5) / mask.alphaHeight) * mask.height;
      if (!containsPoint(viewport, x, y) || covers.some((cover) => containsPoint(cover, x, y)))
        return false;
    }
  }
  return true;
}

/**
 * The screen shift that brings a piece into the largest free area, centred there, or null when the
 * piece is already in view: its rails (or, without masks, its whole rectangle) are on screen and
 * clear of every cover.
 */
export function revealShift(
  piece: Rect,
  viewport: Rect,
  covers: readonly Rect[],
  masks?: readonly RailMask[],
): { dx: number; dy: number } | null {
  const clear = masks
    ? railsClear(masks, viewport, covers)
    : piece.x >= viewport.x &&
      piece.y >= viewport.y &&
      piece.x + piece.width <= viewport.x + viewport.width &&
      piece.y + piece.height <= viewport.y + viewport.height &&
      !covers.some((cover) => overlaps(piece, cover));
  if (clear) return null;
  const free = largestFreeRect(viewport, covers);
  return {
    dx: free.x + free.width / 2 - (piece.x + piece.width / 2),
    dy: free.y + free.height / 2 - (piece.y + piece.height / 2),
  };
}

/** Screen rectangles of the visible bars, sheets and windows over the canvas. */
export function coverRects(root: ParentNode = document, selector = COVER_SELECTOR): Rect[] {
  const rects: Rect[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(selector)) {
    const r = element.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && Number(getComputedStyle(element).opacity) > 0)
      rects.push({ x: r.left, y: r.top, width: r.width, height: r.height });
  }
  return rects;
}

/** Frames the layout may keep changing (windows opening and placing themselves) before revealing. */
const MAX_SETTLE_FRAMES = 10;
/** Pans per request: one onto the piece's position, one onto its drawn rails once they are in view. */
const MAX_PANS = 2;

/**
 * Pans the camera once to a newly selected track piece when windows, sheets or the screen edge hide
 * it. A request waits for the window layout to settle; otherwise the camera is left to the player.
 */
export class SelectionReveal {
  private pieceId: number | null = null;
  private coversKey = '';
  private frames = 0;
  private pans = 0;
  /** The camera as this left it; a different camera means the player moved it, which wins. */
  private cameraKey: string | null = null;
  private readonly out = new Float64Array(2);

  request(pieceId: number): void {
    this.pieceId = pieceId;
    this.coversKey = '';
    this.frames = 0;
    this.pans = 0;
    this.cameraKey = null;
  }

  update(
    selected: { pieceId: number } | null,
    renderer: Renderer,
    snapshot: Snapshot | null,
    map: { width: number; height: number } | null,
    camera: Camera,
    canvas: DOMRect,
  ): void {
    if (this.pieceId === null || !snapshot || !map) return;
    if (selected?.pieceId !== this.pieceId) {
      this.pieceId = null;
      return;
    }
    const cameraKey = `${camera.x}:${camera.y}:${camera.zoom}:${camera.rotation}`;
    if (this.cameraKey === null) this.cameraKey = cameraKey;
    else if (cameraKey !== this.cameraKey) {
      this.pieceId = null;
      return;
    }
    const key = coverRects(document, WINDOW_SELECTOR)
      .map((r) => `${r.x},${r.y},${r.width},${r.height}`)
      .join(';');
    if (key !== this.coversKey && ++this.frames < MAX_SETTLE_FRAMES) {
      this.coversKey = key;
      return;
    }
    const covers = coverRects();
    const piece = snapshotPiece(snapshot, this.pieceId);
    if (!piece) {
      this.pieceId = null;
      return;
    }
    const viewport = { width: canvas.width, height: canvas.height };
    const targets = renderer
      .objectTargets(snapshot, camera, viewport)
      .filter((target) => target.coasterPart === 'track' && target.pieceId === piece.id);
    let bounds: Rect;
    if (targets.length) {
      const left = Math.min(...targets.map((t) => t.x));
      const top = Math.min(...targets.map((t) => t.y));
      bounds = {
        x: canvas.left + left,
        y: canvas.top + top,
        width: Math.max(...targets.map((t) => t.x + t.width)) - left,
        height: Math.max(...targets.map((t) => t.y + t.height)) - top,
      };
    } else {
      project(
        (piece.x + 0.5) * TILE_UNITS,
        (piece.y + 0.5) * TILE_UNITS,
        piece.z * TRACK_Z_STEP,
        map.width,
        map.height,
        camera.rotation,
        this.out,
      );
      const width = TILE_W * camera.zoom;
      const height = TILE_H * camera.zoom;
      bounds = {
        x: canvas.left + viewport.width / 2 + (this.out[0] - camera.x) * camera.zoom - width / 2,
        y: canvas.top + viewport.height / 2 + (this.out[1] - camera.y) * camera.zoom - height / 2,
        width,
        height,
      };
    }
    const visible = { x: canvas.left, y: canvas.top, ...viewport };
    const masks = targets.map((t) => ({ ...t, x: canvas.left + t.x, y: canvas.top + t.y }));
    const shift = revealShift(bounds, visible, covers, targets.length ? masks : undefined);
    if (!shift || this.pans >= MAX_PANS) {
      this.pieceId = null;
      return;
    }
    camera.x -= shift.dx / camera.zoom;
    camera.y -= shift.dy / camera.zoom;
    this.cameraKey = `${camera.x}:${camera.y}:${camera.zoom}:${camera.rotation}`;
    this.pans++;
    if (targets.length) this.pieceId = null;
  }
}

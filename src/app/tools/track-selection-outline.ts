import type { Camera, Renderer } from '../../render/renderer';
import type { Snapshot } from '../../worker/snapshot';
import { snapshotPiece } from '../../ui/track-selection';
import { drawSpriteOutline } from './object-overlay';

/**
 * Outlines the track piece selected in the construction window over the game canvas, from the same
 * sprite masks both renderers pick with. Redraws only when the piece, its geometry or the camera
 * changes.
 */
export class TrackSelectionOutline {
  private readonly canvas: HTMLCanvasElement;
  private key = '';
  private origin = { x: 0, y: 0 };
  /** Whether the selected piece had any rail sprite in view when the outline was last drawn. */
  private visible = false;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'track-selection-outline';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    parent.append(this.canvas);
  }

  update(
    selected: { rideId: number; pieceId: number } | null,
    renderer: Renderer,
    snapshot: Snapshot | null,
    camera: Camera,
    rect: DOMRect,
  ): void {
    const piece = selected && snapshot ? snapshotPiece(snapshot, selected.pieceId) : null;
    if (!piece || !snapshot) {
      this.canvas.hidden = true;
      this.key = '';
      return;
    }
    const viewport = { width: rect.width, height: rect.height };
    const key = [
      piece.id,
      piece.pieceType,
      piece.x,
      piece.y,
      piece.z,
      piece.dir,
      camera.x,
      camera.y,
      camera.zoom,
      camera.rotation,
      viewport.width,
      viewport.height,
    ].join(':');
    if (key !== this.key) {
      const targets = renderer
        .objectTargets(snapshot, camera, viewport)
        .filter((target) => target.coasterPart === 'track' && target.pieceId === piece.id);
      this.key = key;
      this.visible = targets.length > 0;
      if (this.visible) this.origin = drawSpriteOutline(this.canvas, targets);
    }
    if (!this.visible) {
      this.canvas.hidden = true;
      return;
    }
    this.canvas.style.left = `${rect.left + this.origin.x}px`;
    this.canvas.style.top = `${rect.top + this.origin.y}px`;
    this.canvas.hidden = false;
  }

  dispose(): void {
    this.canvas.remove();
  }
}

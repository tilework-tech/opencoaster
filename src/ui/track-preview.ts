import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { project } from '../render/projection';
import type { Rotation } from '../render/projection';
import type { Camera } from '../render/renderer';
import { TrackResult } from '../sim/track/track-types';
import type { TrackGhost } from './coaster-panel';
import { footprintTiles } from './track-tool';

const VALID_FILL = 'rgba(90, 225, 130, 0.45)';
const INVALID_FILL = 'rgba(235, 80, 70, 0.5)';
const ENTRY_MARK = 'rgba(255, 245, 200, 0.95)';

/** Transparent canvas over the game view that outlines the track piece about to be placed. */
export class TrackPreviewOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly corner = new Float64Array(2);

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'track-preview';
    this.canvas.setAttribute('aria-hidden', 'true');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is unavailable');
    this.ctx = ctx;
    parent.append(this.canvas);
  }

  draw(
    ghost: TrackGhost | null,
    map: { width: number; height: number },
    camera: Camera,
    viewport: { width: number; height: number },
    pixelRatio: number,
  ): void {
    const { canvas, ctx } = this;
    const width = Math.round(viewport.width * pixelRatio);
    const height = Math.round(viewport.height * pixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    if (!ghost) return;

    const fill = ghost.status === TrackResult.Ok ? VALID_FILL : INVALID_FILL;
    const tiles = footprintTiles(
      ghost.piece,
      ghost.placement.x,
      ghost.placement.y,
      ghost.placement.dir,
    );
    const z = ghost.level * Z_STEP;
    ctx.fillStyle = fill;
    ctx.strokeStyle = ENTRY_MARK;
    ctx.lineWidth = 1.5;
    for (const [tx, ty] of tiles) {
      ctx.beginPath();
      this.corners(tx, ty, z, map, camera, viewport, (x, y, first) =>
        first ? ctx.moveTo(x, y) : ctx.lineTo(x, y),
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  dispose(): void {
    this.canvas.remove();
  }

  private corners(
    tx: number,
    ty: number,
    z: number,
    map: { width: number; height: number },
    camera: Camera,
    viewport: { width: number; height: number },
    visit: (x: number, y: number, first: boolean) => void,
  ): void {
    const offsets = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const;
    offsets.forEach(([dx, dy], i) => {
      project(
        (tx + dx) * TILE_UNITS,
        (ty + dy) * TILE_UNITS,
        z,
        map.width,
        map.height,
        camera.rotation as Rotation,
        this.corner,
      );
      visit(
        viewport.width / 2 + (this.corner[0] - camera.x) * camera.zoom,
        viewport.height / 2 + (this.corner[1] - camera.y) * camera.zoom,
        i === 0,
      );
    });
  }
}

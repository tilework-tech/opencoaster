import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { project } from '../render/projection';
import type { Rotation } from '../render/projection';
import type { Camera } from '../render/renderer';
import { TrackResult } from '../sim/track/track-types';
import type { TrackGhost } from './coaster-panel';
import { footprintTiles } from './track-tool';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import type { RideType } from '../sim/rides/ride-types';
import { drawAnchoredSprite } from '../render/canvas-atlas';
import { spritePages } from '../render/sprite-pages';
import type { CanvasAtlas } from '../render/canvas-atlas';
import {
  facilitySpriteKey,
  rideHutSpriteKey,
  rideSpriteFrame,
  rideSpriteKey,
} from '../render/world-art';
import { trackPreviewSprites } from './track-preview-art';

const VALID_FILL = 'rgba(90, 225, 130, 0.45)';
const INVALID_FILL = 'rgba(235, 80, 70, 0.5)';
const ENTRY_MARK = 'rgba(255, 245, 200, 0.95)';

export interface RidePlacementGhost {
  type: RideType;
  x: number;
  y: number;
  facing: number;
  valid: boolean;
  tick: number;
}

/** A tile a refused placement points at; drawn red. */
export interface TileGhost {
  x: number;
  y: number;
}

interface PreviewMap {
  width: number;
  height: number;
  heights?: Uint8Array;
}

/** Transparent canvas over the game view that outlines the track piece about to be placed. */
export class TrackPreviewOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly corner = new Float64Array(2);
  private atlas: CanvasAtlas | null = null;
  private hasContent = false;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'track-preview';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is unavailable');
    this.ctx = ctx;
    parent.append(this.canvas);
    this.atlas = spritePages;
    spritePages.start();
  }

  draw(
    ghost: TrackGhost | null,
    map: PreviewMap,
    camera: Camera,
    viewport: { width: number; height: number },
    pixelRatio: number,
    rideGhost: RidePlacementGhost | null = null,
    tileGhost: TileGhost | null = null,
  ): void {
    const { canvas, ctx } = this;
    if (!ghost && !rideGhost && !tileGhost && !this.hasContent) return;
    const width = Math.round(viewport.width * pixelRatio);
    const height = Math.round(viewport.height * pixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    const active = ghost !== null || rideGhost !== null || tileGhost !== null;
    this.hasContent = active;
    canvas.hidden = !active;
    if (rideGhost) this.drawRideGhost(rideGhost, map, camera, viewport);
    if (tileGhost) this.drawTileGhost(tileGhost, map, camera, viewport);
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
    if (this.atlas) {
      ctx.globalAlpha = 0.72;
      const cells = trackPreviewSprites(
        ghost.rideType,
        ghost.piece.id,
        ghost.placement.dir,
        camera.rotation,
        0,
      );
      for (const cell of cells) {
        project(
          (ghost.placement.x + cell.dx) * TILE_UNITS + TILE_UNITS / 2,
          (ghost.placement.y + cell.dy) * TILE_UNITS + TILE_UNITS / 2,
          z,
          map.width,
          map.height,
          camera.rotation,
          this.corner,
        );
        ctx.save();
        ctx.translate(
          viewport.width / 2 + (this.corner[0] - camera.x) * camera.zoom,
          viewport.height / 2 + (this.corner[1] - camera.y) * camera.zoom,
        );
        ctx.scale(camera.zoom * 0.75, camera.zoom * 0.75);
        drawAnchoredSprite(ctx, this.atlas, cell.key, 0, 0);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawTileGhost(
    ghost: TileGhost,
    map: PreviewMap,
    camera: Camera,
    viewport: { width: number; height: number },
  ): void {
    const { x, y } = ghost;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    const z = (map.heights?.[y * map.width + x] ?? 0) * Z_STEP;
    ctxPath(this.ctx, INVALID_FILL, ENTRY_MARK, (visit) =>
      this.corners(x, y, z, map, camera, viewport, visit),
    );
  }

  private drawRideGhost(
    ghost: RidePlacementGhost,
    map: PreviewMap,
    camera: Camera,
    viewport: { width: number; height: number },
  ): void {
    const x = ghost.x;
    const y = ghost.y;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    const z = (map.heights?.[y * map.width + x] ?? 0) * Z_STEP;
    ctxPath(this.ctx, ghost.valid ? VALID_FILL : INVALID_FILL, ENTRY_MARK, (visit) =>
      this.corners(x, y, z, map, camera, viewport, visit),
    );
    if (!this.atlas) return;
    const def = RIDE_CATALOG[ghost.type];
    const key = def.usesTrack
      ? rideHutSpriteKey(ghost.type, 'entrance', ghost.facing, camera.rotation)
      : ['shop', 'stall', 'facility'].includes(def.category)
        ? facilitySpriteKey(ghost.type, ghost.facing, camera.rotation)
        : rideSpriteKey(ghost.type, camera.rotation);
    const entry = this.atlas.resolve(key);
    const frameCount = entry?.frames.length ?? 1;
    project(
      x * TILE_UNITS + TILE_UNITS / 2,
      y * TILE_UNITS + TILE_UNITS / 2,
      z,
      map.width,
      map.height,
      camera.rotation,
      this.corner,
    );
    this.ctx.save();
    this.ctx.translate(
      viewport.width / 2 + (this.corner[0] - camera.x) * camera.zoom,
      viewport.height / 2 + (this.corner[1] - camera.y) * camera.zoom,
    );
    this.ctx.scale(camera.zoom * 0.62, camera.zoom * 0.62);
    drawAnchoredSprite(this.ctx, this.atlas, key, 0, 0, rideSpriteFrame(0, ghost.tick, frameCount));
    this.ctx.restore();
  }

  dispose(): void {
    this.canvas.remove();
    this.atlas = null;
  }

  private corners(
    tx: number,
    ty: number,
    z: number,
    map: PreviewMap,
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

function ctxPath(
  ctx: CanvasRenderingContext2D,
  fill: string,
  stroke: string,
  draw: (visit: (x: number, y: number, first: boolean) => void) => void,
): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  draw((x, y, first) => (first ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

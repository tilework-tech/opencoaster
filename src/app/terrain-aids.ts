import { worldToScreen } from '../render/projection';
import type { Rotation } from '../render/projection';
import { heightMarkPlacements } from '../render/height-marks';
import type { HeightMarkKind, HeightMarkMap } from '../render/height-marks';

/** Where the construction marker stands: a tile and the level the next piece is built at. */
export interface ConstructionTarget {
  x: number;
  y: number;
  level: number;
}

export interface TerrainAidFrame {
  map: HeightMarkMap | null;
  camera: { x: number; y: number; zoom: number; rotation: Rotation };
  viewport: { width: number; height: number };
  pixelRatio: number;
  heightMarks: boolean;
  construction: ConstructionTarget | null;
}

const MARK_COLOURS: Record<HeightMarkKind, string> = {
  land: '#ffffff',
  path: '#ffe58a',
  water: '#a8e6ff',
};
const MARKER_COLOUR = 'rgba(255, 236, 120, 0.95)';
const MARKER_OUTLINE = 'rgba(10, 14, 8, 0.85)';
/** Levels the pole rises above the build level so it reads even when built at ground level. */
const POLE_FLAG = 1.5;
const MARKER_FILL = 'rgba(255, 236, 120, 0.18)';

/** Font size, in CSS pixels, of height numbers at a camera zoom. */
export function heightMarkFontSize(zoom: number): number {
  return Math.round(Math.max(9, Math.min(16, 10 * Math.sqrt(zoom))));
}

/**
 * Transparent canvas over the game view for the terrain-reading aids: small height numbers on
 * land, water and paths, and a vertical marker from the ground to the level being built at. It
 * redraws only when its inputs change.
 */
export class TerrainAidOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private lastKey = '';
  private lastMap: HeightMarkMap | null = null;
  private hasContent = false;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'terrain-aids';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is unavailable');
    this.ctx = ctx;
    parent.append(this.canvas);
  }

  draw(frame: TerrainAidFrame): void {
    const { map, camera, viewport, pixelRatio, heightMarks, construction } = frame;
    const active = map !== null && (heightMarks || construction !== null);
    if (!active && !this.hasContent) return;
    const key = [
      camera.x,
      camera.y,
      camera.zoom,
      camera.rotation,
      viewport.width,
      viewport.height,
      pixelRatio,
      heightMarks,
      construction ? `${construction.x},${construction.y},${construction.level}` : '',
    ].join('|');
    if (map === this.lastMap && key === this.lastKey) return;
    this.lastMap = map;
    this.lastKey = key;
    const { canvas, ctx } = this;
    const width = Math.round(viewport.width * pixelRatio);
    const height = Math.round(viewport.height * pixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    this.hasContent = active;
    canvas.hidden = !active;
    if (!map) return;
    if (heightMarks) this.drawHeightMarks(map, camera, viewport);
    if (construction) this.drawConstructionMarker(map, camera, viewport, construction);
  }

  dispose(): void {
    this.canvas.remove();
  }

  private drawHeightMarks(
    map: HeightMarkMap,
    camera: TerrainAidFrame['camera'],
    viewport: TerrainAidFrame['viewport'],
  ): void {
    const { ctx } = this;
    ctx.font = `bold ${heightMarkFontSize(camera.zoom)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(10, 14, 8, 0.85)';
    for (const mark of heightMarkPlacements(map, camera, viewport)) {
      ctx.fillStyle = MARK_COLOURS[mark.kind];
      ctx.strokeText(mark.text, mark.x, mark.y);
      ctx.fillText(mark.text, mark.x, mark.y);
    }
  }

  private screen(
    map: HeightMarkMap,
    camera: TerrainAidFrame['camera'],
    viewport: TerrainAidFrame['viewport'],
    x: number,
    y: number,
    z: number,
  ): [number, number] {
    const [wx, wy] = worldToScreen(x, y, z, camera.rotation, map);
    return [
      viewport.width / 2 + (wx - camera.x) * camera.zoom,
      viewport.height / 2 + (wy - camera.y) * camera.zoom,
    ];
  }

  private drawConstructionMarker(
    map: HeightMarkMap,
    camera: TerrainAidFrame['camera'],
    viewport: TerrainAidFrame['viewport'],
    target: ConstructionTarget,
  ): void {
    const { ctx } = this;
    const index = target.y * map.width + target.x;
    const mask = map.slope[index] ?? 0;
    const rise = ((mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1)) / 4;
    const ground = (map.heights[index] ?? 0) + rise;
    const at = (x: number, y: number, z: number) => this.screen(map, camera, viewport, x, y, z);
    const [gx, gy] = at(target.x + 0.5, target.y + 0.5, ground);
    const [tx, ty] = at(target.x + 0.5, target.y + 0.5, target.level);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.fillStyle = MARKER_FILL;
    ctx.strokeStyle = MARKER_COLOUR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const corners = [
      at(target.x, target.y, target.level),
      at(target.x + 1, target.y, target.level),
      at(target.x + 1, target.y + 1, target.level),
      at(target.x, target.y + 1, target.level),
    ];
    corners.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const [hx, hy] = at(target.x + 0.5, target.y + 0.5, Math.max(ground, target.level) + POLE_FLAG);
    ctx.setLineDash([]);
    const pole = (): void => {
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(hx, hy);
      ctx.stroke();
    };
    ctx.strokeStyle = MARKER_OUTLINE;
    ctx.lineWidth = 5;
    pole();
    ctx.strokeStyle = MARKER_COLOUR;
    ctx.lineWidth = 2.5;
    pole();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const low = Math.min(ground, target.level);
    const high = Math.max(ground, target.level);
    for (let level = Math.ceil(low); level <= high; level++) {
      const [x, y] = at(target.x + 0.5, target.y + 0.5, level);
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 4, y);
    }
    ctx.stroke();
    ctx.font = `bold ${heightMarkFontSize(camera.zoom)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(10, 14, 8, 0.85)';
    ctx.fillStyle = MARKER_COLOUR;
    ctx.strokeText(String(target.level), tx + 7, ty);
    ctx.fillText(String(target.level), tx + 7, ty);
  }
}

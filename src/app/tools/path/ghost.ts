import { project } from '../../../render/projection';
import type { Camera } from '../../../render/renderer';
import { TILE_UNITS, Z_STEP } from '../../../sim/core/constants';
import type { PathPiecePreview } from '../../../sim/map/map-commands';
import { PathResult } from '../../../sim/map/paths';
import type { Tile } from './run';

export type GhostTone = 'ok' | 'refused' | 'paved' | 'pending';

export interface GhostItem {
  tile: Tile;
  tone: GhostTone;
  /** The sim's answer for this tile; present once a preview has arrived. */
  piece?: PathPiecePreview;
}

export interface GhostMap {
  width: number;
  height: number;
  heights: Uint8Array;
}

export interface GhostLabel {
  text: string;
  tone: 'ok' | 'refused';
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Tile corners in order (x,y), (x+1,y), (x+1,y+1), (x,y+1), in tile units. */
const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/** Edge midpoints by direction (0 = +x, 1 = +y, 2 = -x, 3 = -y), with the two corners each joins. */
const EDGES: ReadonlyArray<{ mx: number; my: number; a: number; b: number }> = [
  { mx: 1, my: 0.5, a: 1, b: 2 },
  { mx: 0.5, my: 1, a: 2, b: 3 },
  { mx: 0, my: 0.5, a: 3, b: 0 },
  { mx: 0.5, my: 0, a: 0, b: 1 },
];

/** Corner levels of a piece at base `z` rising toward `dir`; a flat piece has one level. */
export function pieceCornerLevels(z: number, dir: number): number[] {
  switch (dir) {
    case 0:
      return [z, z + 1, z + 1, z];
    case 1:
      return [z, z, z + 1, z + 1];
    case 2:
      return [z + 1, z, z, z + 1];
    case 3:
      return [z + 1, z + 1, z, z];
    default:
      return [z, z, z, z];
  }
}

/**
 * Draws the footpath preview over the map. Each previewed piece is drawn where the sim would put
 * it: its base level and slope, the edges it joins to its neighbours, and its queue rails. Tiles
 * without a piece get a flat outline on the ground.
 */
export class PathGhost {
  private readonly svg = document.createElementNS(SVG_NS, 'svg');
  private readonly label = document.createElement('div');

  constructor(parent: HTMLElement) {
    this.svg.setAttribute('class', 'path-ghost');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.style.display = 'none';
    this.label.className = 'path-ghost-label';
    this.label.setAttribute('role', 'status');
    this.label.hidden = true;
    parent.append(this.svg, this.label);
  }

  /** Redraws the preview; pieces are placed with the camera the map is currently drawn with. */
  show(
    items: readonly GhostItem[],
    map: GhostMap,
    camera: Camera,
    canvas: DOMRect,
    cursor: { clientX: number; clientY: number },
    label: GhostLabel | null,
  ): void {
    this.svg.replaceChildren();
    this.svg.setAttribute('width', String(canvas.width));
    this.svg.setAttribute('height', String(canvas.height));
    this.svg.style.left = `${canvas.left}px`;
    this.svg.style.top = `${canvas.top}px`;
    this.svg.style.display = items.length === 0 ? 'none' : '';
    const out = new Float64Array(2);
    const toScreen = (tx: number, ty: number, level: number): [number, number] => {
      project(
        tx * TILE_UNITS,
        ty * TILE_UNITS,
        level * Z_STEP,
        map.width,
        map.height,
        camera.rotation,
        out,
      );
      return [
        canvas.width / 2 + (out[0]! - camera.x) * camera.zoom,
        canvas.height / 2 + (out[1]! - camera.y) * camera.zoom,
      ];
    };
    for (const item of items) this.drawItem(item, map, toScreen);
    this.label.hidden = label === null;
    if (label) {
      this.label.textContent = label.text;
      this.label.dataset.tone = label.tone;
      this.label.style.left = `${cursor.clientX + 14}px`;
      this.label.style.top = `${cursor.clientY + 14}px`;
    }
  }

  hide(): void {
    this.svg.style.display = 'none';
    this.label.hidden = true;
  }

  dispose(): void {
    this.svg.remove();
    this.label.remove();
  }

  private drawItem(
    item: GhostItem,
    map: GhostMap,
    toScreen: (tx: number, ty: number, level: number) => [number, number],
  ): void {
    const { x, y } = item.tile;
    const piece = item.piece?.result === PathResult.Ok ? item.piece : undefined;
    const ground = map.heights[y * map.width + x]!;
    const base = piece ? piece.z : ground;
    const dir = piece ? piece.dir : -1;
    const levels = pieceCornerLevels(base, dir);
    const points = CORNERS.map(([cx, cy], k) => toScreen(x + cx, y + cy, levels[k]!));
    const shape = document.createElementNS(SVG_NS, 'polygon');
    shape.setAttribute('class', `path-ghost-tile path-ghost-${item.tone}`);
    shape.setAttribute('points', points.map(([px, py]) => `${px},${py}`).join(' '));
    shape.dataset.x = String(x);
    shape.dataset.y = String(y);
    shape.dataset.tone = item.tone;
    if (piece) {
      shape.dataset.z = String(piece.z);
      shape.dataset.dir = String(piece.dir);
      shape.dataset.style = String(piece.style);
      shape.dataset.queue = String(piece.queue);
      shape.dataset.edges = String(piece.edges);
    }
    this.svg.append(shape);
    if (!piece) return;

    const centre = toScreen(x + 0.5, y + 0.5, levels.reduce((sum, level) => sum + level, 0) / 4);
    EDGES.forEach((edge, d) => {
      if (!(piece.edges & (1 << d))) return;
      const level = (levels[edge.a]! + levels[edge.b]!) / 2;
      const [ex, ey] = toScreen(x + edge.mx, y + edge.my, level);
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', 'path-ghost-edge');
      line.setAttribute('x1', String(centre[0]));
      line.setAttribute('y1', String(centre[1]));
      line.setAttribute('x2', String(ex));
      line.setAttribute('y2', String(ey));
      line.dataset.dir = String(d);
      this.svg.append(line);
    });
    if (piece.queue) {
      for (const ry of [0.3, 0.7]) {
        const [x1, y1] = toScreen(x + 0.15, y + ry, base);
        const [x2, y2] = toScreen(x + 0.85, y + ry, base);
        const rail = document.createElementNS(SVG_NS, 'line');
        rail.setAttribute('class', 'path-ghost-rail');
        rail.setAttribute('x1', String(x1));
        rail.setAttribute('y1', String(y1));
        rail.setAttribute('x2', String(x2));
        rail.setAttribute('y2', String(y2));
        this.svg.append(rail);
      }
    }
  }
}

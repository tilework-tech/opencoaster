import { project } from '../../../render/projection';
import type { Camera } from '../../../render/renderer';
import { TILE_UNITS, Z_STEP } from '../../../sim/core/constants';
import type { PathPiecePreview } from '../../../sim/map/map-commands';
import { PathResult, QueueLink } from '../../../sim/map/paths';
import { PathFlag, SLOPE_DIR_SHIFT } from '../../../sim/map/tile-map';
import type { PathPieceGhost } from '../../../render/renderer';
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

/**
 * The footpath pieces to draw in the world for a preview: accepted pieces as the sim laid them out,
 * refused tiles flat on the ground in the chosen surface. Paved and still-pending tiles are left out.
 */
export function pathPieceGhosts(
  items: readonly GhostItem[],
  map: GhostMap,
  style: number,
  queue = false,
): PathPieceGhost[] {
  const ghosts: PathPieceGhost[] = [];
  for (const item of items) {
    const { x, y } = item.tile;
    if (item.tone === 'ok' && item.piece) {
      const { piece } = item;
      const slope = piece.dir >= 0 ? PathFlag.Sloped | (piece.dir << SLOPE_DIR_SHIFT) : 0;
      ghosts.push({
        x,
        y,
        level: piece.z,
        flags: piece.edges | (piece.queue ? PathFlag.Queue : 0) | slope,
        surface: piece.style,
        tone: 'ok',
      });
    } else if (item.tone === 'refused') {
      ghosts.push({
        x,
        y,
        level: map.heights[y * map.width + x]!,
        flags: queue ? PathFlag.Queue : 0,
        surface: style,
        tone: 'refused',
      });
    }
  }
  return ghosts;
}

/** Tile corners in order (x,y), (x+1,y), (x+1,y+1), (x,y+1), in tile units. */
const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
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
 * Outlines the footpath preview over the map. The piece art itself is drawn in the world by the
 * renderer (see `pathPieceGhosts`); each outline sits where that art lands, so the ground tile it
 * marks matches the piece that will be built.
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
    direction?: number,
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
    if (direction !== undefined && items.length === 1)
      this.drawDirection(items[0]!.tile, items[0]!.piece?.z ?? 0, direction, toScreen);
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
    if (!piece?.queue) return;
    const cx = points.reduce((sum, [px]) => sum + px, 0) / points.length;
    const cy = points.reduce((sum, [, py]) => sum + py, 0) / points.length;
    const marker = document.createElementNS(SVG_NS, 'circle');
    marker.setAttribute('class', 'path-ghost-link');
    marker.setAttribute('cx', String(cx));
    marker.setAttribute('cy', String(cy));
    marker.setAttribute('r', '5');
    marker.dataset.link = String(piece.link);
    marker.dataset.entrance = String((piece.link & QueueLink.Entrance) !== 0);
    marker.dataset.openEnd = String((piece.link & QueueLink.OpenEnd) !== 0);
    this.svg.append(marker);
  }

  private drawDirection(
    tile: Tile,
    level: number,
    direction: number,
    toScreen: (tx: number, ty: number, level: number) => [number, number],
  ): void {
    const [cx, cy] = toScreen(tile.x + 0.5, tile.y + 0.5, level);
    const [nx, ny] = toScreen(
      tile.x + 0.5 + (direction === 0 ? 1 : direction === 2 ? -1 : 0),
      tile.y + 0.5 + (direction === 1 ? 1 : direction === 3 ? -1 : 0),
      level,
    );
    const length = Math.hypot(nx - cx, ny - cy);
    if (length === 0) return;
    const ux = (nx - cx) / length;
    const uy = (ny - cy) / length;
    const tipX = cx + ux * 25;
    const tipY = cy + uy * 25;
    const headX = tipX - ux * 7;
    const headY = tipY - uy * 7;
    const side = 4;
    const shape = document.createElementNS(SVG_NS, 'path');
    shape.setAttribute('class', 'path-ghost-arrow');
    shape.setAttribute(
      'd',
      `M ${cx} ${cy} L ${tipX} ${tipY} M ${tipX} ${tipY} L ${headX - uy * side} ${headY + ux * side} M ${tipX} ${tipY} L ${headX + uy * side} ${headY - ux * side}`,
    );
    this.svg.append(shape);
  }
}

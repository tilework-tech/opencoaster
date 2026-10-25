import { project, Z_PIXELS } from '../render/projection';
import type { Rotation } from '../render/projection';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import type { LandPlan } from '../sim/map/land-tool';
import { LandResult } from '../sim/map/land-tool';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CORNER_DX = [0, 1, 1, 0];
const CORNER_DY = [0, 0, 1, 1];

interface OverlayMap {
  width: number;
  height: number;
  heights: Uint8Array;
  slope: Uint8Array;
}

interface OverlayCamera {
  x: number;
  y: number;
  zoom: number;
  rotation: Rotation;
}

export interface LandOverlayState {
  map: OverlayMap;
  camera: OverlayCamera;
  viewport: { width: number; height: number };
  /** Selected square (tiles clipped to the map) and the corner mask within a single tile. */
  selection: { x: number; y: number; width: number; height: number; corners: number };
  /** The worker's answer for this selection, or null while it is pending. */
  plan: LandPlan | null;
  /** Tile a recent refusal points at. */
  flagged?: number;
}

/**
 * SVG layer over the game view showing what a land edit will touch: the selected tiles or
 * corners, tiles it reshapes beside them, a stem on every vertex that moves, and in red the
 * tile that blocks it.
 */
export class LandOverlay {
  private readonly svg: SVGSVGElement;
  private readonly point = new Float64Array(2);
  private signature = '';

  constructor(parent: HTMLElement) {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.classList.add('land-overlay');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.setAttribute('hidden', '');
    parent.append(this.svg);
  }

  clear(): void {
    this.signature = '';
    this.svg.setAttribute('hidden', '');
    this.svg.replaceChildren();
  }

  draw(state: LandOverlayState): void {
    const { camera, viewport, selection, plan, flagged } = state;
    const signature = [
      camera.x,
      camera.y,
      camera.zoom,
      camera.rotation,
      viewport.width,
      viewport.height,
      selection.x,
      selection.y,
      selection.width,
      selection.height,
      selection.corners,
      plan
        ? `${plan.result}:${plan.costCents}:${plan.vertices.length}:${plan.tiles.length}`
        : 'wait',
      flagged ?? -1,
    ].join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.svg.removeAttribute('hidden');
    const nodes: SVGElement[] = [];
    const { map } = state;
    const refused = plan !== null && plan.result !== LandResult.Ok;
    const selected = new Set<number>();
    const ordered: number[] = [];
    if (plan && plan.selected.length > 0) for (const t of plan.selected) selected.add(t);
    else
      for (let y = selection.y; y < selection.y + selection.height; y++)
        for (let x = selection.x; x < selection.x + selection.width; x++)
          if (x >= 0 && y >= 0 && x < map.width && y < map.height) selected.add(y * map.width + x);
    const single = selection.width === 1 && selection.height === 1 && selection.corners !== 0b1111;
    if (plan && !refused)
      for (const t of plan.tiles)
        if (!selected.has(t)) {
          ordered.push(t);
          nodes.push(this.tilePolygon(state, t, 'land-spill'));
        }
    for (const t of selected) {
      if (single) nodes.push(this.tilePolygon(state, t, 'land-sel land-single'));
      else nodes.push(this.tilePolygon(state, t, refused ? 'land-sel land-bad' : 'land-sel'));
    }
    if (single) nodes.push(...this.cornerMarks(state, [...selected][0], refused));
    if (flagged !== undefined && flagged >= 0 && flagged < map.width * map.height)
      nodes.push(this.tilePolygon(state, flagged, 'land-block'));
    else if (refused && plan.subject >= 0)
      nodes.push(this.tilePolygon(state, plan.subject, 'land-block'));
    if (plan && !refused) nodes.push(...this.stems(state, plan));
    this.svg.replaceChildren(...nodes);
  }

  private corner(state: LandOverlayState, vx: number, vy: number, level: number): [number, number] {
    const { camera, viewport, map } = state;
    project(
      vx * TILE_UNITS,
      vy * TILE_UNITS,
      level * Z_STEP,
      map.width,
      map.height,
      camera.rotation,
      this.point,
    );
    return [
      viewport.width / 2 + (this.point[0] - camera.x) * camera.zoom,
      viewport.height / 2 + (this.point[1] - camera.y) * camera.zoom,
    ];
  }

  private cornerLevel(map: OverlayMap, tile: number, c: number): number {
    return map.heights[tile] + ((map.slope[tile] >> c) & 1);
  }

  private tilePolygon(state: LandOverlayState, tile: number, className: string): SVGPolygonElement {
    const { map } = state;
    const tx = tile % map.width;
    const ty = Math.floor(tile / map.width);
    const points = [0, 1, 2, 3].map((c) =>
      this.corner(state, tx + CORNER_DX[c], ty + CORNER_DY[c], this.cornerLevel(map, tile, c)).join(
        ',',
      ),
    );
    const polygon = document.createElementNS(SVG_NS, 'polygon');
    polygon.setAttribute('class', className);
    polygon.setAttribute('points', points.join(' '));
    polygon.dataset.tile = String(tile);
    return polygon;
  }

  private cornerMarks(state: LandOverlayState, tile: number, refused: boolean): SVGElement[] {
    const { map, selection } = state;
    const tx = tile % map.width;
    const ty = Math.floor(tile / map.width);
    const marks: SVGElement[] = [];
    const chosen: Array<[number, number]> = [];
    for (let c = 0; c < 4; c++) {
      if (!(selection.corners & (1 << c))) continue;
      chosen.push(
        this.corner(state, tx + CORNER_DX[c], ty + CORNER_DY[c], this.cornerLevel(map, tile, c)),
      );
    }
    const cls = refused ? 'land-corner land-bad' : 'land-corner';
    if (chosen.length === 2) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', `${cls} land-edge`);
      line.setAttribute('x1', String(chosen[0][0]));
      line.setAttribute('y1', String(chosen[0][1]));
      line.setAttribute('x2', String(chosen[1][0]));
      line.setAttribute('y2', String(chosen[1][1]));
      line.dataset.corners = String(selection.corners);
      marks.push(line);
    }
    chosen.forEach(([x, y]) => {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('class', cls);
      dot.setAttribute('cx', String(x));
      dot.setAttribute('cy', String(y));
      dot.setAttribute('r', '6');
      dot.dataset.corners = String(selection.corners);
      marks.push(dot);
    });
    return marks;
  }

  private stems(state: LandOverlayState, plan: LandPlan): SVGElement[] {
    const { map, camera } = state;
    const w1 = map.width + 1;
    const out: SVGElement[] = [];
    for (let k = 0; k < plan.vertices.length; k++) {
      const v = plan.vertices[k];
      const vx = v % w1;
      const vy = Math.floor(v / w1);
      let level = 0;
      for (const [dx, dy] of [
        [0, 0],
        [-1, 0],
        [0, -1],
        [-1, -1],
      ] as const) {
        const tx = vx + dx;
        const ty = vy + dy;
        if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
        const tile = ty * map.width + tx;
        const c = CORNER_DX.findIndex((cx, i) => tx + cx === vx && ty + CORNER_DY[i] === vy);
        level = this.cornerLevel(map, tile, c);
        break;
      }
      const [x, y] = this.corner(state, vx, vy, level);
      const delta = plan.deltas[k];
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', delta > 0 ? 'land-stem land-up' : 'land-stem land-down');
      line.setAttribute('x1', String(x));
      line.setAttribute('y1', String(y));
      line.setAttribute('x2', String(x));
      line.setAttribute('y2', String(y - delta * Z_PIXELS * camera.zoom));
      line.dataset.vertex = String(v);
      line.dataset.delta = String(delta);
      out.push(line);
    }
    return out;
  }
}

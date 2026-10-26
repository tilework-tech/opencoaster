import { project } from '../render/projection';
import type { Rotation } from '../render/projection';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import type { AreaPlan } from '../sim/map/area-tools';
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

export interface AreaOverlayState {
  map: OverlayMap;
  camera: { x: number; y: number; zoom: number; rotation: Rotation };
  viewport: { width: number; height: number };
  tool: 'clear' | 'water';
  /** Selected square and the tile under the pointer. */
  selection: {
    x: number;
    y: number;
    width: number;
    height: number;
    cursorX: number;
    cursorY: number;
  };
  /** The worker's answer for this selection, or null while it is pending. */
  plan: AreaPlan | null;
  /** Tile a recent refusal points at. */
  flagged?: number;
}

/**
 * SVG layer over the game view for the Clear scenery and Water tools: the selected tiles, the
 * tiles that will be cleared or the water surface each changed tile will get, and in red the
 * tile that blocks the edit.
 */
export class AreaOverlay {
  private readonly svg: SVGSVGElement;
  private readonly point = new Float64Array(2);
  private signature = '';

  constructor(parent: HTMLElement) {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.classList.add('area-overlay');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.setAttribute('hidden', '');
    parent.append(this.svg);
  }

  clear(): void {
    this.signature = '';
    this.svg.setAttribute('hidden', '');
    this.svg.replaceChildren();
  }

  draw(state: AreaOverlayState): void {
    const { camera, viewport, selection, plan, flagged, map } = state;
    const signature = [
      camera.x,
      camera.y,
      camera.zoom,
      camera.rotation,
      viewport.width,
      viewport.height,
      state.tool,
      selection.x,
      selection.y,
      selection.width,
      selection.height,
      selection.cursorX,
      selection.cursorY,
      plan ? `${plan.result}:${plan.costCents}:${plan.level}:${plan.tiles.join(',')}` : 'wait',
      flagged ?? -1,
    ].join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.svg.removeAttribute('hidden');
    const refused = plan !== null && plan.result !== LandResult.Ok;
    const selected: number[] = [];
    if (plan && plan.selected.length > 0) selected.push(...plan.selected);
    else
      for (let y = selection.y; y < selection.y + selection.height; y++)
        for (let x = selection.x; x < selection.x + selection.width; x++)
          if (x >= 0 && y >= 0 && x < map.width && y < map.height) selected.push(y * map.width + x);
    const nodes: SVGElement[] = selected.map((t) =>
      this.tilePolygon(state, t, refused ? 'area-sel area-bad' : 'area-sel'),
    );
    if (plan && !refused)
      for (const t of plan.tiles)
        nodes.push(
          state.tool === 'clear'
            ? this.tilePolygon(state, t, 'area-hit')
            : this.tilePolygon(state, t, 'area-water', plan.level),
        );
    const cursor = selection.cursorY * map.width + selection.cursorX;
    nodes.push(this.tilePolygon(state, cursor, 'area-cursor'));
    const block = flagged !== undefined && flagged >= 0 ? flagged : refused ? plan.subject : -1;
    if (block >= 0 && block < map.width * map.height)
      nodes.push(this.tilePolygon(state, block, 'area-block'));
    this.svg.replaceChildren(...nodes);
  }

  /** Outline of a tile on the ground, or flat at `level` when one is given. */
  private tilePolygon(
    state: AreaOverlayState,
    tile: number,
    className: string,
    level?: number,
  ): SVGPolygonElement {
    const { map, camera, viewport } = state;
    const tx = tile % map.width;
    const ty = Math.floor(tile / map.width);
    const points = [0, 1, 2, 3].map((c) => {
      const ground = map.heights[tile] + ((map.slope[tile] >> c) & 1);
      project(
        (tx + CORNER_DX[c]) * TILE_UNITS,
        (ty + CORNER_DY[c]) * TILE_UNITS,
        Math.max(ground, level ?? 0) * Z_STEP,
        map.width,
        map.height,
        camera.rotation,
        this.point,
      );
      return [
        viewport.width / 2 + (this.point[0] - camera.x) * camera.zoom,
        viewport.height / 2 + (this.point[1] - camera.y) * camera.zoom,
      ].join(',');
    });
    const polygon = document.createElementNS(SVG_NS, 'polygon');
    polygon.setAttribute('class', className);
    polygon.setAttribute('points', points.join(' '));
    polygon.dataset.tile = String(tile);
    if (level !== undefined) polygon.dataset.level = String(level);
    return polygon;
  }
}

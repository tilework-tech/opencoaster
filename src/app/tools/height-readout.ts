import { viewTerrainCornerHeights } from '../../render/terrain-geometry';
import type { Rotation } from '../../render/projection';
import type { LandMode, ToolMode } from '../../ui/ui-types';

export interface ReadoutMap {
  width: number;
  heights: Uint8Array;
  slope: Uint8Array;
  waterLevel?: Uint8Array;
}

export interface ReadoutContext {
  tool: ToolMode;
  rotation: Rotation;
  landMode?: LandMode;
  waterLower?: boolean;
  /** Level a track piece would start at, when the track tool has a ghost. */
  trackLevel?: number;
}

const MAX_LEVEL = 31;

/** Corner heights of a tile in view order: top, right, bottom, left. */
export function tileCornerLevels(
  map: ReadoutMap,
  x: number,
  y: number,
  rotation: Rotation,
): [number, number, number, number] {
  const index = y * map.width + x;
  const base = map.heights[index]!;
  const mask = map.slope[index]!;
  return viewTerrainCornerHeights(
    [
      base + (mask & 1),
      base + ((mask >> 1) & 1),
      base + ((mask >> 2) & 1),
      base + ((mask >> 3) & 1),
    ],
    rotation,
  );
}

/**
 * Cursor readout for a tile: its base height, corner heights when it slopes, any water level, and
 * for construction tools the level the action would build at.
 */
export function heightReadoutText(
  map: ReadoutMap,
  tile: readonly [number, number],
  context: ReadoutContext,
): string {
  const [x, y] = tile;
  const index = y * map.width + x;
  const base = map.heights[index]!;
  const corners = tileCornerLevels(map, x, y, context.rotation);
  const top = Math.max(...corners);
  const water = map.waterLevel?.[index] ?? 0;
  const parts = [`Height ${base}`];
  if (map.slope[index]) parts.push(`corners ${corners.join('/')}`);
  if (water > base) parts.push(`water ${water}`);
  switch (context.tool) {
    case 'land':
      if (context.landMode === 'raise') parts.push(`raise to ${Math.min(MAX_LEVEL, top + 1)}`);
      else if (context.landMode === 'lower')
        parts.push(`lower to ${Math.max(0, Math.min(...corners) - 1)}`);
      else if (context.landMode === 'flatten') parts.push(`flatten to ${base}`);
      break;
    case 'water': {
      const current = water > base ? water : 0;
      const next = context.waterLower
        ? Math.max(0, current - 1)
        : Math.min(MAX_LEVEL, current > 0 ? current + 1 : base + 1);
      parts.push(`water to ${next}`);
      break;
    }
    case 'path':
      parts.push(`path at ${base}`);
      break;
    case 'track':
      parts.push(`track at ${context.trackLevel ?? base}`);
      break;
    default:
      break;
  }
  return parts.join(' · ');
}

const TIP_OFFSET_X = 14;
const TIP_OFFSET_Y = 40;
const TIP_HEIGHT = 26;

/** Small tooltip beside the cursor that carries the height readout of the tile under it. */
export class HeightReadoutTip {
  private readonly tip: HTMLElement;

  constructor(parent: HTMLElement) {
    this.tip = document.createElement('div');
    this.tip.className = 'height-readout';
    this.tip.setAttribute('aria-hidden', 'true');
    this.tip.hidden = true;
    parent.append(this.tip);
  }

  show(text: string, clientX: number, clientY: number): void {
    if (this.tip.textContent !== text) this.tip.textContent = text;
    const below = clientY + TIP_OFFSET_Y + TIP_HEIGHT <= window.innerHeight;
    this.tip.style.left = `${clientX + TIP_OFFSET_X}px`;
    this.tip.style.top = `${below ? clientY + TIP_OFFSET_Y : clientY - TIP_OFFSET_Y}px`;
    this.tip.hidden = false;
  }

  hide(): void {
    this.tip.hidden = true;
  }

  dispose(): void {
    this.tip.remove();
  }
}

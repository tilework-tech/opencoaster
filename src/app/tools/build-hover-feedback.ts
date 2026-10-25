import type { ToolMode } from '../../ui/ui-types';
import type { TileGhost } from '../../ui/track-preview';

const BUILD_TOOLS = new Set<ToolMode>([
  'land',
  'path',
  'scenery',
  'bin',
  'bench',
  'shelter',
  'flowerbed',
  'lamp',
  'ride',
  'track',
]);

/** Red hover parcel shown whenever a build tool targets land the park cannot build on. */
export function buildHoverGhost(
  tool: ToolMode,
  tile: readonly [number, number] | null,
  mapWidth: number,
  mapHeight: number,
  buildable: Uint8Array | undefined,
): TileGhost | null {
  if (!BUILD_TOOLS.has(tool) || !tile) return null;
  const [x, y] = tile;
  if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) return null;
  if (!buildable) return null;
  return buildable[y * mapWidth + x] ? null : { x, y };
}

export class BuildHoverFeedback {
  private readonly tip: HTMLDivElement;
  private x = 0;
  private y = 0;

  constructor(parent: HTMLElement) {
    this.tip = document.createElement('div');
    this.tip.className = 'build-hover-tip';
    this.tip.setAttribute('role', 'status');
    this.tip.hidden = true;
    parent.append(this.tip);
  }

  pointAt(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  update(ghost: TileGhost | null): void {
    this.tip.hidden = ghost === null;
    if (!ghost) return;
    if (this.tip.textContent !== 'Land not owned by park')
      this.tip.textContent = 'Land not owned by park';
    this.tip.style.left = `${Math.max(4, Math.min(window.innerWidth - 268, this.x + 14))}px`;
    this.tip.style.top = `${Math.max(4, Math.min(window.innerHeight - 32, this.y + 14))}px`;
  }

  dispose(): void {
    this.tip.remove();
  }
}

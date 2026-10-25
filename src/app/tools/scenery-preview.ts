import { formatMoney } from '../../ui/format';
import type { SpriteGhost } from '../../render/renderer';
import { scenerySpriteName } from '../../render/world-art';
import { SCENERY_CATALOG, SceneryResult } from '../../sim/map/scenery';
import type { SceneryItem } from '../../sim/map/scenery';
import type { SimClient } from '../../worker/sim-client';

/** How long a preview answer may be reused before the sim is asked again, ms (cash can change). */
const REFRESH_MS = 500;

const REFUSAL_TEXT: Readonly<Record<number, string>> = {
  [SceneryResult.Invalid]: 'Scenery cannot go here.',
  [SceneryResult.NotOwned]: 'Buy this land first.',
  [SceneryResult.Underwater]: 'Under water.',
  [SceneryResult.Blocked]: 'Something is in the way.',
  [SceneryResult.InsufficientFunds]: 'Not enough cash.',
};

export interface SceneryHover {
  /** Tile under the pointer and the ground level it stands on. */
  x: number;
  y: number;
  level: number;
  item: SceneryItem;
  rotation: number;
  /** Pointer position in client pixels, where the label sits. */
  clientX: number;
  clientY: number;
}

/**
 * Previews the scenery piece under the pointer. The sim judges each spot with the rules the
 * placement uses, so the ghost is red exactly when the placement would be refused; the label beside
 * the pointer shows the price, or the reason the spot is refused.
 */
export class ScenerySpotPreview {
  private readonly label = document.createElement('div');
  private key = '';
  private lastRequestKey = '';
  private requestedAt = 0;
  private pending = false;
  private result: SceneryResult | null = null;

  constructor(
    parent: HTMLElement,
    private readonly sim: SimClient,
  ) {
    this.label.className = 'path-ghost-label placement-label';
    this.label.setAttribute('role', 'status');
    this.label.hidden = true;
    parent.append(this.label);
  }

  /** Returns the ghost to draw for this hover, or null while the sim has not answered yet. */
  update(hover: SceneryHover | null, now: number): SpriteGhost | null {
    if (!hover) {
      this.hide();
      return null;
    }
    const key = `${hover.x}:${hover.y}:${hover.item}:${hover.rotation}`;
    if (key !== this.key) {
      this.key = key;
      this.result = null;
    }
    const stale = now - this.requestedAt >= REFRESH_MS;
    if (!this.pending && (key !== this.lastRequestKey || stale)) {
      this.pending = true;
      this.lastRequestKey = key;
      this.requestedAt = now;
      void this.sim
        .previewScenery({ x: hover.x, y: hover.y, item: hover.item, rotation: hover.rotation })
        .then((result) => {
          this.pending = false;
          if (key === this.key) this.result = result;
        });
    }
    this.showLabel(hover);
    if (this.result === null) return null;
    return {
      x: hover.x,
      y: hover.y,
      level: hover.level,
      sprite: scenerySpriteName(SCENERY_CATALOG[hover.item]!.sprite),
      kind: 'scenery',
      tone: this.result === SceneryResult.Ok ? 'ok' : 'refused',
    };
  }

  hide(): void {
    this.label.hidden = true;
    this.key = '';
    this.result = null;
  }

  dispose(): void {
    this.label.remove();
  }

  private showLabel(hover: SceneryHover): void {
    const definition = SCENERY_CATALOG[hover.item]!;
    const refused = this.result !== null && this.result !== SceneryResult.Ok;
    this.label.hidden = false;
    this.label.dataset.tone = refused ? 'refused' : 'ok';
    this.label.textContent = refused
      ? (REFUSAL_TEXT[this.result!] ?? 'Scenery cannot go here.')
      : `${definition.name} · ${formatMoney(definition.priceCents)}`;
    this.label.style.left = `${hover.clientX + 14}px`;
    this.label.style.top = `${hover.clientY + 14}px`;
  }
}

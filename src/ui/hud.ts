import type { Stats } from '../worker/protocol';
import type { Snapshot } from '../worker/snapshot';

const BUDGET_MS = 8;

/** Plain-DOM HUD placeholder; replaced by the real UI layer later. */
export class Hud {
  private readonly el: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('pre');
    this.el.className = 'hud';
    parent.appendChild(this.el);
  }

  update(
    stats: Stats | null,
    fps: number,
    rotation: number,
    renderMs = 0,
    visibleSprites = 0,
    backend = 'Renderer',
    renderScale = 1,
  ): void {
    if (!stats) {
      this.el.textContent = 'starting…';
      return;
    }
    const over = stats.msPerTick > BUDGET_MS ? '  OVER BUDGET' : '';
    this.el.textContent =
      `tick ${stats.tick}  guests ${stats.guests}\n` +
      `sim ${stats.msPerTick.toFixed(2)}ms/tick (max ${stats.maxMsPerTick.toFixed(2)})${over}\n` +
      `dropped ticks ${stats.droppedTicks}  fps ${fps.toFixed(0)}  rot ${rotation}\n` +
      `${backend}  frame ${renderMs.toFixed(2)}ms  scale ${renderScale.toFixed(2)}×  sprites ${visibleSprites}`;
  }
}

export function financePanelText(snapshot: Snapshot): string {
  return `Cash  ${formatCents(snapshot.park.cash)}\nLoan  ${formatCents(snapshot.park.loan)}`;
}

export function formatCents(cents: number): string {
  const value = (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `$${value}`;
}

import { FeedbackDomain } from '../../sim/core/feedback';
import type { CommandFeedback } from '../../sim/core/feedback';
import { PathResult } from '../../sim/map/paths';

const REJECTION_TEXT: Record<Exclude<PathResult, PathResult.Ok>, string> = {
  [PathResult.OutOfBounds]: 'That tile is outside the park map.',
  [PathResult.NotOwned]: 'You need to own this land before building a footpath.',
  [PathResult.InvalidPiece]: 'A footpath cannot be built like that here.',
  [PathResult.BelowGround]: 'A footpath cannot go below the ground.',
  [PathResult.Underwater]: 'Footpaths cannot be built on water.',
  [PathResult.UnevenGround]: 'The ground is too uneven for a footpath. Level it first.',
  [PathResult.Blocked]: 'Something is in the way.',
  [PathResult.InsufficientFunds]: 'Not enough cash for a footpath.',
};

/** Player-facing reason a footpath placement is refused. */
export function pathRefusalText(code: PathResult, detail = ''): string {
  if (code === PathResult.Ok) return '';
  if (code === PathResult.Blocked && detail) return `Blocked by ${detail}.`;
  return (
    REJECTION_TEXT[code as Exclude<PathResult, PathResult.Ok>] ?? 'A footpath cannot be built here.'
  );
}

/** An ownership warning replaces the less specific footpath warning over the same state. */
export function pathTipShouldShow(active: boolean, ownershipWarning: boolean): boolean {
  return active && !ownershipWarning;
}

/** How long a refused placement stays marked on the map and in its tooltip. */
const REJECTION_MS = 2500;

export interface PathRejection {
  x: number;
  y: number;
  text: string;
}

/** The refused footpath placement a snapshot reports, or null when it reports none. */
export function pathRejectionFrom(
  feedback: CommandFeedback,
  mapWidth: number,
): PathRejection | null {
  if (feedback.domain !== FeedbackDomain.Path || feedback.code === PathResult.Ok) return null;
  if (feedback.subject < 0) return null;
  const text = pathRefusalText(feedback.code, feedback.detail);
  return {
    x: feedback.subject % mapWidth,
    y: Math.floor(feedback.subject / mapWidth),
    text,
  };
}

/**
 * Shows why a footpath placement was refused: a red ghost on the tile and a tooltip at the
 * cursor. Accepted placements show nothing.
 */
export class PathFeedback {
  private readonly tip: HTMLElement;
  private seq = -1;
  private active: PathRejection | null = null;
  private expiresAt = 0;
  private pointerX = 0;
  private pointerY = 0;
  private ownershipWarning = false;

  constructor(parent: HTMLElement) {
    this.tip = document.createElement('div');
    this.tip.className = 'path-tip';
    this.tip.setAttribute('role', 'status');
    this.tip.hidden = true;
    parent.append(this.tip);
  }

  /** Records where the player pointed, so a refusal can appear next to the cursor. */
  pointAt(clientX: number, clientY: number): void {
    this.pointerX = clientX;
    this.pointerY = clientY;
  }

  setOwnershipWarning(active: boolean): void {
    this.ownershipWarning = active;
    this.tip.hidden = !pathTipShouldShow(this.active !== null, this.ownershipWarning);
  }

  /** Reads the latest snapshot and returns the tile to mark red, or null when none is active. */
  update(feedback: CommandFeedback, mapWidth: number, now: number): PathRejection | null {
    if (feedback.seq !== this.seq) {
      this.seq = feedback.seq;
      const rejection = pathRejectionFrom(feedback, mapWidth);
      if (rejection) {
        this.active = rejection;
        this.expiresAt = now + REJECTION_MS;
        this.tip.textContent = rejection.text;
        this.tip.style.left = `${this.pointerX + 14}px`;
        this.tip.style.top = `${this.pointerY + 14}px`;
        this.tip.hidden = !pathTipShouldShow(true, this.ownershipWarning);
      }
    }
    if (this.active && now >= this.expiresAt) this.clear();
    return this.active;
  }

  dispose(): void {
    this.tip.remove();
  }

  private clear(): void {
    this.active = null;
    this.tip.hidden = true;
  }
}

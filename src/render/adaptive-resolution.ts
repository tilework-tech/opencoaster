export interface AdaptiveResolutionOptions {
  /** Window average above this frame time (ms) lowers the scale. */
  slowMs?: number;
  /** Window average at or below this frame time (ms) counts toward recovery. */
  fastMs?: number;
  minScale?: number;
  step?: number;
  windowMs?: number;
  /** Sustained fast time (ms) before one step back up is tried. */
  recoverMs?: number;
}

const MAX_BACKOFF = 8;
/** A lower scale must cut the window average by at least this fraction to count as helping. */
const MIN_IMPROVEMENT = 0.15;
/** Frame-time spread (std dev / mean) below this marks a steady, display-limited cadence. */
const STEADY_SPREAD = 0.12;
/** How long slow frames are tolerated after a lower scale failed to help (ms). */
const FUTILE_HOLD_MS = 60_000;
const MAX_FRAME_MS = 100;

/**
 * Picks a render-resolution scale from measured frame times. Sustained slow frames step the scale
 * down; sustained on-budget frames step it back up, with the wait doubling each time a restored
 * scale turns out to be too slow so the resolution settles instead of oscillating.
 */
export class AdaptiveResolution {
  scale = 1;
  private readonly slowMs: number;
  private readonly fastMs: number;
  private readonly minScale: number;
  private readonly step: number;
  private readonly windowMs: number;
  private readonly recoverMs: number;
  private elapsed = 0;
  private frames = 0;
  private squares = 0;
  private fastElapsed = 0;
  private backoff = 1;
  private probing = false;
  private settledScale = 1;
  /** The scale and window average from before the latest drop, until its effect is judged. */
  private drop: { scale: number; average: number } | null = null;
  private holdMs = 0;

  constructor(options: AdaptiveResolutionOptions = {}) {
    this.slowMs = options.slowMs ?? 20;
    this.fastMs = options.fastMs ?? 18;
    this.minScale = options.minScale ?? 0.3;
    this.step = options.step ?? 0.25;
    this.windowMs = options.windowMs ?? 1000;
    this.recoverMs = options.recoverMs ?? 30_000;
  }

  record(frameMs: number): void {
    const clamped = Math.min(frameMs, MAX_FRAME_MS);
    this.elapsed += clamped;
    this.squares += clamped * clamped;
    this.frames++;
    // A freshly restored scale is judged on a shorter window so a bad guess is undone quickly.
    if (this.elapsed < (this.probing ? this.windowMs / 2 : this.windowMs)) return;
    const average = this.elapsed / this.frames;
    const spread = Math.sqrt(Math.max(0, this.squares / this.frames - average * average)) / average;
    const windowMs = this.elapsed;
    this.elapsed = 0;
    this.frames = 0;
    this.squares = 0;
    this.holdMs = Math.max(0, this.holdMs - windowMs);
    const drop = this.drop;
    this.drop = null;
    if (
      average > this.slowMs &&
      drop &&
      spread < STEADY_SPREAD &&
      average > drop.average * (1 - MIN_IMPROVEMENT)
    ) {
      // Fewer pixels did not speed up a steady cadence (for example a display capped below 60 Hz).
      this.scale = drop.scale;
      this.holdMs = FUTILE_HOLD_MS;
      this.fastElapsed = 0;
      return;
    }
    if (average > this.slowMs) {
      this.fastElapsed = 0;
      if (this.probing) {
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
        this.probing = false;
        this.scale = this.settledScale;
        return;
      }
      if (this.holdMs > 0) return;
      this.drop = { scale: this.scale, average };
      const steps = average > this.slowMs * 2 ? 2 : 1;
      this.scale = Math.max(this.minScale, this.scale - this.step * steps);
      return;
    }
    this.probing = false;
    if (average > this.fastMs || this.scale >= 1) {
      this.fastElapsed = 0;
      return;
    }
    this.fastElapsed += this.windowMs;
    if (this.fastElapsed >= this.recoverMs * this.backoff) {
      this.fastElapsed = 0;
      this.settledScale = this.scale;
      this.scale = Math.min(1, this.scale + this.step);
      this.probing = true;
    }
  }
}

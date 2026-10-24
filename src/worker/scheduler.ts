import { TICK_MS } from '../sim/core/constants';

/**
 * Converts wall-clock time into a whole number of fixed ticks. Pure and clock-injected so it is
 * unit-testable; the worker feeds it performance.now().
 */
export class FixedStepScheduler {
  private last = -1;
  private acc = 0;
  speed = 1;
  paused = false;
  droppedTicks = 0;

  constructor(
    private readonly maxCatchUp = 8,
    private readonly tickMs = TICK_MS,
  ) {}

  /** Returns how many ticks to run now. */
  advance(nowMs: number): number {
    if (this.last < 0) this.last = nowMs;
    const dt = nowMs - this.last;
    this.last = nowMs;
    if (this.paused) return 0;
    this.acc += dt * this.speed;
    let n = Math.floor(this.acc / this.tickMs);
    this.acc -= n * this.tickMs;
    if (n > this.maxCatchUp) {
      this.droppedTicks += n - this.maxCatchUp;
      n = this.maxCatchUp;
    }
    return n;
  }
}

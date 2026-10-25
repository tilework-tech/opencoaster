import type { CoasterPad, ParkBuilder } from './builder';
import { StaffKind } from './builder';
import { Prng } from '../../src/sim/core/prng';
import type { Strategy, StrategyFactory } from './run';
import { TICKS_PER_MONTH } from './run';

/** A park grown by a fixed build order: the shape most scripted playthroughs share. */
export interface GrowthConfig {
  /** Built at the start, cash permitting. */
  opening: string[];
  /**
   * Built in order, one whenever cash exceeds `reserveCents` plus the item's cost. An entry is a
   * flat ride or stall name, or `coaster:<template>:<side>` (side 1 or -1).
   */
  growth: string[];
  /** Cash kept back for wages and running costs. */
  reserveCents: number;
  /** Ticks between build decisions. */
  cadence?: number;
  /** One handyman per this many rides and stalls (rounded up), at least one. */
  itemsPerHandyman?: number;
  /** One mechanic per this many attractions, 0 for none. */
  attractionsPerMechanic?: number;
  /** Staff are not hired before this tick. */
  staffFrom?: number;
  /** Ticket prices in cents by ride name, `coaster` for coasters; used when the park charges per ride. */
  prices?: Record<string, number>;
  /**
   * Human imperfection, drawn per seed so win rates vary the way real play does: each build
   * decision is skipped with probability `skipPercent`, and growth starts up to `startDelayMonths`
   * late.
   */
  jitter?: { skipPercent: number; startDelayMonths: number };
  /** Extra per-tick behaviour. */
  extra?: (b: ParkBuilder, tick: number) => void;
}

export function growthStrategy(cfg: GrowthConfig): StrategyFactory {
  return () => {
    let started = false;
    let next = 0;
    const pads = new Map<number, CoasterPad>();
    let nextAdvance = 0;
    let nextDecision = 0;
    let rng: Prng | null = null;
    let growthFrom = 0;
    const cadence = cfg.cadence ?? TICKS_PER_MONTH / 8;
    const strategy: Strategy = {
      step(b) {
        const tick = b.tick;
        if (!started) {
          started = true;
          b.prices = cfg.prices ?? {};
          rng = new Prng(b.sim.world.seed ^ 0x51ed);
          growthFrom = cfg.jitter ? rng.int(cfg.jitter.startDelayMonths * TICKS_PER_MONTH + 1) : 0;
          // Coaster pads are reserved up front so flat rides never take their rows.
          [...cfg.opening, ...cfg.growth].forEach((entry, i) => {
            const [kind, template, side] = entry.split(':');
            if (kind === 'coaster')
              pads.set(i - cfg.opening.length, b.planCoaster(template, Number(side)));
          });
          for (const name of cfg.opening) b.build(name);
        }
        if (tick >= nextAdvance) {
          nextAdvance = tick + 64;
          b.advance();
        }
        if (tick < nextDecision) {
          cfg.extra?.(b, tick);
          return;
        }
        nextDecision = tick + cadence;
        const skip = cfg.jitter !== undefined && (rng as Prng).int(100) < cfg.jitter.skipPercent;
        if (tick >= growthFrom && !skip) {
          // A flat ride with no free slot left is dropped so later entries are not starved.
          while (next < cfg.growth.length) {
            if (!pads.has(next) && b.nextSlot() === null) next++;
            else if (buildEntry(b, cfg, pads, next)) next++;
            else break;
          }
        }
        if (tick >= (cfg.staffFrom ?? 0)) {
          const items = b.sim.world.rides.count;
          b.staffTo(
            StaffKind.Handyman,
            Math.max(1, Math.ceil(items / (cfg.itemsPerHandyman ?? 5))),
          );
          if (cfg.attractionsPerMechanic) {
            b.staffTo(StaffKind.Mechanic, Math.ceil(b.attractions() / cfg.attractionsPerMechanic));
          }
        }
        cfg.extra?.(b, tick);
      },
    };
    return strategy;
  };
}

function buildEntry(
  b: ParkBuilder,
  cfg: GrowthConfig,
  pads: Map<number, CoasterPad>,
  index: number,
): boolean {
  const pad = pads.get(index);
  if (pad) return b.buildCoaster(pad, cfg.reserveCents) >= 0;
  return b.build(cfg.growth[index], cfg.reserveCents) >= 0;
}

import { Simulation } from '../sim/core/simulation';
import { MAX_GUESTS, MAX_LITTER, MAX_STAFF, MAX_VEHICLES } from '../sim/core/constants';
import { FixedStepScheduler } from './scheduler';
import { createSnapshot, SNAPSHOT_RIDE_CAPACITY, snapshotBuffers, writeSnapshot } from './snapshot';
import type { Snapshot } from './snapshot';
import type { FromWorker, InitMessage, ToWorker } from './protocol';

export interface Port {
  post(msg: FromWorker, transfer?: ArrayBuffer[]): void;
}

const SNAPSHOT_POOL = 3;
const STATS_INTERVAL_MS = 500;

/**
 * Worker-side driver, kept free of `self`/DOM so it can run (and be tested) in plain Node.
 * The worker entry feeds it messages and calls pump() from a timer.
 */
export class SimRunner {
  private sim: Simulation | null = null;
  private readonly sched = new FixedStepScheduler();
  private pool: Snapshot[] = [];
  private emaMs = 0;
  private maxMs = 0;
  private lastStats = 0;
  private mapRevision = 0;

  constructor(
    private readonly port: Port,
    private readonly clock: () => number,
  ) {}

  handle(msg: ToWorker): void {
    switch (msg.type) {
      case 'init':
        this.init(msg);
        break;
      case 'command':
        this.sim?.enqueue(msg.command);
        break;
      case 'setSpeed':
        this.sched.speed = msg.multiplier;
        break;
      case 'setPaused':
        this.sched.paused = msg.paused;
        break;
      case 'recycle':
        this.pool.push(msg.snapshot);
        break;
    }
  }

  private init(msg: InitMessage): void {
    const sim = new Simulation({
      seed: msg.seed,
      width: msg.width,
      height: msg.height,
      maxGuests: msg.maxGuests,
    });
    this.sim = sim;
    sim.enqueue({ type: 'spawnGuests', count: msg.initialGuests });
    this.pool = [];
    for (let i = 0; i < SNAPSHOT_POOL; i++) {
      this.pool.push(
        createSnapshot({
          guests: msg.maxGuests ?? MAX_GUESTS,
          staff: MAX_STAFF,
          vehicles: MAX_VEHICLES,
          litter: MAX_LITTER,
          rides: SNAPSHOT_RIDE_CAPACITY,
          mapTiles: msg.width * msg.height,
        }),
      );
    }
    this.postMap(sim);
    this.port.post({ type: 'ready' });
  }

  private postMap(sim: Simulation): void {
    const { map } = sim.world;
    const heights = map.heights.slice();
    const surface = map.surface.slice();
    const slope = map.slope.slice();
    this.mapRevision = map.revision;
    this.port.post({ type: 'map', width: map.width, height: map.height, heights, surface, slope }, [
      heights.buffer as ArrayBuffer,
      surface.buffer as ArrayBuffer,
      slope.buffer as ArrayBuffer,
    ]);
  }

  /** Runs due ticks and publishes a snapshot if any ran and a free buffer is available. */
  pump(): void {
    const sim = this.sim;
    if (!sim) return;
    const now = this.clock();
    const n = this.sched.advance(now);
    if (n > 0) {
      const t0 = this.clock();
      for (let i = 0; i < n; i++) sim.step();
      if (sim.world.map.revision !== this.mapRevision) this.postMap(sim);
      const per = (this.clock() - t0) / n;
      this.emaMs = this.emaMs === 0 ? per : this.emaMs * 0.9 + per * 0.1;
      if (per > this.maxMs) this.maxMs = per;
      const snap = this.pool.pop();
      if (snap) {
        writeSnapshot(sim.world, snap);
        this.port.post({ type: 'snapshot', snapshot: snap }, snapshotBuffers(snap));
      }
    }
    if (now - this.lastStats >= STATS_INTERVAL_MS) {
      this.lastStats = now;
      this.port.post({
        type: 'stats',
        stats: {
          tick: sim.world.tick,
          msPerTick: this.emaMs,
          maxMsPerTick: this.maxMs,
          guests: sim.world.guests.count,
          droppedTicks: this.sched.droppedTicks,
        },
      });
      this.maxMs = 0;
    }
  }
}

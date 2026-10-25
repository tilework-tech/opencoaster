import { Simulation } from '../sim/core/simulation';
import type { World } from '../sim/core/world';
import { MAX_GUESTS, MAX_LITTER, MAX_STAFF, MAX_VEHICLES } from '../sim/core/constants';
import { prepareScenario } from '../sim/scenario/scenario-layout';
import { deserialize, serialize } from '../save/save';
import { FixedStepScheduler } from './scheduler';
import { createSnapshot, SNAPSHOT_RIDE_CAPACITY, snapshotBuffers, writeSnapshot } from './snapshot';
import { extractMapData } from './map-data';
import { previewPathRun } from '../sim/map/map-commands';
import type { PathPlacement } from '../sim/map/paths';
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
  /** Tile count the pooled snapshots were sized for; a larger map replaces the pool. */
  private poolTiles = 0;
  private emaMs = 0;
  private maxMs = 0;
  private lastStats = 0;
  private mapRevision = 0;
  private snapshotIntervalMs = 0;
  private lastSnapshot = -Infinity;
  /** Ticks have advanced since the last published snapshot. */
  private snapshotDue = false;

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
      case 'setSnapshotInterval':
        this.snapshotIntervalMs = Math.max(0, msg.ms);
        break;
      case 'recycle':
        if (msg.snapshot.buildable.length >= this.poolTiles) this.pool.push(msg.snapshot);
        break;
      case 'save':
        this.save();
        break;
      case 'load':
        this.load(msg.bytes);
        break;
      case 'previewPaths':
        this.previewPaths(msg.id, msg.placements);
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
    if (msg.scenario) prepareScenario(sim.world, msg.scenario);
    sim.enqueue({ type: 'spawnGuests', count: msg.initialGuests });
    this.start(sim);
    this.port.post({ type: 'ready' });
  }

  private save(): void {
    if (!this.sim) {
      this.fail('save', 'No game is running.');
      return;
    }
    const bytes = serialize(this.sim.world);
    this.port.post({ type: 'saved', bytes }, [bytes.buffer as ArrayBuffer]);
  }

  private previewPaths(id: number, placements: PathPlacement[]): void {
    const sim = this.sim;
    const pieces = sim ? previewPathRun(sim.world, placements) : [];
    this.port.post({ type: 'pathPreview', id, pieces });
  }

  private load(bytes: Uint8Array): void {
    let world: World;
    try {
      world = deserialize(bytes);
    } catch (err) {
      this.fail('load', err instanceof Error ? err.message : String(err));
      return;
    }
    this.start(new Simulation(world));
    this.port.post({ type: 'loaded' });
  }

  private fail(request: 'save' | 'load', message: string): void {
    this.port.post({ type: 'error', request, message });
  }

  /** Makes `sim` the running game: sizes the snapshot pool to its map and publishes the map. */
  private start(sim: Simulation): void {
    this.sim = sim;
    this.ensurePool(sim.world.map.width * sim.world.map.height);
    this.postMap(sim);
  }

  private ensurePool(mapTiles: number): void {
    if (this.poolTiles >= mapTiles) return;
    this.poolTiles = mapTiles;
    this.pool = [];
    for (let i = 0; i < SNAPSHOT_POOL; i++) {
      this.pool.push(
        createSnapshot({
          guests: MAX_GUESTS,
          staff: MAX_STAFF,
          vehicles: MAX_VEHICLES,
          litter: MAX_LITTER,
          rides: SNAPSHOT_RIDE_CAPACITY,
          mapTiles,
        }),
      );
    }
  }

  private postMap(sim: Simulation): void {
    const { map } = sim.world;
    const data = extractMapData(map);
    this.mapRevision = map.revision;
    this.port.post(
      {
        type: 'map',
        ...data,
        entranceX: sim.world.park.entranceX,
        entranceY: sim.world.park.entranceY,
      },
      [
        data.heights.buffer as ArrayBuffer,
        data.surface.buffer as ArrayBuffer,
        data.slope.buffer as ArrayBuffer,
        data.waterLevel.buffer as ArrayBuffer,
        data.pathElements.buffer as ArrayBuffer,
      ],
    );
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
      this.snapshotDue = true;
    }
    if (this.snapshotDue && now - this.lastSnapshot >= this.snapshotIntervalMs) {
      const snap = this.pool.pop();
      if (snap) {
        this.snapshotDue = false;
        this.lastSnapshot = now;
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

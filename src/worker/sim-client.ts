import type { Command } from '../sim/core/commands';
import type { PathPlacement } from '../sim/map/paths';
import type { PathPiecePreview, ScenerySpot } from '../sim/map/map-commands';
import type { SceneryResult } from '../sim/map/scenery';
import type { InitMessage, MapMessage, Stats, ToWorker, FromWorker } from './protocol';
import type { LandEdit, LandPlan } from '../sim/map/land-tool';
import type { AreaEdit, AreaPlan } from '../sim/map/area-tools';
import { snapshotBuffers } from './snapshot';
import type { Snapshot } from './snapshot';

interface PendingRequest {
  kind: 'save' | 'load';
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/** Main-thread handle to the sim worker. */
export class SimClient {
  private readonly worker: Worker;
  private pending: PendingRequest[] = [];
  private previews = new Map<number, (pieces: PathPiecePreview[]) => void>();
  private sceneryPreviews = new Map<number, (result: SceneryResult) => void>();
  private nextPreviewId = 1;
  /** True from a start or load request until the worker confirms it; older snapshots are stale. */
  private starting = false;
  latest: Snapshot | null = null;
  map: MapMessage | null = null;
  stats: Stats | null = null;
  /** Newest land preview answer and the edit it answers; null until one arrives. */
  landPreview: { edit: LandEdit; plan: LandPlan } | null = null;
  private previewSeq = 0;
  private readonly previewEdits = new Map<number, LandEdit>();
  /** Newest Clear scenery or Water preview answer and the edit it answers. */
  areaPreview: { edit: AreaEdit; plan: AreaPlan } | null = null;
  private areaSeq = 0;
  private readonly areaEdits = new Map<number, AreaEdit>();
  /** Called for every published map; `newGame` is true only for the map of a started or loaded game. */
  onMap: ((m: MapMessage, newGame: boolean) => void) | null = null;
  loadWarnings: string[] = [];

  constructor() {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
    // A crashed worker sends no replies, so pending requests are failed rather than left hanging.
    this.worker.onerror = (e: ErrorEvent) =>
      this.failPending(new Error(e.message || 'The simulation worker stopped unexpectedly.'));
  }

  private failPending(err: Error): void {
    this.starting = false;
    for (const request of this.pending.splice(0)) request.reject(err);
    this.previews.clear();
    this.sceneryPreviews.clear();
  }

  private onMessage(msg: FromWorker): void {
    switch (msg.type) {
      case 'map':
        this.map = msg;
        this.onMap?.(msg, this.starting);
        break;
      case 'pathPreview':
        this.previews.get(msg.id)?.(msg.pieces);
        this.previews.delete(msg.id);
        break;
      case 'scenerySpotPreview':
        this.sceneryPreviews.get(msg.id)?.(msg.result);
        this.sceneryPreviews.delete(msg.id);
        break;
      case 'snapshot':
        if (this.starting) {
          this.send({ type: 'recycle', snapshot: msg.snapshot }, msg.snapshot);
          break;
        }
        this.recycleLatest();
        this.latest = msg.snapshot;
        break;
      case 'landPreview': {
        const edit = this.previewEdits.get(msg.id);
        if (edit && msg.id === this.previewSeq) this.landPreview = { edit, plan: msg.plan };
        this.previewEdits.delete(msg.id);
        break;
      }
      case 'areaPreview': {
        const edit = this.areaEdits.get(msg.id);
        if (edit && msg.id === this.areaSeq) this.areaPreview = { edit, plan: msg.plan };
        this.areaEdits.delete(msg.id);
        break;
      }
      case 'stats':
        this.stats = msg.stats;
        break;
      case 'saved':
        this.settle('save')?.resolve(msg.bytes);
        break;
      case 'loaded':
        this.starting = false;
        this.loadWarnings = msg.warnings ?? [];
        this.settle('load')?.resolve(undefined);
        break;
      case 'error':
        if (msg.request === 'load') this.starting = false;
        this.settle(msg.request)?.reject(new Error(msg.message));
        break;
      case 'ready':
        this.starting = false;
        break;
    }
  }

  private recycleLatest(): void {
    if (!this.latest) return;
    this.send({ type: 'recycle', snapshot: this.latest }, this.latest);
    this.latest = null;
  }

  /** Answers the oldest request of this kind; the worker replies to requests in order. */
  private settle(kind: 'save' | 'load'): PendingRequest | undefined {
    const index = this.pending.findIndex((p) => p.kind === kind);
    if (index < 0) return undefined;
    return this.pending.splice(index, 1)[0];
  }

  private send(msg: ToWorker, recycled?: Snapshot): void {
    const transfer = recycled ? snapshotBuffers(recycled) : [];
    this.worker.postMessage(msg, transfer);
  }

  /** Starts a new game in the worker, replacing any game already running. */
  startGame(init: Omit<InitMessage, 'type'>): void {
    this.recycleLatest();
    this.starting = true;
    this.send({ type: 'init', ...init });
  }

  /** Serialises the running game. Rejects when no game is running. */
  save(): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      this.pending.push({ kind: 'save', resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ type: 'save' } satisfies ToWorker);
    });
  }

  /** Replaces the running game with a save. Rejects with the reason when the bytes are not a save. */
  load(bytes: Uint8Array): Promise<void> {
    const copy = bytes.slice();
    this.recycleLatest();
    this.starting = true;
    return new Promise((resolve, reject) => {
      this.pending.push({ kind: 'load', resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ type: 'load', bytes: copy } satisfies ToWorker, [copy.buffer]);
    });
  }

  /** Asks the worker what a land edit would do; the answer lands in `landPreview`. */
  previewLand(edit: LandEdit): void {
    const id = ++this.previewSeq;
    this.previewEdits.clear();
    this.previewEdits.set(id, edit);
    this.worker.postMessage({ type: 'previewLand', id, edit } satisfies ToWorker);
  }
  clearLandPreview(): void {
    this.previewSeq++;
    this.previewEdits.clear();
    this.landPreview = null;
  }

  /** Asks the worker what a Clear scenery or Water edit would do; the answer lands in `areaPreview`. */
  previewArea(edit: AreaEdit): void {
    const id = ++this.areaSeq;
    this.areaEdits.clear();
    this.areaEdits.set(id, edit);
    this.worker.postMessage({ type: 'previewArea', id, edit } satisfies ToWorker);
  }
  clearAreaPreview(): void {
    this.areaSeq++;
    this.areaEdits.clear();
    this.areaPreview = null;
  }

  command(command: Command): void {
    this.send({ type: 'command', command });
  }

  /** What each footpath placement would become if the run were laid now. */
  previewPaths(placements: PathPlacement[]): Promise<PathPiecePreview[]> {
    const id = this.nextPreviewId++;
    return new Promise((resolve) => {
      this.previews.set(id, resolve);
      this.send({ type: 'previewPaths', id, placements });
    });
  }
  /** Whether a scenery placement would be accepted now, and why not if it would be refused. */
  previewScenery(spot: ScenerySpot): Promise<SceneryResult> {
    const id = this.nextPreviewId++;
    return new Promise((resolve) => {
      this.sceneryPreviews.set(id, resolve);
      this.send({ type: 'previewScenery', id, spot });
    });
  }
  setSpeed(multiplier: number): void {
    this.send({ type: 'setSpeed', multiplier });
  }
  setPaused(paused: boolean): void {
    this.send({ type: 'setPaused', paused });
  }
  setSnapshotInterval(ms: number): void {
    this.send({ type: 'setSnapshotInterval', ms });
  }
}

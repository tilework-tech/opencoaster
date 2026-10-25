import type { Command } from '../sim/core/commands';
import type { PathPlacement } from '../sim/map/paths';
import type { PathPiecePreview } from '../sim/map/map-commands';
import type { InitMessage, MapMessage, Stats, ToWorker, FromWorker } from './protocol';
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
  private nextPreviewId = 1;
  /** True from a start or load request until the worker confirms it; older snapshots are stale. */
  private starting = false;
  latest: Snapshot | null = null;
  map: MapMessage | null = null;
  stats: Stats | null = null;
  /** Called for every published map; `newGame` is true only for the map of a started or loaded game. */
  onMap: ((m: MapMessage, newGame: boolean) => void) | null = null;

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
      case 'snapshot':
        if (this.starting) {
          this.send({ type: 'recycle', snapshot: msg.snapshot }, msg.snapshot);
          break;
        }
        this.recycleLatest();
        this.latest = msg.snapshot;
        break;
      case 'stats':
        this.stats = msg.stats;
        break;
      case 'saved':
        this.settle('save')?.resolve(msg.bytes);
        break;
      case 'loaded':
        this.starting = false;
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

import type { Command } from '../sim/core/commands';
import type { InitMessage, MapMessage, Stats, ToWorker, FromWorker } from './protocol';
import type { Snapshot } from './snapshot';

/** Main-thread handle to the sim worker. */
export class SimClient {
  private readonly worker: Worker;
  latest: Snapshot | null = null;
  map: MapMessage | null = null;
  stats: Stats | null = null;
  onMap: ((m: MapMessage) => void) | null = null;

  constructor(init: Omit<InitMessage, 'type'>) {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
    this.send({ type: 'init', ...init });
  }

  private onMessage(msg: FromWorker): void {
    switch (msg.type) {
      case 'map':
        this.map = msg;
        this.onMap?.(msg);
        break;
      case 'snapshot':
        if (this.latest) this.send({ type: 'recycle', snapshot: this.latest }, this.latest);
        this.latest = msg.snapshot;
        break;
      case 'stats':
        this.stats = msg.stats;
        break;
      case 'ready':
        break;
    }
  }

  private send(msg: ToWorker, recycled?: Snapshot): void {
    const transfer = recycled
      ? [recycled.guests, recycled.staff, recycled.vehicles, recycled.litter, recycled.rides].map(
          (l) => l.data.buffer,
        )
      : [];
    this.worker.postMessage(msg, transfer);
  }

  command(command: Command): void {
    this.send({ type: 'command', command });
  }
  setSpeed(multiplier: number): void {
    this.send({ type: 'setSpeed', multiplier });
  }
  setPaused(paused: boolean): void {
    this.send({ type: 'setPaused', paused });
  }
}

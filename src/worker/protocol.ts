import type { Command } from '../sim/core/commands';
import type { Snapshot } from './snapshot';

export interface InitMessage {
  type: 'init';
  seed: number;
  width: number;
  height: number;
  initialGuests: number;
  maxGuests?: number;
}

export type ToWorker =
  | InitMessage
  | { type: 'command'; command: Command }
  | { type: 'setSpeed'; multiplier: number }
  | { type: 'setPaused'; paused: boolean }
  /** Hands a consumed snapshot's buffers back to the worker for reuse. */
  | { type: 'recycle'; snapshot: Snapshot };

export interface MapMessage {
  type: 'map';
  width: number;
  height: number;
  heights: Uint8Array;
  surface: Uint8Array;
}

export interface Stats {
  tick: number;
  /** Exponential moving average of sim cost per tick, ms. */
  msPerTick: number;
  maxMsPerTick: number;
  guests: number;
  /** Ticks dropped because the sim could not keep up (catch-up cap hit). */
  droppedTicks: number;
}

export type FromWorker =
  | { type: 'ready' }
  | MapMessage
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'stats'; stats: Stats };

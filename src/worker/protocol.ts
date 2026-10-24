import type { Command } from '../sim/core/commands';
import type { ScenarioDef } from '../sim/scenario/scenario';
import type { Snapshot } from './snapshot';

export interface InitMessage {
  type: 'init';
  seed: number;
  width: number;
  height: number;
  initialGuests: number;
  maxGuests?: number;
  /** Applied to the new world before its first tick (finances, objective, entrance). */
  scenario?: ScenarioDef;
}

export type ToWorker =
  | InitMessage
  | { type: 'command'; command: Command }
  | { type: 'setSpeed'; multiplier: number }
  | { type: 'setPaused'; paused: boolean }
  /** Hands a consumed snapshot's buffers back to the worker for reuse. */
  | { type: 'recycle'; snapshot: Snapshot }
  /** Serialises the running game; answered with `saved`. */
  | { type: 'save' }
  /** Replaces the running game with a save; answered with `loaded` or `error`. */
  | { type: 'load'; bytes: Uint8Array };

export interface MapMessage {
  type: 'map';
  width: number;
  height: number;
  heights: Uint8Array;
  surface: Uint8Array;
  /** Corner mask per tile (bit c set when corner c is one level above `heights`). */
  slope: Uint8Array;
  waterLevel: Uint8Array;
  /** Five ints per path stack element: tile x, tile y, base level, flags, element data. */
  pathElements: Int32Array;
  pathCount: number;
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
  | { type: 'stats'; stats: Stats }
  | { type: 'saved'; bytes: Uint8Array }
  | { type: 'loaded' }
  | { type: 'error'; request: 'save' | 'load'; message: string };

import type { Command } from '../sim/core/commands';
import type { ScenarioDef } from '../sim/scenario/scenario';
import type { PathPlacement } from '../sim/map/paths';
import type { PathPiecePreview, ScenerySpot } from '../sim/map/map-commands';
import type { SceneryResult } from '../sim/map/scenery';
import type { Snapshot } from './snapshot';
import type { LandEdit, LandPlan } from '../sim/map/land-tool';

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
  /** Minimum time between published snapshots; 0 publishes after every batch of ticks. */
  | { type: 'setSnapshotInterval'; ms: number }
  /** Hands a consumed snapshot's buffers back to the worker for reuse. */
  | { type: 'recycle'; snapshot: Snapshot }
  /** Serialises the running game; answered with `saved`. */
  | { type: 'save' }
  /** Replaces the running game with a save; answered with `loaded` or `error`. */
  | { type: 'load'; bytes: Uint8Array }
  /** Asks what each footpath placement would do right now; answered with `pathPreview`. */
  | { type: 'previewPaths'; id: number; placements: PathPlacement[] }
  /** Evaluates a land edit without applying it; answered with `landPreview`. */
  | { type: 'previewLand'; id: number; edit: LandEdit }
  /** Asks whether a scenery placement would be accepted now; answered with `scenerySpotPreview`. */
  | { type: 'previewScenery'; id: number; spot: ScenerySpot };

export interface MapMessage {
  type: 'map';
  width: number;
  height: number;
  entranceX: number;
  entranceY: number;
  heights: Uint8Array;
  surface: Uint8Array;
  /** Corner mask per tile (bit c set when corner c is one level above `heights`). */
  slope: Uint8Array;
  waterLevel: Uint8Array;
  /** Ownership and sale flags, indexed by map tile. */
  ownership: Uint8Array;
  /** Six ints per path element: tile x, y, base level, flags, element data, paving style. */
  pathElements: Int32Array;
  pathCount: number;
  /** Five ints per scenery element: tile x, tile y, base level, rotation, catalog item. */
  sceneryElements: Int32Array;
  sceneryCount: number;
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
  | { type: 'error'; request: 'save' | 'load'; message: string }
  /** One preview per requested placement, in request order. */
  | { type: 'pathPreview'; id: number; pieces: PathPiecePreview[] }
  | { type: 'landPreview'; id: number; plan: LandPlan }
  | { type: 'scenerySpotPreview'; id: number; result: SceneryResult };

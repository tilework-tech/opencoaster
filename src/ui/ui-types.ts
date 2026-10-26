import type { MessageFilter } from './messages';
import type { Command } from '../sim/core/commands';
import type { RideType } from '../sim/rides/ride-types';
import type { Camera, MapData } from '../render/renderer';
import type { Stats } from '../worker/protocol';
import type { Snapshot } from '../worker/snapshot';
import type { PlayerSettings } from './settings';
import type { SampleSeries } from './format';
import type { WindowManager } from './window-manager';
import type { PathMode, PathToolState } from '../app/tools/path/state';
import type { PieceSlope } from '../app/tools/path/run';
import type { PathStyle } from '../sim/map/tile-map';

export type ToolMode =
  | 'select'
  | 'land'
  | 'path'
  | 'scenery'
  | 'bin'
  | 'bench'
  | 'shelter'
  | 'flowerbed'
  | 'lamp'
  | 'ride'
  | 'track'
  | 'buy-land'
  | 'buy-rights'
  | 'patrol'
  | 'clear'
  | 'water';

/** Footpath construction as the Footpaths window drives it. */
export interface FootpathControls {
  readonly state: Readonly<PathToolState>;
  setMode(mode: PathMode): void;
  setStyle(style: PathStyle): void;
  setQueue(queue: boolean): void;
  setDirection(dir: number): void;
  setSlope(slope: PieceSlope): void;
  build(): Promise<void>;
  remove(): void;
  announce(text: string): void;
  leave(): void;
}

export type LandMode = 'raise' | 'lower' | 'flatten' | 'smooth';

export interface LandSettings {
  /** Edge length in tiles of the square the tool acts on. */
  size: number;
  mode: LandMode;
  /** Whether a size-1 pick near a corner or edge selects only that corner or edge. */
  corners: boolean;
}

export const LAND_SIZE_RANGE = { min: 1, max: 10 } as const;

/** Clear scenery and Water tool settings; `lower` only applies to Water. */
export interface AreaToolSettings {
  /** Edge length in tiles of the square the tool acts on, within `LAND_SIZE_RANGE`. */
  size: number;
  lower: boolean;
}

export interface GameUIActions {
  setPaused(paused: boolean): void;
  setSpeed(speed: number): void;
  rotate(direction: -1 | 1): void;
  zoom(direction: -1 | 1): void;
  setTool(tool: ToolMode): void;
  spawnGuests(): void;
  openMenu(): void;
  hireStaff(kind: number): void;
  setPatrolKind(kind: number | null): void;
  renameStaff(staffId: number, name: string): void;
  fireStaff(staffId: number): void;
  setRidePrice(rideId: number, priceCents: number): void;
  setRideTrains(rideId: number, trains: number, cars: number): void;
  setRideStatus(rideId: number, status: 'open' | 'close' | 'test'): void;
  demolishRide(rideId: number): void;
  placeRidePart(rideId: number, part: 'entrance' | 'exit'): void;
  /** Any other simulation command (economy, research). */
  command(command: Command): void;
  /** Puts the next map click to use the alternate action: lower land, remove, un-plant. */
  setAlternate(on: boolean): void;
  setLand(settings: LandSettings): void;
  setClearScenery(settings: AreaToolSettings): void;
  setWater(settings: AreaToolSettings): void;
  footpath: FootpathControls;
  setSceneryItem(item: number): void;
  /** Turns the scenery piece the Scenery tool places by a quarter turn. */
  rotatePiece(): void;
  /** Centres the camera on a tile. */
  locate(x: number, y: number): void;
  /** Selects the ride type the Ride tool places. */
  chooseRideType(type: RideType): void;
  /** Reopens a track ride in the construction window. */
  editTrack(rideId: number): void;
  map(): MapData | null;
  camera(): Camera;
  audioSettings(): Pick<PlayerSettings, 'soundVolume' | 'musicVolume' | 'musicOn' | 'muted'>;
  setAudioSettings(
    settings: Partial<Pick<PlayerSettings, 'soundVolume' | 'musicVolume' | 'musicOn' | 'muted'>>,
  ): void;
  playUiSound(name: 'click' | 'open' | 'close' | 'news'): void;
  messageFilter(): MessageFilter;
  setMessageFilter(filter: Partial<MessageFilter>): void;
}

/** Structured guest selection; a point-in-time copy of the guest's snapshot values. */
export interface GuestSelection {
  id: number;
  number: number;
  tileX: number;
  tileY: number;
  state: string;
  happiness: number;
  hunger: number;
  thirst: number;
  toilet: number;
  nausea: number;
  energy: number;
  cash: number;
  thoughts: readonly number[];
  tick: number;
}

/** What every window controller gets. */
export interface UiContext {
  windows: WindowManager;
  actions: GameUIActions;
  selectedGuest(): GuestSelection | null;
  series: { cash: SampleSeries; value: SampleSeries; profit: SampleSeries; guests: SampleSeries };
  openRide(rideId: number): void;
  openGuest(guestId: number): void;
  openWorker(staffId: number): void;
  openWindow(id: string): void;
  chooseTool(tool: ToolMode): void;
  currentTool(): ToolMode;
}

export interface WindowController {
  update(snapshot: Snapshot | null, stats: Stats | null): void;
}

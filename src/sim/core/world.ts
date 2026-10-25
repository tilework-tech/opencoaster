import { Prng } from './prng';
import { EntityStore } from './entity-store';
import { MAX_GUESTS, MAX_LITTER, MAX_STAFF, MAX_VEHICLES } from './constants';
import { TileMap } from '../map/tile-map';
import { generateTerrain } from '../map/terrain';
import { GUEST_SCHEMA } from '../guests/guest-store';
import { STAFF_SCHEMA } from '../staff/staff-store';
import { VEHICLE_SCHEMA } from '../vehicles/vehicle-store';
import { LITTER_SCHEMA } from '../guests/litter-store';
import { createParkState } from '../guests/park';
import { createRideLines } from '../guests/ride-lines';
import type { RideLines } from '../guests/ride-lines';
import type { ParkState } from '../guests/park';
import { createLedger } from '../economy/ledger';
import type { Ledger } from '../economy/ledger';
import { createWeather } from '../weather/weather';
import type { WeatherState } from '../weather/weather';
import { createResearch } from '../research/research';
import type { ResearchState } from '../research/research';
import { createScenarioState } from '../scenario/scenario';
import type { ScenarioState } from '../scenario/scenario';
import { RIDE_SCHEMA } from '../rides/ride-store';
import { TrackState } from '../track/track-store';
import type { VehicleTrackRegistry } from '../vehicles/vehicle-track';
import { createFeedback } from './feedback';
import type { CommandFeedback } from './feedback';

export interface WorldOptions {
  seed: number;
  width: number;
  height: number;
  maxGuests?: number;
}

/** The complete, serialisable simulation state. Systems are pure functions of (World) -> World. */
export class World {
  tick = 0;
  readonly seed: number;
  readonly rng: Prng;
  readonly map: TileMap;
  /** Persistent tile masks keyed by patrol area id (0 means unrestricted). */
  readonly patrolAreas: Uint8Array;
  readonly guests: EntityStore<typeof GUEST_SCHEMA>;
  /** Umbrella ownership indexed by stable guest id. */
  readonly umbrellas: Uint8Array;
  readonly staff: EntityStore<typeof STAFF_SCHEMA>;
  /** Player-given staff names by stable staff id; not simulated, saved with the game. */
  readonly staffNames = new Map<number, string>();
  /** Per-tile grass overgrowth and flower-bed state (see staff/grounds.ts). */
  readonly grounds: Uint8Array;
  readonly vehicles: EntityStore<typeof VEHICLE_SCHEMA>;
  /** Runtime track geometry is rebuilt by the track subsystem and consumed by vehicles. */
  vehicleTracks?: VehicleTrackRegistry;
  readonly litter: EntityStore<typeof LITTER_SCHEMA>;
  readonly rides: EntityStore<typeof RIDE_SCHEMA>;
  readonly economy: Ledger;
  readonly weather: WeatherState;
  readonly research: ResearchState;
  readonly scenario: ScenarioState;
  readonly track: TrackState;
  readonly park: ParkState;
  /** Guests lining up for each ride; derived every tick, not hashed or saved. */
  readonly rideLines: RideLines;
  /** Outcome of the latest command, for UI display; not hashed or saved. */
  readonly feedback: CommandFeedback = createFeedback();
  readonly audioEvents: Array<{
    id: number;
    type: 'build' | 'demolish' | 'scream' | 'clank';
    rideId?: number;
    intensity?: number;
  }> = [];
  readonly audioClankTick = new Map<number, number>();
  audioEventSequence = 0;

  constructor(opts: WorldOptions) {
    this.seed = opts.seed;
    this.rng = new Prng(opts.seed);
    this.map = new TileMap(opts.width, opts.height);
    this.patrolAreas = new Uint8Array(opts.width * opts.height * 4);
    generateTerrain(this.map, new Prng(opts.seed ^ 0x5eed));
    this.guests = new EntityStore(GUEST_SCHEMA, opts.maxGuests ?? MAX_GUESTS);
    this.umbrellas = new Uint8Array(this.guests.capacity);
    this.staff = new EntityStore(STAFF_SCHEMA, MAX_STAFF);
    this.grounds = new Uint8Array(opts.width * opts.height);
    this.vehicles = new EntityStore(VEHICLE_SCHEMA, MAX_VEHICLES);
    this.litter = new EntityStore(LITTER_SCHEMA, MAX_LITTER);
    this.rides = new EntityStore(RIDE_SCHEMA, 256);
    this.rideLines = createRideLines(this.rides.capacity);
    this.economy = createLedger();
    this.weather = createWeather();
    this.research = createResearch();
    this.scenario = createScenarioState();
    this.track = new TrackState();
    this.park = createParkState();
  }
}

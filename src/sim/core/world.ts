import { Prng } from './prng';
import { EntityStore } from './entity-store';
import { MAX_GUESTS, MAX_LITTER, MAX_STAFF, MAX_VEHICLES } from './constants';
import { TileMap } from '../map/tile-map';
import { generateTerrain } from '../map/terrain';
import { GUEST_SCHEMA } from '../guests/guest-store';
import { STAFF_SCHEMA } from '../staff/staff-store';
import { VEHICLE_SCHEMA } from '../vehicles/vehicle-store';
import { LITTER_SCHEMA } from '../guests/litter-store';
import { createLedger } from '../economy/ledger';
import type { Ledger } from '../economy/ledger';
import { createWeather } from '../weather/weather';
import type { WeatherState } from '../weather/weather';
import { createResearch } from '../research/research';
import type { ResearchState } from '../research/research';
import { createScenarioState } from '../scenario/scenario';
import type { ScenarioState } from '../scenario/scenario';
import { RIDE_SCHEMA } from '../rides/ride-store';

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
  readonly guests: EntityStore<typeof GUEST_SCHEMA>;
  readonly staff: EntityStore<typeof STAFF_SCHEMA>;
  readonly vehicles: EntityStore<typeof VEHICLE_SCHEMA>;
  readonly litter: EntityStore<typeof LITTER_SCHEMA>;
  readonly rides: EntityStore<typeof RIDE_SCHEMA>;
  readonly economy: Ledger;
  readonly weather: WeatherState;
  readonly research: ResearchState;
  readonly scenario: ScenarioState;

  constructor(opts: WorldOptions) {
    this.seed = opts.seed;
    this.rng = new Prng(opts.seed);
    this.map = new TileMap(opts.width, opts.height);
    generateTerrain(this.map, new Prng(opts.seed ^ 0x5eed));
    this.guests = new EntityStore(GUEST_SCHEMA, opts.maxGuests ?? MAX_GUESTS);
    this.staff = new EntityStore(STAFF_SCHEMA, MAX_STAFF);
    this.vehicles = new EntityStore(VEHICLE_SCHEMA, MAX_VEHICLES);
    this.litter = new EntityStore(LITTER_SCHEMA, MAX_LITTER);
    this.rides = new EntityStore(RIDE_SCHEMA, 256);
    this.economy = createLedger();
    this.weather = createWeather();
    this.research = createResearch();
    this.scenario = createScenarioState();
  }
}

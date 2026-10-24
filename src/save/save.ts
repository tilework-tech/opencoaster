import { World } from '../sim/core/world';
import type { EntityStore, Schema } from '../sim/core/entity-store';
import { restoreLedger, saveLedger } from '../sim/economy/ledger';
import type { LedgerSave } from '../sim/economy/ledger';
import { restoreResearch, saveResearch } from '../sim/research/research';
import type { ResearchSave } from '../sim/research/research';
import type { ScenarioState } from '../sim/scenario/scenario';

export const SAVE_VERSION = 4;
const PRE_RIDES_SAVE_VERSION = 3;
const MAGIC = 0x56534f43; // "COSV" little-endian

type StoreName = 'guests' | 'staff' | 'vehicles' | 'litter' | 'rides';
const STORE_NAMES: StoreName[] = ['guests', 'staff', 'vehicles', 'litter', 'rides'];

interface StoreHeader {
  capacity: number;
  count: number;
  freeTop: number;
}

interface Header {
  version: number;
  seed: number;
  width: number;
  height: number;
  tick: number;
  rng: number[];
  stores: Record<string, StoreHeader>;
  economy: LedgerSave;
  weather: { kind: number; temperature: number; ticksUntilChange: number };
  research: ResearchSave;
  scenario: ScenarioState;
  track: { pieces: StoreHeader; lastResult: number; lastPiece: number };
}

function views(world: World): ArrayBufferView[] {
  const out: ArrayBufferView[] = [...world.map.arrays()];
  for (const n of STORE_NAMES) out.push(...(world[n] as EntityStore<Schema>).arrays());
  out.push(...world.track.pieces.arrays(), ...world.track.rideTables());
  return out;
}

function legacyRideViews(world: World): ArrayBufferView[] {
  const [slotToId, idToSlot, freeIds] = world.rides.arrays();
  const capacity = world.rides.capacity;
  return [
    slotToId,
    idToSlot,
    freeIds,
    new Uint16Array(capacity),
    new Uint8Array(capacity),
    new Int16Array(capacity),
    new Int16Array(capacity),
    new Uint16Array(capacity),
    new Uint16Array(capacity),
    new Uint16Array(capacity),
    new Uint16Array(capacity),
    new Uint16Array(capacity),
    new Uint8Array(capacity),
    new Uint16Array(capacity),
  ];
}

function migrateLegacyRides(world: World, arrays: ArrayBufferView[]): void {
  const typeId = arrays[3] as Uint16Array;
  const entranceX = arrays[5] as Int16Array;
  const entranceY = arrays[6] as Int16Array;
  const excitement = arrays[7] as Uint16Array;
  const intensity = arrays[8] as Uint16Array;
  const nausea = arrays[9] as Uint16Array;
  const price = arrays[10] as Uint16Array;
  const queueLength = arrays[11] as Uint16Array;
  const reliability = arrays[12] as Uint8Array;
  const breakdownCounter = arrays[13] as Uint16Array;
  const rides = world.rides.cols;
  for (let slot = 0; slot < world.rides.count; slot++) {
    rides.typeId[slot] = typeId[slot];
    rides.state[slot] = 0;
    rides.phase[slot] = 0;
    rides.entranceX[slot] = entranceX[slot];
    rides.entranceY[slot] = entranceY[slot];
    rides.excitement[slot] = excitement[slot];
    rides.intensity[slot] = intensity[slot];
    rides.nausea[slot] = nausea[slot];
    rides.price[slot] = price[slot];
    rides.queueLength[slot] = queueLength[slot];
    rides.reliability[slot] = reliability[slot];
    rides.breakdownCounter[slot] = breakdownCounter[slot];
  }
}

/** Binary layout: [magic u32][headerLen u32][header JSON utf8][raw typed-array bytes...]. */
export function serialize(world: World): Uint8Array {
  const stores: Header['stores'] = {};
  for (const n of STORE_NAMES) {
    const s = world[n] as EntityStore<Schema>;
    stores[n] = { capacity: s.capacity, count: s.count, freeTop: s.freeCount };
  }
  const header: Header = {
    version: SAVE_VERSION,
    seed: world.seed,
    width: world.map.width,
    height: world.map.height,
    tick: world.tick,
    rng: Array.from(world.rng.state),
    stores,
    economy: saveLedger(world.economy),
    weather: { ...world.weather },
    research: saveResearch(world.research),
    scenario: { ...world.scenario },
    track: {
      pieces: {
        capacity: world.track.pieces.capacity,
        count: world.track.pieces.count,
        freeTop: world.track.pieces.freeCount,
      },
      lastResult: world.track.lastResult,
      lastPiece: world.track.lastPiece,
    },
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const vs = views(world);
  const total = 8 + headerBytes.length + vs.reduce((n, v) => n + v.byteLength, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, headerBytes.length, true);
  out.set(headerBytes, 8);
  let off = 8 + headerBytes.length;
  for (const v of vs) {
    out.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), off);
    off += v.byteLength;
  }
  return out;
}

export function deserialize(bytes: Uint8Array): World {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('Not an OpenCoaster save');
  const headerLen = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLen))) as Header;
  if (header.version !== SAVE_VERSION && header.version !== PRE_RIDES_SAVE_VERSION) {
    throw new Error(`Unsupported save version ${header.version}`);
  }
  const world = new World({
    seed: header.seed,
    width: header.width,
    height: header.height,
    maxGuests: header.stores.guests.capacity,
  });
  world.tick = header.tick;
  world.rng.state.set(header.rng);
  let off = 8 + headerLen;
  const allViews = views(world);
  const legacyViews = header.version === PRE_RIDES_SAVE_VERSION ? legacyRideViews(world) : [];
  const trackViews = [...world.track.pieces.arrays(), ...world.track.rideTables()];
  const rideViewEnd = allViews.length - trackViews.length;
  const rideViewStart = rideViewEnd - world.rides.arrays().length;
  const serializedViews =
    header.version === PRE_RIDES_SAVE_VERSION
      ? [...allViews.slice(0, rideViewStart), ...legacyViews, ...allViews.slice(rideViewEnd)]
      : allViews;
  for (const v of serializedViews) {
    new Uint8Array(v.buffer, v.byteOffset, v.byteLength).set(
      bytes.subarray(off, off + v.byteLength),
    );
    off += v.byteLength;
  }
  for (const n of STORE_NAMES) {
    const h = header.stores[n];
    (world[n] as EntityStore<Schema>).restore(h.count, h.freeTop);
  }
  world.track.pieces.restore(header.track.pieces.count, header.track.pieces.freeTop);
  world.track.lastResult = header.track.lastResult;
  world.track.lastPiece = header.track.lastPiece;
  restoreLedger(world.economy, header.economy);
  if (header.version === PRE_RIDES_SAVE_VERSION) migrateLegacyRides(world, legacyViews);
  Object.assign(world.weather, header.weather);
  restoreResearch(world.research, header.research);
  Object.assign(world.scenario, header.scenario);
  return world;
}

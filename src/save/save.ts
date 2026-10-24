import { World } from '../sim/core/world';
import type { EntityStore, Schema } from '../sim/core/entity-store';

export const SAVE_VERSION = 1;
const MAGIC = 0x56534f43; // "COSV" little-endian

type StoreName = 'guests' | 'staff' | 'vehicles' | 'litter' | 'rides';
const STORE_NAMES: StoreName[] = ['guests', 'staff', 'vehicles', 'litter', 'rides'];

interface Header {
  version: number;
  seed: number;
  width: number;
  height: number;
  tick: number;
  rng: number[];
  stores: Record<string, { capacity: number; count: number; freeTop: number }>;
  economy: { cash: number; loan: number; monthly: number[] };
  weather: { kind: number; temperature: number; ticksUntilChange: number };
  research: {
    funding: number;
    progress: number;
    currentItemId: number;
    unlocked: number[];
  };
}

function views(world: World): ArrayBufferView[] {
  const out: ArrayBufferView[] = [world.map.heights, world.map.surface, world.map.flags];
  for (const n of STORE_NAMES) out.push(...(world[n] as EntityStore<Schema>).arrays());
  return out;
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
    economy: {
      cash: world.economy.cash,
      loan: world.economy.loan,
      monthly: Array.from(world.economy.monthlyTotals),
    },
    weather: { ...world.weather },
    research: {
      funding: world.research.funding,
      progress: world.research.progress,
      currentItemId: world.research.currentItemId,
      unlocked: Array.from(world.research.unlocked),
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
  if (header.version !== SAVE_VERSION) {
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
  for (const v of views(world)) {
    new Uint8Array(v.buffer, v.byteOffset, v.byteLength).set(
      bytes.subarray(off, off + v.byteLength),
    );
    off += v.byteLength;
  }
  for (const n of STORE_NAMES) {
    const h = header.stores[n];
    (world[n] as EntityStore<Schema>).restore(h.count, h.freeTop);
  }
  world.economy.cash = header.economy.cash;
  world.economy.loan = header.economy.loan;
  world.economy.monthlyTotals.set(header.economy.monthly);
  Object.assign(world.weather, header.weather);
  world.research.funding = header.research.funding;
  world.research.progress = header.research.progress;
  world.research.currentItemId = header.research.currentItemId;
  world.research.unlocked = new Set(header.research.unlocked);
  return world;
}

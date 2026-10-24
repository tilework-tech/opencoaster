import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, deserialize } from './save';

/** A save whose header is exactly `header`, with no columns after it. */
function saveWithHeader(header: object): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(8 + json.length);
  out.set(new TextEncoder().encode('COSV'), 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  return out;
}

const store = { capacity: 10, count: 0, freeTop: 0 };
const stores = { guests: store, staff: store, vehicles: store, litter: store, rides: store };

describe('deserialize header bounds', () => {
  it('refuses a map size that would allocate an unreasonable world', () => {
    const bytes = saveWithHeader({ version: SAVE_VERSION, width: 100_000, height: 8, stores });
    expect(() => deserialize(bytes)).toThrow(/invalid map size/);
  });

  it('refuses an entity capacity that would allocate an unreasonable store', () => {
    const huge = { ...store, capacity: 10_000_000 };
    const bytes = saveWithHeader({
      version: SAVE_VERSION,
      width: 8,
      height: 8,
      stores: { ...stores, guests: huge },
    });
    expect(() => deserialize(bytes)).toThrow(/invalid guests capacity/);
  });

  it('refuses a header with no store records instead of reading undefined', () => {
    const bytes = saveWithHeader({ version: SAVE_VERSION, width: 8, height: 8 });
    expect(() => deserialize(bytes)).toThrow(/invalid guests capacity/);
  });
});

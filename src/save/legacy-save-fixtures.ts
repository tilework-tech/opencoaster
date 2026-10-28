import { Simulation } from '../sim/core/simulation';
import type { World } from '../sim/core/world';
import { STAFF_STAT_COLUMNS } from '../sim/staff/staff-store';

/** Guest sight-memory and staff activity columns that saves before version 32 did not store. */
export function statsVersionColumns(world: World): ArrayBufferView[] {
  return [
    world.guests.cols.sightMemory,
    ...STAFF_STAT_COLUMNS.map((name) => world.staff.cols[name]),
  ];
}

export function allWorldViews(world: World): ArrayBufferView[] {
  return [
    ...world.map.arrays(),
    ...world.guests.arrays(),
    ...world.staff.arrays(),
    ...world.vehicles.arrays(),
    ...world.litter.arrays(),
    ...world.rides.arrays(),
    ...world.track.pieces.arrays(),
    ...world.track.rideTables(),
  ];
}

/**
 * Rewrites a current save as `version` would have written it: the header carries that version and
 * the listed columns, which that version did not have, are removed from the body.
 */
export function withoutColumns(
  current: Uint8Array,
  version: number,
  views: ArrayBufferView[],
  absent: ArrayBufferView[],
): Uint8Array {
  const dv = new DataView(current.buffer, current.byteOffset, current.byteLength);
  const headerLength = dv.getUint32(4, true);
  const headerEnd = 8 + headerLength;
  const header = JSON.parse(new TextDecoder().decode(current.subarray(8, headerEnd)));
  header.version = version;
  if (version < 15) delete header.weather.climate;
  const encoded = new TextEncoder().encode(JSON.stringify(header));
  const body = current.subarray(headerEnd);
  const newWorld = new Simulation({
    seed: header.seed,
    width: header.width,
    height: header.height,
    maxGuests: header.stores.guests.capacity,
  }).world;
  const currentViews = [
    ...newWorld.map.arrays(),
    ...newWorld.guests.arrays(),
    ...newWorld.staff.arrays(),
    ...newWorld.vehicles.arrays(),
    ...newWorld.litter.arrays(),
    ...newWorld.rides.arrays(),
    ...newWorld.track.pieces.arrays(),
    ...newWorld.track.rideTables(),
  ];
  const additions = [
    ...(version < 15
      ? [
          newWorld.guests.cols.litterMemory,
          newWorld.guests.cols.angriness,
          newWorld.staff.cols.sweeps,
          newWorld.litter.cols.birthOrder,
        ]
      : []),
    ...(version < 16 ? [newWorld.staff.cols.vandalsStopped] : []),
    ...(version < 17 ? [newWorld.map.pathStyle] : []),
    ...(version < 32 ? statsVersionColumns(newWorld) : []),
    ...(version < 18 ? [newWorld.guests.cols.voucherKind, newWorld.guests.cols.voucherTarget] : []),
    ...(version < 29 ? [newWorld.guests.cols.happinessTarget] : []),
    ...(version < 30
      ? [
          newWorld.rides.cols.downtimeBucket0,
          newWorld.rides.cols.downtimeBucket1,
          newWorld.rides.cols.downtimeBucket2,
          newWorld.rides.cols.downtimeBucket3,
          newWorld.rides.cols.downtimeBucket4,
          newWorld.rides.cols.downtimeBucket5,
          newWorld.rides.cols.downtimeBucket6,
          newWorld.rides.cols.downtimeBucket7,
          newWorld.rides.cols.downtimePercent,
          newWorld.rides.cols.mechanicHeadingTick,
        ]
      : []),
    ...(version < 32
      ? [
          newWorld.rides.cols.testAverageSpeed,
          newWorld.rides.cols.testRideLength,
          newWorld.rides.cols.testAirtimeTicks,
        ]
      : []),
    ...(version < 23
      ? [
          newWorld.guests.cols.queueSeq,
          newWorld.rides.cols.queueSerial,
          newWorld.rides.cols.queueLimit,
        ]
      : []),
  ];
  const absentSet = new Set([
    ...absent,
    ...additions.map((column) => views[currentViews.indexOf(column)]),
  ]);
  const kept: Uint8Array[] = [];
  let offset = 0;
  for (const view of views) {
    if (!absentSet.has(view)) {
      kept.push(body.subarray(offset, offset + view.byteLength));
    }
    offset += view.byteLength;
  }
  const bodyBytes = kept.reduce((n, part) => n + part.byteLength, 0);
  const out = new Uint8Array(8 + encoded.length + bodyBytes);
  out.set(current.subarray(0, 8));
  new DataView(out.buffer).setUint32(4, encoded.length, true);
  out.set(encoded, 8);
  let at = 8 + encoded.length;
  for (const part of kept) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

import { describe, expect, it } from 'vitest';
import { World } from '../sim/core/world';
import { OWNED, Surface } from '../sim/map/tile-map';
import { RideState } from '../sim/rides/ride-store';
import { RideType } from '../sim/rides/ride-types';
import { rideCoversTile } from '../sim/rides/ride-footprint';
import { createRide } from '../sim/rides/ride-operations';
import { deserialize, serialize } from './save';
import { shopItemsVersionColumns, statsVersionColumns } from './legacy-save-fixtures';

function park(): World {
  const w = new World({ seed: 3, width: 24, height: 24 });
  w.map.fillFlat(4);
  w.map.ownership.fill(OWNED);
  return w;
}

/** Rewrites a current save as a version 19 one: no orientation or queue columns, old version number. */
function asVersion19(w: World): Uint8Array {
  const bytes = serialize(w);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength)));
  header.version = 19;
  const newHeader = new TextEncoder().encode(JSON.stringify(header));
  const arrays = [
    ...w.map.arrays(),
    ...w.guests.arrays(),
    ...w.staff.arrays(),
    ...w.vehicles.arrays(),
    ...w.litter.arrays(),
    ...w.rides.arrays(),
    ...w.track.pieces.arrays(),
    ...w.track.rideTables(),
  ];
  const dropped = new Set<ArrayBufferView>([
    w.rides.cols.dir,
    w.rides.cols.queueSerial,
    w.rides.cols.queueLimit,
    w.guests.cols.queueSeq,
    w.guests.cols.happinessTarget,
    ...statsVersionColumns(w),
    ...shopItemsVersionColumns(w),
  ]);
  const body = bytes.subarray(8 + headerLength);
  const kept: Uint8Array[] = [];
  let offset = 0;
  for (const array of arrays) {
    if (!dropped.has(array)) kept.push(body.subarray(offset, offset + array.byteLength));
    offset += array.byteLength;
  }
  expect(offset).toBe(body.byteLength);
  const out = new Uint8Array(8 + newHeader.length + kept.reduce((n, part) => n + part.length, 0));
  const outView = new DataView(out.buffer);
  outView.setUint32(0, view.getUint32(0, true), true);
  outView.setUint32(4, newHeader.length, true);
  out.set(newHeader, 8);
  let at = 8 + newHeader.length;
  for (const part of kept) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe('flat ride footprints in saves', () => {
  it('round-trips the orientation', () => {
    const w = park();
    createRide(w, RideType.SwingingShip, 10, 10, 3);
    const restored = deserialize(serialize(w));
    expect(restored.rides.cols.dir[0]).toBe(3);
  });

  it('gives a one-tile ride from an older save a footprint covering its old tile', () => {
    const w = park();
    const id = createRide(w, RideType.MerryGoRound, 10, 10);
    const restored = deserialize(asVersion19(w));
    const slot = restored.rides.idToSlot[id];
    expect(rideCoversTile(restored, slot, 10, 10)).toBe(true);
    expect(restored.rides.cols.typeId[slot]).toBe(RideType.MerryGoRound);
  });

  it('turns an old ride away from the paths around it', () => {
    const w = park();
    createRide(w, RideType.SwingingShip, 10, 10);
    for (let x = 6; x <= 14; x++) if (x !== 10) w.map.surface[w.map.index(x, 10)] = Surface.Path;
    const restored = deserialize(asVersion19(w));
    const covered: Array<[number, number]> = [];
    for (let x = 0; x < 24; x++)
      for (let y = 0; y < 24; y++) if (rideCoversTile(restored, 0, x, y)) covered.push([x, y]);
    expect(covered).toHaveLength(5);
    expect(covered.every(([x]) => x === 10)).toBe(true);
  });

  it('moves the footprint off the entrance and exit when it can', () => {
    const w = park();
    const id = createRide(w, RideType.Twist, 10, 10);
    const ride = w.rides.cols;
    ride.entranceX[0] = 10;
    ride.entranceY[0] = 11;
    ride.exitX[0] = 11;
    ride.exitY[0] = 10;
    ride.entrancePlaced[0] = 1;
    ride.exitPlaced[0] = 1;
    const restored = deserialize(asVersion19(w));
    const slot = restored.rides.idToSlot[id];
    expect(restored.rides.cols.entrancePlaced[slot]).toBe(1);
    expect(restored.rides.cols.exitPlaced[slot]).toBe(1);
    expect(rideCoversTile(restored, slot, 10, 10)).toBe(true);
    expect(rideCoversTile(restored, slot, 10, 11)).toBe(false);
    expect(rideCoversTile(restored, slot, 11, 10)).toBe(false);
  });

  it('drops a boarding tile that cannot stay outside the footprint and closes the ride', () => {
    const w = park();
    const id = createRide(w, RideType.Twist, 10, 10);
    const ride = w.rides.cols;
    ride.entranceX[0] = 10;
    ride.entranceY[0] = 11;
    ride.exitX[0] = 10;
    ride.exitY[0] = 9;
    ride.entrancePlaced[0] = 1;
    ride.exitPlaced[0] = 1;
    ride.state[0] = RideState.Open;
    const restored = deserialize(asVersion19(w));
    const slot = restored.rides.idToSlot[id];
    const placed = restored.rides.cols.entrancePlaced[slot] + restored.rides.cols.exitPlaced[slot];
    expect(placed).toBe(1);
    expect(restored.rides.cols.state[slot]).toBe(RideState.Closed);
  });
});

import type { World } from '../sim/core/world';
import type { EntityStore, Schema } from '../sim/core/entity-store';

/** Ints per entity in a layer: x, y, z (fixed-point), then (state << 8) | tint/kind. */
export const SNAPSHOT_STRIDE = 4;
export const SNAPSHOT_RIDE_CAPACITY = 256;

export interface SnapshotLayer {
  count: number;
  data: Int32Array;
}

export interface Snapshot {
  tick: number;
  guests: SnapshotLayer;
  staff: SnapshotLayer;
  vehicles: SnapshotLayer;
  litter: SnapshotLayer;
  rides: SnapshotLayer;
  tracks?: SnapshotLayer;
  park: { cash: number; loan: number; rides: number };
}

export interface SnapshotCapacities {
  guests: number;
  staff: number;
  vehicles: number;
  litter: number;
  rides?: number;
}

export function createSnapshot(caps: SnapshotCapacities): Snapshot {
  const layer = (n: number): SnapshotLayer => ({
    count: 0,
    data: new Int32Array(n * SNAPSHOT_STRIDE),
  });
  return {
    tick: 0,
    guests: layer(caps.guests),
    staff: layer(caps.staff),
    vehicles: layer(caps.vehicles),
    litter: layer(caps.litter),
    rides: layer(caps.rides ?? SNAPSHOT_RIDE_CAPACITY),
    park: { cash: 0, loan: 0, rides: 0 },
  };
}

export function snapshotBuffers(s: Snapshot): ArrayBuffer[] {
  return [s.guests, s.staff, s.vehicles, s.litter, s.rides].map(
    (l) => l.data.buffer as ArrayBuffer,
  );
}

type PosCols = { x: Int32Array; y: Int32Array; z: Int32Array };

function writeLayer<S extends Schema>(
  layer: SnapshotLayer,
  store: EntityStore<S>,
  variant: Uint8Array,
  state: Uint8Array | null,
): void {
  const { x, y, z } = store.cols as unknown as PosCols;
  const n = Math.min(store.count, layer.data.length / SNAPSHOT_STRIDE);
  const d = layer.data;
  for (let i = 0, o = 0; i < n; i++, o += SNAPSHOT_STRIDE) {
    d[o] = x[i];
    d[o + 1] = y[i];
    d[o + 2] = z[i];
    d[o + 3] = ((state ? state[i] : 0) << 8) | variant[i];
  }
  layer.count = n;
}

export function writeSnapshot(world: World, out: Snapshot): void {
  out.tick = world.tick;
  writeLayer(out.guests, world.guests, world.guests.cols.tint, world.guests.cols.state);
  writeLayer(out.staff, world.staff, world.staff.cols.kind, world.staff.cols.state);
  writeLayer(out.vehicles, world.vehicles, world.vehicles.cols.state, null);
  writeLayer(out.litter, world.litter, world.litter.cols.kind, null);
  const rides = world.rides;
  const rideData = out.rides.data;
  const rideCount = Math.min(rides.count, rideData.length / SNAPSHOT_STRIDE);
  for (let i = 0, o = 0; i < rideCount; i++, o += SNAPSHOT_STRIDE) {
    const x = rides.cols.entranceX[i];
    const y = rides.cols.entranceY[i];
    const mapIndex = world.map.index(x, y);
    rideData[o] = x * 256 + 128;
    rideData[o + 1] = y * 256 + 128;
    rideData[o + 2] = world.map.inBounds(x, y) ? world.map.heights[mapIndex] * 64 : 0;
    rideData[o + 3] = (rides.cols.state[i] << 8) | (rides.cols.typeId[i] & 0xff);
  }
  out.rides.count = rideCount;
  out.park.cash = world.economy.cash;
  out.park.loan = world.economy.loan;
  out.park.rides = rides.count;
}

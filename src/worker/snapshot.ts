import type { World } from '../sim/core/world';
import type { EntityStore, Schema } from '../sim/core/entity-store';

/** Ints per entity in a layer: x, y, z (fixed-point), then (state << 8) | tint/kind. */
export const SNAPSHOT_STRIDE = 4;

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
}

export interface SnapshotCapacities {
  guests: number;
  staff: number;
  vehicles: number;
  litter: number;
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
  };
}

export function snapshotBuffers(s: Snapshot): ArrayBuffer[] {
  return [s.guests, s.staff, s.vehicles, s.litter].map((l) => l.data.buffer as ArrayBuffer);
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
}

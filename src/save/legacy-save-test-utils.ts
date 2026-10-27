import type { World } from '../sim/core/world';

/** Serializes the older ride-store tail used by saves before v27 and patches the version header. */
export function serializeAsLegacyRideSchema(world: World, bytes: Uint8Array, version: number) {
  const headerLen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    4,
    true,
  );
  const header = new TextDecoder().decode(bytes.subarray(8, 8 + headerLen));
  const oldHeader = new TextEncoder().encode(header.replace(/("version":)\d+/, `$1${version}`));
  const prefix = [
    ...world.map.arrays(),
    ...world.guests.arrays(),
    ...world.staff.arrays(),
    ...world.vehicles.arrays(),
    ...world.litter.arrays(),
  ];
  const rideArrays = world.rides.arrays();
  const removed = rideArrays.slice(-3).reduce((length, view) => length + view.byteLength, 0);
  const offset =
    8 +
    headerLen +
    prefix.reduce((length, view) => length + view.byteLength, 0) +
    rideArrays.slice(0, -3).reduce((length, view) => length + view.byteLength, 0);
  return join(
    bytes.subarray(0, 8),
    oldHeader,
    bytes.subarray(8 + headerLen, offset),
    bytes.subarray(offset + removed),
  );
}

function join(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.byteLength;
  }
  return output;
}

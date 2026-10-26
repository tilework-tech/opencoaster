import type { Camera, MapData } from '../../render/renderer';
import { project } from '../../render/projection';
import type { GuestSelection } from '../../ui/game-ui';
import type { SimClient } from '../../worker/sim-client';
import { GUEST_DETAIL_STRIDE, guestRowState } from '../../worker/snapshot';
import { TILE_UNITS } from '../../sim/core/constants';

export function findGuestAt(
  screenX: number,
  screenY: number,
  viewportWidth: number,
  viewportHeight: number,
  map: MapData,
  camera: Camera,
  sim: SimClient,
): GuestSelection | null {
  const layer = sim.latest?.guests;
  if (!layer) return null;
  const projected = new Float64Array(2);
  let nearest = -1;
  let nearestDistance = 13 * 13;
  for (let i = 0, offset = 0; i < layer.count; i++, offset += 4) {
    project(
      layer.data[offset],
      layer.data[offset + 1],
      layer.data[offset + 2],
      map.width,
      map.height,
      camera.rotation,
      projected,
    );
    const x = viewportWidth / 2 + (projected[0] - camera.x) * camera.zoom;
    const y = viewportHeight / 2 + (projected[1] - camera.y) * camera.zoom;
    const dx = x - screenX;
    const dy = y - screenY;
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearest = i;
      nearestDistance = distance;
    }
  }
  if (nearest < 0) return null;
  const offset = nearest * 4;
  const x = layer.data[offset];
  const y = layer.data[offset + 1];
  const state = guestRowState(layer.data[offset + 3]);
  const tileX = Math.floor(x / TILE_UNITS);
  const tileY = Math.floor(y / TILE_UNITS);
  const detailOffset = nearest * GUEST_DETAIL_STRIDE;
  const snapshot = sim.latest;
  const details = snapshot?.guestDetails;
  if (!snapshot || !details) return null;
  return {
    id: snapshot.guestIds[nearest],
    number: nearest + 1,
    tileX,
    tileY,
    state: guestState(state),
    happiness: details[detailOffset],
    hunger: details[detailOffset + 1],
    thirst: details[detailOffset + 2],
    toilet: details[detailOffset + 3],
    nausea: details[detailOffset + 4],
    energy: details[detailOffset + 5],
    cash: details[detailOffset + 6],
    thoughts: Array.from(
      { length: 4 },
      (_, i) => details[detailOffset + 8 + ((details[detailOffset + 7] + i) & 3)],
    ),
    tick: snapshot.tick,
  };
}

function guestState(state: number): string {
  return (
    ['walking', 'queueing', 'riding', 'leaving', 'shopping', 'waiting to board'][state] ??
    `state ${state}`
  );
}

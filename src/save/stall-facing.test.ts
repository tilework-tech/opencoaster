import { describe, expect, it } from 'vitest';
import { World } from '../sim/core/world';
import { flatWorld } from '../sim/integration/fixtures';
import { placePath } from '../sim/map/paths';
import { createRide } from '../sim/rides/ride-operations';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { RideResult } from '../sim/rides/ride-results';
import { RideState } from '../sim/rides/ride-store';
import { stallFrontProblem } from '../sim/rides/stall-front';
import { SCENARIOS } from '../sim/scenario/catalog';
import { prepareScenario } from '../sim/scenario/scenario-layout';
import { deserialize, serialize } from './save';

function isShop(world: World, slot: number): boolean {
  const category = RIDE_CATALOG[world.rides.cols.typeId[slot] as RideType]?.category;
  return category === 'stall' || category === 'facility';
}

/**
 * A park saved before stalls stored a front: its stall has the default quarter turn and its access
 * tile is wherever the old adjacent-path search found one.
 */
function legacyStall(entrance: readonly [number, number] | null): { world: World; rideId: number } {
  const world = flatWorld(16);
  const rideId = createRide(world, RideType.FoodStall, 6, 6);
  const slot = world.rides.idToSlot[rideId]!;
  const cols = world.rides.cols;
  cols.dir[slot] = 0;
  if (entrance) {
    placePath(world.map, { x: entrance[0], y: entrance[1] });
    cols.entranceX[slot] = entrance[0];
    cols.entranceY[slot] = entrance[1];
    cols.entrancePlaced[slot] = 1;
    cols.state[slot] = RideState.Open;
  } else {
    cols.entranceX[slot] = 6;
    cols.entranceY[slot] = 6;
    cols.entrancePlaced[slot] = 0;
    cols.state[slot] = RideState.Closed;
  }
  return { world, rideId };
}

describe('stall facing in saves', () => {
  it.each([
    [[7, 6], 0],
    [[6, 7], 1],
    [[5, 6], 2],
    [[6, 5], 3],
  ] as const)('loads an older stall served from %j facing that tile (%i)', (entrance, dir) => {
    const { world, rideId } = legacyStall(entrance);
    const loaded = deserialize(serialize(world));
    const slot = loaded.rides.idToSlot[rideId]!;

    expect(loaded.rides.cols.dir[slot]).toBe(dir);
    expect(stallFrontProblem(loaded, rideId)).toBe(RideResult.Ok);
    expect(loaded.rides.cols.state[slot]).toBe(RideState.Open);
  });

  it('loads an older stall facing the tile guests used, not another adjacent path', () => {
    const { world, rideId } = legacyStall([6, 5]);
    placePath(world.map, { x: 7, y: 6 });
    const loaded = deserialize(serialize(world));

    expect(loaded.rides.cols.dir[loaded.rides.idToSlot[rideId]!]).toBe(3);
    expect(stallFrontProblem(loaded, rideId)).toBe(RideResult.Ok);
  });

  it('loads an older unconnected stall facing the path it was drawn toward, still closed', () => {
    const { world, rideId } = legacyStall(null);
    placePath(world.map, { x: 6, y: 5 });
    const loaded = deserialize(serialize(world));
    const slot = loaded.rides.idToSlot[rideId]!;

    expect(loaded.rides.cols.dir[slot]).toBe(3);
    expect(stallFrontProblem(loaded, rideId)).toBe(RideResult.Ok);
    expect(loaded.rides.cols.state[slot]).toBe(RideState.Closed);
  });

  it('keeps a turned stall facing away from a side path after its front path is removed', () => {
    const world = flatWorld(16);
    const rideId = createRide(world, RideType.FoodStall, 6, 6, 1);
    placePath(world.map, { x: 5, y: 6 });
    const loaded = deserialize(serialize(world));
    expect(loaded.rides.cols.dir[loaded.rides.idToSlot[rideId]!]).toBe(1);
    expect(stallFrontProblem(loaded, rideId)).toBe(RideResult.StallNoPath);
  });

  it.each([0, 1, 2, 3])('keeps a stall facing %i through save and load', (dir) => {
    const world = flatWorld(16);
    const rideId = createRide(world, RideType.Toilets, 6, 6, dir);
    const loaded = deserialize(serialize(deserialize(serialize(world))));
    expect(loaded.rides.cols.dir[loaded.rides.idToSlot[rideId]!]).toBe(dir);
  });

  it('has shipped scenarios with pre-built stalls to check', () => {
    const shops = SCENARIOS.reduce((total, def) => {
      const world = new World({ seed: def.seed, width: def.mapWidth, height: def.mapHeight });
      prepareScenario(world, def);
      let count = 0;
      for (let slot = 0; slot < world.rides.count; slot++) if (isShop(world, slot)) count++;
      return total + count;
    }, 0);
    expect(shops).toBeGreaterThan(0);
  });

  it.each(SCENARIOS.map((def) => [def.id, def] as const))(
    '%s keeps every pre-built stall connected and open after save and load',
    (_id, def) => {
      const world = new World({ seed: def.seed, width: def.mapWidth, height: def.mapHeight });
      prepareScenario(world, def);
      const loaded = deserialize(serialize(world));
      for (const w of [world, loaded]) {
        for (let slot = 0; slot < w.rides.count; slot++) {
          if (!isShop(w, slot)) continue;
          const rideId = w.rides.slotToId[slot]!;
          expect(stallFrontProblem(w, rideId)).toBe(RideResult.Ok);
          expect(w.rides.cols.state[slot]).toBe(RideState.Open);
        }
      }
    },
  );
});

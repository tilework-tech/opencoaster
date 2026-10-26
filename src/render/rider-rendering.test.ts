import { describe, expect, it } from 'vitest';
import { GuestState } from '../sim/guests/guest-store';
import { RideType } from '../sim/rides/ride-types';
import {
  buildCircuit,
  connectStation,
  createCoaster,
  flatOwnedSim,
  queueGuests,
  run,
} from '../sim/rides/coaster-fixtures';
import { createSnapshot, guestRowState, writeSnapshot } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import { TILE_UNITS } from '../sim/core/constants';
import { project } from './projection';
import { spawnGuest } from '../sim/guests/guest-store';
import { CoasterScene, MAX_SEATED_RIDERS } from './coaster-scene';
import { Canvas2DRenderer } from './canvas2d-renderer';
import type { MapData } from './renderer';
import { spritePages } from './sprite-pages';
import type { PageImage, SpriteEntry } from './sprite-pages';

function stubAtlas(names: string[]): void {
  const sprites: Record<string, SpriteEntry> = {};
  for (const name of names)
    sprites[name] = {
      category: 'world',
      frames: Array.from({ length: 160 }, (_, i) => ({ page: 0, x: i, y: 2, width: 8, height: 8 })),
      anchor: { x: 4, y: 8 },
      footprint: { width: 1, height: 1 },
    };
  spritePages.install(
    {
      pages: [{ file: 'atlas/world-0.png', width: 256, height: 64, category: 'world' }],
      categories: { world: { lazy: false, pages: [0] } },
      sprites,
    },
    new Map([[0, {} as PageImage]]),
  );
}

function mapOf(sim: ReturnType<typeof flatOwnedSim>): MapData {
  const m = sim.world.map;
  return {
    width: m.width,
    height: m.height,
    heights: m.heights,
    surface: m.surface,
    slope: m.slope,
    waterLevel: m.waterLevel,
  } as unknown as MapData;
}

function drawGuestSprites(snapshot: Snapshot, map: MapData, rotation: 0 | 1 | 2 | 3): number {
  let guestDraws = 0;
  const context = {
    canvas: { width: 1, height: 1 },
    imageSmoothingEnabled: true,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    drawImage: () => {
      guestDraws++;
    },
    setTransform() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    closePath() {},
    fill() {},
    arc() {},
    stroke() {},
    save() {},
    restore() {},
    transform() {},
    clip() {},
  };
  const renderer = new Canvas2DRenderer();
  renderer.attach({ getContext: () => context } as unknown as HTMLCanvasElement);
  renderer.resize(2000, 2000, 1);
  renderer.setMap(map);
  const centre = new Float64Array(2);
  project(20 * TILE_UNITS, 20 * TILE_UNITS, 0, map.width, map.height, rotation, centre);
  renderer.draw(snapshot, { x: centre[0]!, y: centre[1]!, zoom: 1, rotation });
  return guestDraws;
}

function coasterWithRiders() {
  const sim = flatOwnedSim();
  const rideId = createCoaster(sim, RideType.WoodenCoaster);
  buildCircuit(sim, rideId);
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
  run(sim, 8000);
  connectStation(sim, rideId);
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
  sim.step();
  return { sim, rideId };
}

describe('riders are not drawn as walking guests', () => {
  it('draws only non-riding guests with the walking sprite', () => {
    stubAtlas(['people/guest-walk']);
    const { sim, rideId } = coasterWithRiders();
    queueGuests(sim, rideId, 6);
    run(sim, 600);
    for (let i = 0; i < 3; i++) {
      spawnGuest(sim.world);
      const walker = sim.world.guests.count - 1;
      sim.world.guests.cols.x[walker] = 20 * TILE_UNITS + 40 * i;
      sim.world.guests.cols.y[walker] = 18 * TILE_UNITS;
      sim.world.guests.cols.state[walker] = GuestState.Wandering;
    }
    const guests = sim.world.guests.cols;
    let riding = 0;
    for (let g = 0; g < sim.world.guests.count; g++)
      if (guests.state[g] === GuestState.Riding) riding++;
    const snapshot = createSnapshot({ guests: 64, staff: 0, vehicles: 16, litter: 0 });
    writeSnapshot(sim.world, snapshot);

    expect(riding).toBeGreaterThan(0);
    for (let g = 0; g < snapshot.guests.count; g++)
      expect(guestRowState(snapshot.guests.data[g * 4 + 3])).toBe(guests.state[g]);
    const visibleWalkers = sim.world.guests.count - riding;
    for (const rotation of [0, 1, 2, 3] as const)
      expect(drawGuestSprites(snapshot, mapOf(sim), rotation)).toBe(visibleWalkers);
  });

  it('seats riders in coaster cars but leaves flume boats and chairs to their own art', () => {
    const { sim, rideId } = coasterWithRiders();
    queueGuests(sim, rideId, 6);
    run(sim, 600);
    const snapshot = createSnapshot({ guests: 64, staff: 0, vehicles: 16, litter: 0 });
    writeSnapshot(sim.world, snapshot);
    const scene = new CoasterScene();
    scene.build(snapshot, mapOf(sim), 0);
    expect(scene.items.slice(0, scene.length).every((item) => item.rideId === rideId)).toBe(true);
    const keys = scene.items.slice(0, scene.length).map((item) => item.key);
    const seated = keys.filter((key) => key.startsWith('people/rider-seated'));
    let carPassengers = 0;
    for (let i = 0; i < snapshot.cars.count; i++)
      carPassengers += Math.min(MAX_SEATED_RIDERS, (snapshot.cars.data[i * 4 + 3] >> 9) & 7);
    expect(carPassengers).toBeGreaterThan(0);
    expect(seated).toHaveLength(carPassengers);
  });
});

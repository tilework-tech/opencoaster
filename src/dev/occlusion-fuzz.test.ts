import { describe, expect, it } from 'vitest';
import { buildFuzzPark } from './occlusion-fuzz';
import type { FuzzPark } from './occlusion-fuzz';
import { PathFlag } from '../sim/map/tile-map';
import { SCENERY_CATALOG, SceneryCategory, isWallScenery } from '../sim/map/scenery';
import type { SceneryItem } from '../sim/map/scenery';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import type { RideType } from '../sim/rides/ride-types';
import {
  RIDE_INFO_STRIDE,
  RideFlag,
  RideInfo,
  SNAPSHOT_STRIDE,
  isRidingGuestRow,
} from '../worker/snapshot';
import type { SnapshotLayer } from '../worker/snapshot';

const SEEDS = [1, 2, 3, 4, 5, 6];

function pathFlags(park: FuzzPark): number[] {
  const { pathElements, pathCount } = park.map;
  return Array.from({ length: pathCount ?? 0 }, (_, i) => pathElements![i * 6 + 3]!);
}

function sceneryItems(park: FuzzPark): SceneryItem[] {
  const { sceneryElements, sceneryCount } = park.map;
  return Array.from(
    { length: sceneryCount ?? 0 },
    (_, i) => sceneryElements![i * 5 + 4]! as SceneryItem,
  );
}

function rideRows(park: FuzzPark): Int32Array[] {
  const { snapshot } = park;
  return Array.from({ length: snapshot.rides.count }, (_, i) =>
    snapshot.rideInfo.subarray(i * RIDE_INFO_STRIDE, (i + 1) * RIDE_INFO_STRIDE),
  );
}

function layerWords(layer: SnapshotLayer): number[] {
  return [layer.count, ...layer.data.subarray(0, layer.count * SNAPSHOT_STRIDE)];
}

/** Every number the renderer reads from the park, in a fixed order. */
function fingerprint(park: FuzzPark): string {
  const { map, snapshot } = park;
  const parts: ArrayLike<number>[] = [
    [map.width, map.height, map.entranceX ?? -1, map.entranceY ?? -1],
    map.heights,
    map.surface,
    map.slope,
    map.waterLevel ?? [],
    map.ownership ?? [],
    map.pathElements ?? [],
    map.sceneryElements ?? [],
    ...[
      snapshot.guests,
      snapshot.staff,
      snapshot.vehicles,
      snapshot.cars,
      snapshot.litter,
      snapshot.rides,
      snapshot.tracks,
    ].map(layerWords),
    snapshot.rideInfo.subarray(0, snapshot.rides.count * RIDE_INFO_STRIDE),
    snapshot.grounds,
    [park.focus.x, park.focus.y, park.focus.z],
  ];
  return parts.map((part) => Array.from(part).join(',')).join('|');
}

describe('buildFuzzPark', () => {
  describe.each(SEEDS)('seed %i', (seed) => {
    const park = buildFuzzPark(seed);
    const { map, snapshot } = park;
    const tiles = map.width * map.height;

    it('has water, slopes and several terrain heights', () => {
      let water = 0;
      let sloped = 0;
      const heights = new Set<number>();
      for (let i = 0; i < tiles; i++) {
        if (map.waterLevel![i]! > map.heights[i]!) water++;
        if (map.slope[i] !== 0) sloped++;
        heights.add(map.heights[i]!);
      }
      expect(water).toBeGreaterThan(0);
      expect(sloped).toBeGreaterThan(0);
      expect(heights.size).toBeGreaterThanOrEqual(2);
    });

    it('has sloped and queue footpaths with every path addition', () => {
      const flags = pathFlags(park);
      expect(flags.some((f) => (f & PathFlag.Sloped) !== 0)).toBe(true);
      expect(flags.some((f) => (f & PathFlag.Queue) !== 0)).toBe(true);
      for (const addition of [PathFlag.Bench, PathFlag.Bin, PathFlag.Lamp, PathFlag.Shelter])
        expect(flags.some((f) => (f & addition) !== 0)).toBe(true);
    });

    it('has trees and walls', () => {
      const items = sceneryItems(park);
      const trees = items.filter(
        (item) => SCENERY_CATALOG[item]!.category === SceneryCategory.Trees,
      );
      expect(trees.length).toBeGreaterThanOrEqual(3);
      expect(items.some((item) => isWallScenery(item))).toBe(true);
    });

    it('has a multi-tile flat ride, a coaster with a train, and boarding tiles', () => {
      const rows = rideRows(park);
      const defs = rows.map((row) => RIDE_CATALOG[row[RideInfo.Type] as RideType]);
      expect(defs.some((def) => !def.usesTrack && def.footprint.length > 1)).toBe(true);
      expect(defs.some((def) => !def.usesTrack && def.footprint.length === 1)).toBe(true);
      expect(defs.some((def) => def.usesTrack)).toBe(true);
      expect(snapshot.tracks.count).toBeGreaterThan(0);
      expect(snapshot.cars.count).toBeGreaterThanOrEqual(1);
      const boarding = RideFlag.EntrancePlaced | RideFlag.ExitPlaced;
      expect(rows.some((row) => (row[RideInfo.Flags]! & boarding) === boarding)).toBe(true);
    });

    it('has a park gate', () => {
      expect(map.entranceX).toBeGreaterThanOrEqual(0);
      expect(snapshot.park.entranceX).toBe(map.entranceX);
      expect(snapshot.park.entranceY).toBe(map.entranceY);
    });

    it('has guests spread across sub-tile positions, none riding, plus staff and litter', () => {
      const guests = snapshot.guests;
      expect(guests.count).toBeGreaterThanOrEqual(40);
      let offCentre = 0;
      for (let i = 0; i < guests.count; i++) {
        const o = i * SNAPSHOT_STRIDE;
        if ((guests.data[o]! & 255) !== 128 || (guests.data[o + 1]! & 255) !== 128) offCentre++;
        expect(isRidingGuestRow(guests.data[o + 3]!)).toBe(false);
      }
      expect(offCentre / guests.count).toBeGreaterThanOrEqual(0.25);
      expect(snapshot.staff.count).toBeGreaterThan(0);
      expect(snapshot.litter.count).toBeGreaterThan(0);
    });

    it('focuses inside the map', () => {
      expect(park.focus.x).toBeGreaterThan(0);
      expect(park.focus.x).toBeLessThan(map.width);
      expect(park.focus.y).toBeGreaterThan(0);
      expect(park.focus.y).toBeLessThan(map.height);
    });
  });

  it('is deterministic per seed and varies between seeds', () => {
    expect(fingerprint(buildFuzzPark(3))).toBe(fingerprint(buildFuzzPark(3)));
    const prints = new Set(SEEDS.map((seed) => fingerprint(buildFuzzPark(seed))));
    expect(prints.size).toBe(SEEDS.length);
  });
});

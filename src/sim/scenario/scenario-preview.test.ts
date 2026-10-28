import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { ElementType, OWNED, PathFlag, SALE_LAND, SALE_RIGHTS } from '../map/tile-map';
import { rideFootprintTiles } from '../rides/ride-footprint';
import { RIDE_CATALOG } from '../rides/ride-types';
import type { RideType } from '../rides/ride-types';
import { SCENARIOS } from './catalog';
import { prepareScenario } from './scenario-layout';
import { renderScenarioPreview } from './scenario-preview';

function colorAt(pixels: Uint8Array, width: number, x: number, y: number): readonly number[] {
  const offset = (y * width + x) * 4;
  return [...pixels.subarray(offset, offset + 4)];
}

describe('scenario map previews', () => {
  it('renders Starter Park map features as distinct pixels', () => {
    const starter = SCENARIOS.find((scenario) => scenario.id === 'starter');
    if (!starter) throw new Error('Starter Park scenario is required');
    const world = new World({
      seed: starter.seed,
      width: starter.mapWidth,
      height: starter.mapHeight,
    });
    prepareScenario(world, starter);
    const image = renderScenarioPreview(world);
    const map = world.map;
    const findTile = (predicate: (index: number, x: number, y: number) => boolean) => {
      for (let y = 0; y < map.height; y++)
        for (let x = 0; x < map.width; x++) {
          const index = map.index(x, y);
          if (predicate(index, x, y)) return [x, y] as const;
        }
      throw new Error('Expected starter map feature was not generated');
    };
    const elementOfType = (index: number, type: ElementType): boolean => {
      for (let element = map.tileHead[index]; element >= 0; element = map.elNext[element])
        if (map.elType[element] === type) return true;
      return false;
    };
    const dryAndEmpty = (index: number) =>
      map.waterLevel[index] <= map.heights[index] && map.tileHead[index] < 0;
    const water = findTile((index) => map.waterLevel[index] > map.heights[index]);
    const owned = findTile((index) => dryAndEmpty(index) && (map.ownership[index] & OWNED) !== 0);
    const landForSale = findTile(
      (index) => dryAndEmpty(index) && (map.ownership[index] & SALE_LAND) !== 0,
    );
    const rightsForSale = findTile(
      (index) => dryAndEmpty(index) && (map.ownership[index] & SALE_RIGHTS) !== 0,
    );
    const notOwned = findTile((index) => dryAndEmpty(index) && map.ownership[index] === 0);
    const path = findTile(
      (index, x, y) =>
        elementOfType(index, ElementType.Path) &&
        (map.elFlags[map.pathElement(index, -1)] & PathFlag.Queue) === 0 &&
        (x !== world.park.entranceX || y !== world.park.entranceY),
    );
    const scenery = findTile((index) => elementOfType(index, ElementType.SmallScenery));
    const entrance = [world.park.entranceX, world.park.entranceY] as const;
    const highestTile = Math.max(...map.heights);
    const hill = findTile((index) => {
      if (map.waterLevel[index] > map.heights[index]) return false;
      return map.heights[index] === highestTile;
    });
    const colors = [
      colorAt(image.pixels, image.width, ...water),
      colorAt(image.pixels, image.width, ...owned),
      colorAt(image.pixels, image.width, ...landForSale),
      colorAt(image.pixels, image.width, ...rightsForSale),
      colorAt(image.pixels, image.width, ...notOwned),
      colorAt(image.pixels, image.width, ...path),
      colorAt(image.pixels, image.width, ...scenery),
      colorAt(image.pixels, image.width, ...entrance),
      colorAt(image.pixels, image.width, ...hill),
    ].map((color) => color.join(','));

    expect(image.width).toBe(starter.mapWidth);
    expect(image.height).toBe(starter.mapHeight);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('marks an existing ride on a scenario that starts with rides', () => {
    const scenario = SCENARIOS.find((entry) => entry.id === 'meadowbrook');
    if (!scenario) throw new Error('Meadowbrook scenario is required');
    const world = new World({
      seed: scenario.seed,
      width: scenario.mapWidth,
      height: scenario.mapHeight,
    });
    prepareScenario(world, scenario);
    if (world.rides.count === 0) throw new Error('Meadowbrook should contain a starting ride');
    const ride = world.rides.cols;
    const rideDefinition = RIDE_CATALOG[ride.typeId[0] as RideType];
    if (!rideDefinition) throw new Error('Meadowbrook ride has no catalog definition');
    const image = renderScenarioPreview(world);
    const footprint = rideFootprintTiles(rideDefinition, ride.rideX[0], ride.rideY[0], ride.dir[0]);
    const rideTile = footprint.find(([x, y]) => world.map.tileHead[world.map.index(x, y)] < 0);
    if (!rideTile) throw new Error('Expected a ride footprint tile without a path element');
    const [rideX, rideY] = rideTile;
    const footprintKeys = new Set(footprint.map(([x, y]) => world.map.index(x, y)));
    let ground: readonly [number, number] | undefined;
    for (let y = 0; y < world.map.height && !ground; y++) {
      for (let x = 0; x < world.map.width; x++) {
        const tile = world.map.index(x, y);
        if (world.map.tileHead[tile] < 0 && !footprintKeys.has(tile)) {
          ground = [x, y];
          break;
        }
      }
    }
    if (!ground) throw new Error('Meadowbrook should have an empty terrain tile');

    expect(colorAt(image.pixels, image.width, rideX, rideY)).not.toEqual(
      colorAt(image.pixels, image.width, ...ground),
    );
  });
});

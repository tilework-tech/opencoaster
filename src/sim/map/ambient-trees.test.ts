import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { OWNED, ElementType, Surface } from './tile-map';
import { placePath } from './paths';
import { materializeAmbientTrees } from './ambient-trees';
import { removeScenery } from './scenery';
import { createRide } from '../rides/ride-operations';
import { RideType } from '../rides/ride-types';
import { PieceId } from '../track/catalog';
import { placeTrack } from '../track/construction';
import { PieceMode } from '../track/track-types';

function treeTiles(world: World): Array<{ x: number; y: number }> {
  const map = world.map;
  const trees: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.index(x, y);
      for (let element = map.firstElement(tile); element >= 0; element = map.nextElement(element))
        if (map.elType[element] === ElementType.SmallScenery) trees.push({ x, y });
    }
  }
  return trees;
}

function park(seed: number): World {
  const world = new World({ seed, width: 80, height: 80 });
  world.map.fillFlat(2);
  for (let y = 12; y < 68; y++)
    for (let x = 12; x < 68; x++) world.map.ownership[world.map.index(x, y)] = OWNED;
  world.park.entranceX = 40;
  world.park.entranceY = 65;
  return world;
}

describe('ambient tree generation', () => {
  it('forms clustered copses instead of regular rows', () => {
    const world = park(481);
    materializeAmbientTrees(world);
    const trees = treeTiles(world);
    const blockCounts = Array.from({ length: 100 }, (_, block) => {
      const blockX = (block % 10) * 8;
      const blockY = Math.floor(block / 10) * 8;
      return trees.filter(
        ({ x, y }) => x >= blockX && x < blockX + 8 && y >= blockY && y < blockY + 8,
      ).length;
    });
    const mean = blockCounts.reduce((sum, value) => sum + value, 0) / blockCounts.length;
    const variance =
      blockCounts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / blockCounts.length;
    const edgeBelt = trees.filter(({ x, y }) => Math.min(x, y, 79 - x, 79 - y) <= 3);
    const boundaryBelt = trees.filter(({ x, y }) => {
      const owned = (world.map.ownership[world.map.index(x, y)]! & OWNED) !== 0;
      return !owned && x >= 9 && x <= 70 && y >= 9 && y <= 70;
    });
    const repeat = park(481);
    materializeAmbientTrees(repeat);

    expect(trees.length).toBeGreaterThan(150);
    expect(blockCounts.filter((count) => count === 0).length).toBeGreaterThan(10);
    expect(variance).toBeGreaterThan(150);
    expect(edgeBelt.length).toBeGreaterThan(500);
    expect(boundaryBelt.length).toBeGreaterThan(250);
    expect(treeTiles(repeat)).toEqual(trees);
  });

  it('keeps the owned interior sparse and avoids dense trees on the owned boundary', () => {
    const world = park(912);
    materializeAmbientTrees(world);
    const ownedInterior: Array<{ x: number; y: number }> = [];
    for (let y = 12; y < 68; y++)
      for (let x = 12; x < 68; x++) {
        if (Math.hypot(x - 40, y - 65) > 10) ownedInterior.push({ x, y });
      }
    const trees = treeTiles(world);
    const interior = new Set(ownedInterior.map(({ x, y }) => `${x},${y}`));
    const interiorTrees = trees.filter(({ x, y }) => interior.has(`${x},${y}`));
    const entranceTrees = trees.filter(({ x, y }) => Math.hypot(x - 40, y - 65) <= 10);

    const ownedBoundaryTrees = trees.filter(
      ({ x, y }) =>
        x >= 12 && x < 68 && y >= 12 && y < 68 && Math.min(x - 12, 67 - x, y - 12, 67 - y) <= 3,
    );

    expect(interiorTrees.length / ownedInterior.length).toBeLessThan(0.05);
    expect(ownedBoundaryTrees).toEqual([]);
    expect(entranceTrees).toEqual([]);
  });

  it('does not plant ambient trees in water or on paths', () => {
    const world = new World({ seed: 17, width: 32, height: 32 });
    world.map.fillFlat(2);
    world.map.ownership.fill(OWNED);
    const water = world.map.index(14, 14);
    world.map.waterLevel[water] = 3;
    world.map.refreshTile(water);
    expect(world.map.surface[water]).toBe(Surface.Water);
    expect(placePath(world.map, { x: 15, y: 15 })).toBe(true);

    materializeAmbientTrees(world);

    const trees = treeTiles(world);
    expect(trees).not.toContainEqual({ x: 14, y: 14 });
    expect(trees).not.toContainEqual({ x: 15, y: 15 });
  });

  it('does not plant trees over an existing track footprint', () => {
    const world = park(305);
    materializeAmbientTrees(world);
    const tree = treeTiles(world).find(
      ({ x, y }) =>
        x > 1 &&
        y > 1 &&
        x < world.map.width - 2 &&
        y < world.map.height - 2 &&
        (world.map.ownership[world.map.index(x, y)]! & OWNED) === 0,
    );
    expect(tree).toBeDefined();
    if (!tree) return;
    world.map.ownership[world.map.index(tree.x, tree.y)] = OWNED;
    expect(removeScenery(world.map, tree.x, tree.y)).not.toBeNull();
    world.economy.cash = 100_000_000;
    const rideId = createRide(world, RideType.WoodenCoaster, 30, 30);
    const tile = world.map.index(tree.x, tree.y);
    expect(
      placeTrack(world, {
        rideId,
        pieceType: PieceId.Flat,
        x: tree.x,
        y: tree.y,
        z: world.map.heights[tile]! * 2,
        dir: 0,
        mode: PieceMode.Normal,
      }),
    ).toBe(0);

    materializeAmbientTrees(world);

    expect(treeTiles(world)).not.toContainEqual(tree);
  });
});

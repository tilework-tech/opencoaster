import type { World } from '../core/world';
import { DIR_DX, DIR_DY } from '../pathfinding/directions';
import { queueLinkMask } from '../map/paths';
import { PathFlag } from '../map/tile-map';
import { frontAwayFrom, rideBoardingTiles, setBoardingFront } from './ride-boarding';

/**
 * Gives a ride's placed entrance and exit the front edge that keeps the park connected. An
 * entrance fronts the edge its queue already leaves by; an exit fronts the edge facing away from
 * the ride when a path is there, otherwise the first edge with a path. Where nothing is connected
 * yet the edge faces away from the ride.
 */
export function inferBoardingFronts(world: World, slot: number): void {
  const ride = world.rides.cols;
  const map = world.map;
  const tiles = rideBoardingTiles(world, slot);
  if (ride.entrancePlaced[slot] && map.inBounds(ride.entranceX[slot], ride.entranceY[slot])) {
    const tile = map.index(ride.entranceX[slot], ride.entranceY[slot]);
    const e = map.pathElement(tile, -1);
    const links = e >= 0 && map.elFlags[e] & PathFlag.Queue ? queueLinkMask(map, e) : 0;
    let front = -1;
    for (let d = 0; d < 4 && front < 0; d++) if (links & (1 << d)) front = d;
    if (front < 0) front = frontAwayFrom(tiles, ride.entranceX[slot], ride.entranceY[slot]);
    setBoardingFront(world, ride.entranceX[slot], ride.entranceY[slot], front);
  }
  if (ride.exitPlaced[slot] && map.inBounds(ride.exitX[slot], ride.exitY[slot])) {
    const x = ride.exitX[slot];
    const y = ride.exitY[slot];
    const away = frontAwayFrom(tiles, x, y);
    const hasPath = (d: number): boolean => {
      const nx = x + DIR_DX[d];
      const ny = y + DIR_DY[d];
      return (
        map.inBounds(nx, ny) &&
        map.isWalkable(map.index(nx, ny)) &&
        !tiles.some(([bx, by]) => bx === nx && by === ny)
      );
    };
    let front = away >= 0 && hasPath(away) ? away : -1;
    for (let d = 0; d < 4 && front < 0; d++) if (hasPath(d)) front = d;
    setBoardingFront(world, x, y, front < 0 ? away : front);
  }
}

/** Gives rides saved before entrances and exits had a front edge one, see `inferBoardingFronts`. */
export function migrateBoardingFronts(world: World): void {
  for (let slot = 0; slot < world.rides.count; slot++) inferBoardingFronts(world, slot);
}

import type { World } from '../core/world';
import { Surface } from '../map/tile-map';
import { PIECES } from '../track/catalog';
import { rotateTile } from '../track/construction';
import { rideFootprintTiles } from './ride-footprint';
import { RidePhase, RideState } from './ride-store';
import { RIDE_CATALOG } from './ride-types';
import type { RideType } from './ride-types';

const BLOCKED_TILE_COST = 100;
const BOARDING_INSIDE_COST = 50;
const BOARDING_DETACHED_COST = 10;

/**
 * Gives flat rides saved before footprints existed a footprint that still covers their old tile.
 * Each ride takes the orientation and anchor shift with the fewest collisions (paths, water,
 * track, other rides, the map edge); ties go to the first orientation and footprint tile in
 * catalogue order, so the result is deterministic. A ride whose entrance or exit ends up inside
 * the footprint or no longer touches it loses that placement and is closed until the player
 * places it again.
 */
export function migrateSingleTileRides(world: World): void {
  const rides = world.rides.cols;
  const claimed = new Set<number>();
  const map = world.map;
  const claim = (x: number, y: number): void => {
    if (map.inBounds(x, y)) claimed.add(map.index(x, y));
  };
  for (let slot = 0; slot < world.rides.count; slot++) {
    const def = RIDE_CATALOG[rides.typeId[slot] as RideType];
    if (def && !def.usesTrack) claim(rides.rideX[slot], rides.rideY[slot]);
  }
  const trackTiles = new Set<number>();
  const pieces = world.track.pieces;
  for (let piece = 0; piece < pieces.count; piece++) {
    for (const cell of PIECES[pieces.cols.pieceType[piece]].footprint) {
      const [rx, ry] = rotateTile(cell.i, cell.j, pieces.cols.dir[piece]);
      const x = pieces.cols.x[piece] + rx;
      const y = pieces.cols.y[piece] + ry;
      if (map.inBounds(x, y)) trackTiles.add(map.index(x, y));
    }
  }

  for (let slot = 0; slot < world.rides.count; slot++) {
    const def = RIDE_CATALOG[rides.typeId[slot] as RideType];
    if (!def || def.usesTrack || def.footprint.length <= 1) continue;
    const oldX = rides.rideX[slot];
    const oldY = rides.rideY[slot];
    if (map.inBounds(oldX, oldY)) claimed.delete(map.index(oldX, oldY));

    let best = {
      cost: Infinity,
      x: oldX,
      y: oldY,
      dir: 0,
      tiles: [[oldX, oldY]] as Array<[number, number]>,
    };
    for (let dir = 0; dir < 4; dir++) {
      for (const [dx, dy] of def.footprint) {
        const [rx, ry] = rotateTile(dx, dy, dir);
        const x = oldX - rx;
        const y = oldY - ry;
        const tiles = rideFootprintTiles(def, x, y, dir);
        let cost = 0;
        for (const [tx, ty] of tiles) {
          if (!map.inBounds(tx, ty)) {
            cost += BLOCKED_TILE_COST;
            continue;
          }
          const tile = map.index(tx, ty);
          const surface = map.surface[tile];
          if (
            tile !== map.index(oldX, oldY) &&
            (surface === Surface.Path ||
              surface === Surface.Queue ||
              surface === Surface.Water ||
              claimed.has(tile) ||
              trackTiles.has(tile))
          )
            cost += BLOCKED_TILE_COST;
        }
        for (const [placed, bx, by] of [
          [rides.entrancePlaced[slot], rides.entranceX[slot], rides.entranceY[slot]],
          [rides.exitPlaced[slot], rides.exitX[slot], rides.exitY[slot]],
        ]) {
          if (!placed) continue;
          if (tiles.some(([tx, ty]) => tx === bx && ty === by)) cost += BOARDING_INSIDE_COST;
          else if (!tiles.some(([tx, ty]) => Math.abs(tx - bx) + Math.abs(ty - by) === 1))
            cost += BOARDING_DETACHED_COST;
        }
        if (cost < best.cost) best = { cost, x, y, dir, tiles };
      }
    }

    rides.rideX[slot] = best.x;
    rides.rideY[slot] = best.y;
    rides.dir[slot] = best.dir;
    for (const [tx, ty] of best.tiles) claim(tx, ty);
    for (const part of ['entrance', 'exit'] as const) {
      const placed = part === 'entrance' ? rides.entrancePlaced : rides.exitPlaced;
      const px = part === 'entrance' ? rides.entranceX[slot] : rides.exitX[slot];
      const py = part === 'entrance' ? rides.entranceY[slot] : rides.exitY[slot];
      if (!placed[slot]) continue;
      const inside = best.tiles.some(([tx, ty]) => tx === px && ty === py);
      const touching = best.tiles.some(([tx, ty]) => Math.abs(tx - px) + Math.abs(ty - py) === 1);
      if (inside || !touching) {
        placed[slot] = 0;
        rides.queueConnected[slot] = 0;
        rides.queueLineTiles[slot] = 0;
        if (rides.state[slot] === RideState.Open) {
          rides.state[slot] = RideState.Closed;
          if (rides.phase[slot] === RidePhase.Waiting) rides.phase[slot] = RidePhase.Closed;
        }
      }
    }
  }
}

import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { decodeCarPose } from '../worker/car-poses';
import { RideInfo, RIDE_INFO_STRIDE, SNAPSHOT_STRIDE } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import {
  carSpriteKey,
  coasterFamily,
  supportStack,
  trackCellSprites,
} from './coaster-art';
import type { CoasterFamily } from './coaster-art';
import type { MapData } from './renderer';
import type { Rotation } from './projection';

/** One sprite to draw: the atlas key with its anchor at world (x, y, z), sorted by `depth`. */
export interface CoasterDrawItem {
  key: string;
  x: number;
  y: number;
  z: number;
  depth: number;
}

/** Painter depth of a world point, in the renderer's convention: far tiles first. */
function tileDepth(x: number, y: number, map: MapData, rotation: Rotation): number {
  const tx = Math.floor(x / TILE_UNITS) + 0.5;
  const ty = Math.floor(y / TILE_UNITS) + 0.5;
  switch (rotation) {
    case 0:
      return 2 * (tx + ty);
    case 1:
      return 2 * (map.height - ty + tx);
    case 2:
      return 2 * (map.width - tx + map.height - ty);
    default:
      return 2 * (ty + map.width - tx);
  }
}

const TRACK_OFFSET = 1;
const SUPPORT_OFFSET = 0.5;
const CAR_OFFSET = 1.5;

/** Builds the draw list of every coaster's track, supports and cars for one snapshot. */
export class CoasterScene {
  readonly items: CoasterDrawItem[] = [];
  private count = 0;
  private readonly families = new Map<number, CoasterFamily>();

  get length(): number {
    return this.count;
  }

  private push(key: string, x: number, y: number, z: number, depth: number): void {
    let item = this.items[this.count];
    if (!item) {
      item = { key, x, y, z, depth };
      this.items.push(item);
    } else {
      item.key = key;
      item.x = x;
      item.y = y;
      item.z = z;
      item.depth = depth;
    }
    this.count++;
  }

  /** Whether this scene draws the trains of the ride, so procedural train markers are skipped. */
  drawsRide(rideId: number): boolean {
    return this.families.has(rideId);
  }

  build(snapshot: Snapshot, map: MapData, rotation: Rotation): void {
    this.count = 0;
    this.families.clear();
    for (let i = 0; i < snapshot.rides.count; i++) {
      const o = i * RIDE_INFO_STRIDE;
      const family = coasterFamily(snapshot.rideInfo[o + RideInfo.Type]);
      if (family) this.families.set(snapshot.rideInfo[o + RideInfo.Id], family);
    }
    if (this.families.size === 0) return;
    this.addTrack(snapshot, map, rotation);
    this.addCars(snapshot, map, rotation);
  }

  private addTrack(snapshot: Snapshot, map: MapData, rotation: Rotation): void {
    const tracks = snapshot.tracks;
    for (let i = 0, o = 0; i < tracks.count; i++, o += SNAPSHOT_STRIDE) {
      const word = tracks.data[o + 3];
      const family = this.families.get(word >>> 16);
      if (!family) continue;
      const pieceType = word & 0xff;
      const dir = (word >> 8) & 3;
      const mode = (word >> 10) & 7;
      const originX = Math.floor(tracks.data[o] / TILE_UNITS);
      const originY = Math.floor(tracks.data[o + 1] / TILE_UNITS);
      const z = tracks.data[o + 2];
      const cells = trackCellSprites(pieceType, dir, rotation, family, mode, snapshot.tick);
      for (let c = 0; c < cells.length; c++) {
        const tileX = originX + cells[c].dx;
        const tileY = originY + cells[c].dy;
        if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) continue;
        const x = tileX * TILE_UNITS + TILE_UNITS / 2;
        const y = tileY * TILE_UNITS + TILE_UNITS / 2;
        const depth = tileDepth(x, y, map, rotation);
        this.push(cells[c].key, x, y, z, depth + TRACK_OFFSET);
        this.addSupports(pieceType, c, family, dir, rotation, map, tileX, tileY, z, depth);
      }
    }
  }

  private addSupports(
    pieceType: number,
    cell: number,
    family: CoasterFamily,
    dir: number,
    rotation: Rotation,
    map: MapData,
    tileX: number,
    tileY: number,
    z: number,
    depth: number,
  ): void {
    const ground = map.heights[tileY * map.width + tileX];
    const stack = supportStack(pieceType, cell, ground, z / Z_STEP);
    const view = (dir + rotation) & 3;
    const x = tileX * TILE_UNITS + TILE_UNITS / 2;
    const y = tileY * TILE_UNITS + TILE_UNITS / 2;
    const prefix = `track/${family}/support`;
    for (let level = 0; level < stack.full; level++)
      this.push(
        `${prefix}-column/view-${view}`,
        x,
        y,
        (ground + level) * Z_STEP,
        depth + SUPPORT_OFFSET,
      );
    if (stack.quarters > 0)
      this.push(
        `${prefix}-cap${stack.quarters}/view-${view}`,
        x,
        y,
        (ground + stack.full) * Z_STEP,
        depth + SUPPORT_OFFSET,
      );
    if (stack.full + stack.quarters > 0)
      this.push(`${prefix}-base/view-${view}`, x, y, ground * Z_STEP, depth + SUPPORT_OFFSET);
  }

  private addCars(snapshot: Snapshot, map: MapData, rotation: Rotation): void {
    const cars = snapshot.cars;
    for (let i = 0, o = 0; i < cars.count; i++, o += SNAPSHOT_STRIDE) {
      const pose = decodeCarPose(cars.data[o + 3]);
      const family = this.families.get(pose.rideId);
      if (!family) continue;
      const x = cars.data[o];
      const y = cars.data[o + 1];
      this.push(
        carSpriteKey(family, pose.heading, pose.pitch, pose.bank, rotation),
        x,
        y,
        cars.data[o + 2],
        tileDepth(x, y, map, rotation) + CAR_OFFSET,
      );
    }
  }
}

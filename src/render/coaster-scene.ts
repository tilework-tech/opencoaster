import { TILE_UNITS, TRACK_Z_STEP, Z_STEP } from '../sim/core/constants';
import { decodeCarPose } from '../worker/car-poses';
import type { CarPose } from '../worker/car-poses';
import { RideInfo, RIDE_INFO_STRIDE, SNAPSHOT_STRIDE } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import {
  carSpriteKey,
  trackedRideFamily,
  supportOffset,
  supportStack,
  trackArt,
  trackCellSprites,
  transportCarSpriteKey,
  transportFamily,
  transportTrackCells,
} from './coaster-art';
import type { CoasterFamily, TrackRideFamily, TransportFamily } from './coaster-art';
import { pieceTunnelPortals, undergroundTiles } from '../sim/track/clearance';
import type { MapData } from './renderer';
import type { Rotation } from './projection';
import { rotateDirection, viewDepth } from './projection';

/** One sprite to draw: the atlas key with its anchor at world (x, y, z), sorted by `depth`. */
export interface CoasterDrawItem {
  key: string;
  rideId: number;
  x: number;
  y: number;
  z: number;
  depth: number;
  /** Drawn translucent over the terrain, to show track hidden below ground. */
  xray: boolean;
}

/** Painter depth of a world point, in the renderer's convention: far tiles first. */
function tileDepth(x: number, y: number, map: MapData, rotation: Rotation): number {
  return 2 * viewDepth(x / TILE_UNITS, y / TILE_UNITS, rotation, map);
}

const TRACK_OFFSET = 1;
const SUPPORT_OFFSET = 0.5;
const PORTAL_OFFSET = 0.25;
const CAR_OFFSET = 1.5;
const RIDER_OFFSET = 0.1;
/** Riders shown per car; cars carry at most this many seated figures. */
export const MAX_SEATED_RIDERS = 4;
/** Distance between seated riders along the car, in world units. */
const SEAT_SPACING = TILE_UNITS * 0.1;
/** Seat cushion height above the car's anchor, in world z units. */
const SEAT_HEIGHT = Z_STEP * 0.12;

/** Builds the draw list of every coaster's track, supports and cars for one snapshot. */
export class CoasterScene {
  readonly items: CoasterDrawItem[] = [];
  private count = 0;
  private readonly families = new Map<number, TrackRideFamily>();
  private readonly transports = new Map<number, TransportFamily>();

  get length(): number {
    return this.count;
  }

  private push(
    key: string,
    rideId: number,
    x: number,
    y: number,
    z: number,
    depth: number,
    xray = false,
  ): void {
    let item = this.items[this.count];
    if (!item) {
      item = { key, rideId, x, y, z, depth, xray };
      this.items.push(item);
    } else {
      item.key = key;
      item.rideId = rideId;
      item.x = x;
      item.y = y;
      item.z = z;
      item.depth = depth;
      item.xray = xray;
    }
    this.count++;
  }

  /** Whether this scene draws the trains of the ride, so procedural train markers are skipped. */
  drawsRide(rideId: number): boolean {
    return this.families.has(rideId) || this.transports.has(rideId);
  }

  build(snapshot: Snapshot, map: MapData, rotation: Rotation, undergroundView = false): void {
    this.count = 0;
    this.families.clear();
    this.transports.clear();
    for (let i = 0; i < snapshot.rides.count; i++) {
      const o = i * RIDE_INFO_STRIDE;
      const type = snapshot.rideInfo[o + RideInfo.Type];
      const id = snapshot.rideInfo[o + RideInfo.Id];
      const family = trackedRideFamily(type);
      const transport = transportFamily(type);
      if (family) this.families.set(id, family);
      else if (transport) this.transports.set(id, transport);
    }
    if (this.families.size === 0 && this.transports.size === 0) return;
    this.addTrack(snapshot, map, rotation, undergroundView);
    this.addCars(snapshot, map, rotation);
  }

  private addTrack(
    snapshot: Snapshot,
    map: MapData,
    rotation: Rotation,
    undergroundView: boolean,
  ): void {
    const tracks = snapshot.tracks;
    for (let i = 0, o = 0; i < tracks.count; i++, o += SNAPSHOT_STRIDE) {
      const word = tracks.data[o + 3];
      const rideId = word >>> 16;
      const family = this.families.get(rideId);
      const transport = this.transports.get(rideId);
      if (!family && !transport) continue;
      const pieceType = word & 0xff;
      const dir = (word >> 8) & 3;
      const mode = (word >> 10) & 7;
      const originX = Math.floor(tracks.data[o] / TILE_UNITS);
      const originY = Math.floor(tracks.data[o + 1] / TILE_UNITS);
      const z = tracks.data[o + 2];
      const cells = family
        ? trackCellSprites(pieceType, dir, rotation, family, mode, snapshot.tick)
        : transportTrackCells(pieceType, dir, rotation, transport!);
      const hidden = undergroundView
        ? undergroundTiles(map, pieceType, originX, originY, z / TRACK_Z_STEP, dir)
        : null;
      if (family)
        this.addPortals(pieceType, family, rideId, originX, originY, z, dir, map, rotation);
      for (let c = 0; c < cells.length; c++) {
        const tileX = originX + cells[c].dx;
        const tileY = originY + cells[c].dy;
        if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) continue;
        const x = tileX * TILE_UNITS + TILE_UNITS / 2;
        const y = tileY * TILE_UNITS + TILE_UNITS / 2;
        const depth = tileDepth(x, y, map, rotation);
        this.push(cells[c].key, rideId, x, y, z, depth + TRACK_OFFSET);
        if (hidden && hidden.includes(tileY * map.width + tileX))
          this.push(cells[c].key, rideId, x, y, z, depth + TRACK_OFFSET, true);
        if (family && family !== 'log-flume' && family !== 'river-rapids')
          this.addSupports(
            pieceType,
            c,
            family,
            rideId,
            dir,
            rotation,
            map,
            tileX,
            tileY,
            z,
            depth,
          );
      }
    }
  }

  /** Stone portals where the piece's centre line enters or leaves the hillside. */
  private addPortals(
    pieceType: number,
    family: TrackRideFamily,
    rideId: number,
    originX: number,
    originY: number,
    z: number,
    dir: number,
    map: MapData,
    rotation: Rotation,
  ): void {
    const art = family === 'log-flume' || family === 'river-rapids' ? 'wood' : trackArt(family);
    for (const portal of pieceTunnelPortals(
      map,
      pieceType,
      originX,
      originY,
      z / TRACK_Z_STEP,
      dir,
    )) {
      const view = rotateDirection(portal.facing, rotation);
      this.push(
        `rides/coaster/${art}/tunnel/view-${view}`,
        rideId,
        portal.x,
        portal.y,
        portal.z,
        tileDepth(portal.x, portal.y, map, rotation) + TRACK_OFFSET + PORTAL_OFFSET,
      );
    }
  }

  private addSupports(
    pieceType: number,
    cell: number,
    family: CoasterFamily,
    rideId: number,
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
    const view = rotateDirection(dir, rotation);
    const [offsetX, offsetY] = supportOffset(pieceType, cell, dir);
    const x = tileX * TILE_UNITS + TILE_UNITS / 2 + offsetX;
    const y = tileY * TILE_UNITS + TILE_UNITS / 2 + offsetY;
    const prefix = `rides/coaster/${family}/support`;
    for (let level = 0; level < stack.full; level++)
      this.push(
        `${prefix}-column/view-${view}`,
        rideId,
        x,
        y,
        (ground + level) * Z_STEP,
        depth + SUPPORT_OFFSET,
      );
    if (stack.quarters > 0)
      this.push(
        `${prefix}-cap${stack.quarters}/view-${view}`,
        rideId,
        x,
        y,
        (ground + stack.full) * Z_STEP,
        depth + SUPPORT_OFFSET,
      );
    if (stack.full + stack.quarters > 0)
      this.push(
        `${prefix}-base/view-${view}`,
        rideId,
        x,
        y,
        ground * Z_STEP,
        depth + SUPPORT_OFFSET,
      );
  }

  private addCars(snapshot: Snapshot, map: MapData, rotation: Rotation): void {
    const cars = snapshot.cars;
    for (let i = 0, o = 0; i < cars.count; i++, o += SNAPSHOT_STRIDE) {
      const pose = decodeCarPose(cars.data[o + 3]);
      const family = this.families.get(pose.rideId);
      const transport = this.transports.get(pose.rideId);
      if (!family && !transport) continue;
      const x = cars.data[o];
      const y = cars.data[o + 1];
      this.push(
        family
          ? carSpriteKey(family, pose.heading, pose.pitch, pose.bank, rotation, pose.passengers)
          : transportCarSpriteKey(transport!, pose.heading, pose.pitch, rotation),
        pose.rideId,
        x,
        y,
        cars.data[o + 2],
        tileDepth(x, y, map, rotation) + CAR_OFFSET,
      );
      if (transport !== 'chairlift')
        this.addRiders(pose, x, y, cars.data[o + 2], i, map, rotation, family);
    }
  }

  /** Seats the car's passengers as small figures along its heading; boats and chairs bake theirs in. */
  private addRiders(
    pose: CarPose,
    x: number,
    y: number,
    z: number,
    car: number,
    map: MapData,
    rotation: Rotation,
    family: TrackRideFamily | undefined,
  ): void {
    if (family === 'log-flume' || family === 'river-rapids') return;
    const riders = Math.min(pose.passengers ?? 0, MAX_SEATED_RIDERS);
    const angle = (pose.heading * Math.PI) / 4;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const facing = rotateDirection((pose.heading + 1) >> 1, rotation);
    for (let k = 0; k < riders; k++) {
      const along = (k - (riders - 1) / 2) * SEAT_SPACING;
      const riderX = x + dx * along;
      const riderY = y + dy * along;
      this.push(
        `people/rider-seated#${((car + k) & 7) * 4 + facing}`,
        pose.rideId,
        riderX,
        riderY,
        z + SEAT_HEIGHT,
        tileDepth(x, y, map, rotation) + CAR_OFFSET + RIDER_OFFSET,
      );
    }
  }
}

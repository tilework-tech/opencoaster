import { rideFootprintContains } from '../sim/rides/ride-footprint';
import { RIDE_CATALOG, type RideType } from '../sim/rides/ride-types';
import { PathFlag, PATH_ADDITION_BROKEN } from '../sim/map/tile-map';
import { type SceneryItem, SCENERY_CATALOG, isWallScenery } from '../sim/map/scenery';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import {
  RideFlag,
  RideInfo,
  RIDE_INFO_STRIDE,
  SNAPSHOT_STRIDE,
  guestRowHeading,
  guestRowState,
  isRidingGuestRow,
  type Snapshot,
} from '../worker/snapshot';
import { peopleSpriteKey } from '../render/people-art';
import { CoasterScene } from '../render/coaster-scene';
import { RideCellScene, isSlicedRide } from '../render/ride-scene';
import {
  sceneryBox,
  sceneryGroundZ,
  pathAdditionBox,
  pathAdditionPlacements,
} from '../render/ground-anchor';
import {
  facilityFacingFromPaths,
  facilitySpriteKey,
  flowerBedSpriteName,
  pathAdditionSpriteName,
  rideHutFacing,
  rideHutSpriteKey,
  rideSpriteFrame,
  rideSpriteKey,
  scenerySpriteName,
  wallSpriteName,
} from '../render/world-art';
import { project, rotateDirection, rotateTile } from '../render/projection';
import type { Camera, MapData } from '../render/renderer';
import type { SpritePages } from '../render/sprite-pages';

export interface SpritePickTarget {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alphaWidth: number;
  alphaHeight: number;
  /** Row-major alpha values for the unscaled source sprite. */
  alpha: Uint8Array;
  /** Atlas sprite key the target was drawn from. */
  sprite?: string;
  /** Screen-space offset of the sprite's world anchor (its ground point) from x, y. */
  anchorX?: number;
  anchorY?: number;
  /** Atlas rectangle of the unscaled source sprite, for redrawing the object elsewhere. */
  source?: { image: CanvasImageSource; x: number; y: number; width: number; height: number };
}

export interface ObjectPickTarget extends SpritePickTarget {
  kind: 'ride' | 'guest' | 'staff' | 'park' | 'scenery' | 'path-addition';
  name: string;
  tileX: number;
  tileY: number;
  rideId?: number;
  personId?: number;
  sceneryIndex?: number;
  pathIndex?: number;
  state?: string;
  sortDepth: number;
}

const alphaCache = new WeakMap<
  SpritePages,
  Map<string, { width: number; height: number; alpha: Uint8Array }>
>();

function guestSpriteIndex(tint: number, heading: number, frame: number, rotation: number): number {
  const direction =
    Number.isInteger(heading) && heading >= 0 && heading < 4
      ? rotateDirection(heading, rotation as 0 | 1 | 2 | 3)
      : 0;
  return 40 + (((tint % 8) + 8) % 8) * 16 + direction * 4 + (frame % 4);
}

/** Builds the shared alpha-mask pick list from the same world positions used by both renderers. */
export function buildObjectPickTargets(
  snapshot: Snapshot | null,
  map: MapData,
  camera: Camera,
  viewport: { width: number; height: number },
  atlas: SpritePages,
): ObjectPickTarget[] {
  const cache = alphaCache.get(atlas) ?? new Map();
  alphaCache.set(atlas, cache);
  const targets: ObjectPickTarget[] = [];
  const projected = new Float64Array(2);
  const add = (
    key: string,
    worldX: number,
    worldY: number,
    worldZ: number,
    kind: ObjectPickTarget['kind'],
    name: string,
    tileX: number,
    tileY: number,
    sortDepth: number,
    meta: Partial<
      Pick<ObjectPickTarget, 'id' | 'rideId' | 'personId' | 'sceneryIndex' | 'pathIndex' | 'state'>
    > = {},
    boxed?: { width: number; height: number },
  ) => {
    const spriteName = key.split('#')[0]!;
    const entry = atlas.resolve(spriteName);
    if (!entry) return;
    const frameIndex = key.includes('#') ? Number(key.slice(key.lastIndexOf('#') + 1)) : 0;
    const frame = entry.frames[frameIndex] ?? entry.frames[0];
    const image = frame && atlas.pageImage(frame.page);
    if (!frame || !image) return;
    const cacheKey = `${atlas.version}:${spriteName}:${frameIndex}`;
    let mask = cache.get(cacheKey);
    if (!mask) {
      const canvas = document.createElement('canvas');
      canvas.width = frame.width;
      canvas.height = frame.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(
        image,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        0,
        0,
        frame.width,
        frame.height,
      );
      const rgba = context.getImageData(0, 0, frame.width, frame.height).data;
      const alpha = new Uint8Array(frame.width * frame.height);
      for (let pixel = 0; pixel < alpha.length; pixel++) alpha[pixel] = rgba[pixel * 4 + 3]!;
      mask = { width: frame.width, height: frame.height, alpha };
      cache.set(cacheKey, mask);
    }
    project(worldX, worldY, worldZ, map.width, map.height, camera.rotation, projected);
    const anchorX = viewport.width / 2 + (projected[0]! - camera.x) * camera.zoom;
    const anchorY = viewport.height / 2 + (projected[1]! - camera.y) * camera.zoom;
    const width = (boxed?.width ?? frame.width) * camera.zoom;
    const height = (boxed?.height ?? frame.height) * camera.zoom;
    const targetX = boxed
      ? anchorX - width / 2 + width * (0.5 - entry.anchor.x / frame.width)
      : anchorX - entry.anchor.x * camera.zoom;
    const targetY = boxed
      ? anchorY - (entry.anchor.y / frame.height) * height
      : anchorY - entry.anchor.y * camera.zoom;
    targets.push({
      id: `${kind}:${meta.rideId ?? meta.personId ?? meta.sceneryIndex ?? meta.pathIndex ?? tileY * map.width + tileX}`,
      x: targetX,
      y: targetY,
      width,
      height,
      alphaWidth: mask.width,
      alphaHeight: mask.height,
      alpha: mask.alpha,
      sprite: key,
      anchorX: anchorX - targetX,
      anchorY: anchorY - targetY,
      source: { image, x: frame.x, y: frame.y, width: frame.width, height: frame.height },
      kind,
      name,
      tileX,
      tileY,
      sortDepth,
      ...meta,
    });
  };
  const depth = (tileX: number, tileY: number, z: number, offset = 0) => {
    const [rx, ry] = rotateTile(tileX, tileY, map.width, map.height, camera.rotation);
    return 2 * (rx + ry) - z + offset;
  };
  const groundZ = (x: number, y: number) => (map.heights[y * map.width + x] ?? 0) * Z_STEP;

  if (snapshot) {
    const rideTypes = new Map<number, RideType>();
    for (let i = 0; i < snapshot.rides.count; i++) {
      const offset = i * RIDE_INFO_STRIDE;
      const id = snapshot.rideInfo[offset + RideInfo.Id]!;
      const type = snapshot.rideInfo[offset + RideInfo.Type]! as RideType;
      const definition = RIDE_CATALOG[type];
      rideTypes.set(id, type);
      const x = snapshot.rideInfo[offset + RideInfo.RideX]!;
      const y = snapshot.rideInfo[offset + RideInfo.RideY]!;
      if (!definition || x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      if (!definition.usesTrack && !isSlicedRide(type)) {
        const key = ['shop', 'stall', 'facility'].includes(definition.category)
          ? facilitySpriteKey(type, facilityFacingFromPaths(x, y, map), camera.rotation)
          : rideSpriteKey(type, camera.rotation);
        add(
          `${key}#${rideSpriteFrame(snapshot.rideInfo[offset + RideInfo.Phase]!, snapshot.tick, atlas.resolve(key)?.frames.length ?? 1)}`,
          x * TILE_UNITS + 128,
          y * TILE_UNITS + 128,
          groundZ(x, y),
          'ride',
          definition.name,
          x,
          y,
          depth(x, y, map.heights[y * map.width + x]!, 1),
          { rideId: id },
        );
      }
      const flags = snapshot.rideInfo[offset + RideInfo.Flags]!;
      for (const part of ['entrance', 'exit'] as const) {
        const placed = part === 'entrance' ? RideFlag.EntrancePlaced : RideFlag.ExitPlaced;
        if (!(flags & placed)) continue;
        const xField = part === 'entrance' ? RideInfo.EntranceX : RideInfo.ExitX;
        const yField = part === 'entrance' ? RideInfo.EntranceY : RideInfo.ExitY;
        const px = snapshot.rideInfo[offset + xField]!;
        const py = snapshot.rideInfo[offset + yField]!;
        if (px < 0 || py < 0 || px >= map.width || py >= map.height) continue;
        const key = rideHutSpriteKey(type, part, rideHutFacing(x, y, px, py), camera.rotation);
        add(
          key,
          px * TILE_UNITS + 128,
          py * TILE_UNITS + 128,
          groundZ(px, py),
          'ride',
          definition.name,
          px,
          py,
          depth(px, py, map.heights[py * map.width + px]!, 2),
          { rideId: id },
        );
      }
    }
    const rideCellScene = new RideCellScene();
    rideCellScene.build(snapshot, map, camera.rotation);
    for (let i = 0; i < rideCellScene.length; i++) {
      const item = rideCellScene.items[i]!;
      const definition = RIDE_CATALOG[rideTypes.get(item.rideId)!];
      if (!definition) continue;
      const key = `${item.key}#${rideSpriteFrame(item.phase, snapshot.tick, atlas.resolve(item.key)?.frames.length ?? 1)}`;
      const x = Math.floor(item.x / TILE_UNITS);
      const y = Math.floor(item.y / TILE_UNITS);
      add(key, item.x, item.y, item.z, 'ride', definition.name, x, y, item.depth, {
        id: `ride:${item.rideId}:${item.key}`,
        rideId: item.rideId,
      });
    }

    const coasterScene = new CoasterScene();
    coasterScene.build(snapshot, map, camera.rotation);
    const rideDefinitions = new Map<number, string>();
    for (let i = 0; i < snapshot.rides.count; i++) {
      const offset = i * RIDE_INFO_STRIDE;
      const definition = RIDE_CATALOG[snapshot.rideInfo[offset + RideInfo.Type]! as RideType];
      if (definition)
        rideDefinitions.set(snapshot.rideInfo[offset + RideInfo.Id]!, definition.name);
    }
    for (let i = 0; i < coasterScene.length; i++) {
      const item = coasterScene.items[i]!;
      const name = rideDefinitions.get(item.rideId);
      const x = Math.floor(item.x / TILE_UNITS);
      const y = Math.floor(item.y / TILE_UNITS);
      if (!name || x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      add(item.key, item.x, item.y, item.z, 'ride', name, x, y, item.depth, {
        rideId: item.rideId,
      });
    }
    const gateX = snapshot.park.entranceX;
    const gateY = snapshot.park.entranceY;
    if (gateX >= 0 && gateY >= 0 && gateX < map.width && gateY < map.height)
      add(
        `scenery/park-entrance/view-${camera.rotation}`,
        gateX * TILE_UNITS + 128,
        gateY * TILE_UNITS + 128,
        groundZ(gateX, gateY),
        'park',
        'Park entrance',
        gateX,
        gateY,
        depth(gateX, gateY, map.heights[gateY * map.width + gateX]!, 2),
      );

    for (let i = 0; i < snapshot.guests.count; i++) {
      const o = i * SNAPSHOT_STRIDE;
      const metadata = snapshot.guests.data[o + 3]!;
      if (isRidingGuestRow(metadata)) continue;
      const x = snapshot.guests.data[o]!;
      const y = snapshot.guests.data[o + 1]!;
      const z = snapshot.guests.data[o + 2]!;
      const tileX = Math.floor(x / TILE_UNITS);
      const tileY = Math.floor(y / TILE_UNITS);
      const id = snapshot.guestIds[i]!;
      add(
        `people/guest-walk#${guestSpriteIndex(metadata & 0xff, guestRowHeading(metadata), snapshot.tick >>> 2, camera.rotation) - 40}`,
        x,
        y,
        z,
        'guest',
        `Guest ${id}`,
        tileX,
        tileY,
        depth(tileX, tileY, z / Z_STEP),
        { personId: id, state: String(guestRowState(metadata)) },
      );
    }
    for (let i = 0; i < snapshot.staff.count; i++) {
      const o = i * SNAPSHOT_STRIDE;
      const metadata = snapshot.staff.data[o + 3]!;
      const x = snapshot.staff.data[o]!;
      const y = snapshot.staff.data[o + 1]!;
      const z = snapshot.staff.data[o + 2]!;
      const tileX = Math.floor(x / TILE_UNITS);
      const tileY = Math.floor(y / TILE_UNITS);
      const id = snapshot.staffIds[i]!;
      const kind = metadata & 0xff;
      const direction = (metadata >>> 8) & 3;
      const key = `${peopleSpriteKey(kind, direction, camera.rotation)}#0`;
      add(
        key,
        x,
        y,
        z,
        'staff',
        snapshot.staffNames.get(id) ?? `Staff ${id + 1}`,
        tileX,
        tileY,
        depth(tileX, tileY, z / Z_STEP),
        { personId: id },
      );
      if (!atlas.resolve(key.split('#')[0]!))
        add(
          `people/staff-costumes#${kind * 4}`,
          x,
          y,
          z,
          'staff',
          snapshot.staffNames.get(id) ?? `Staff ${id + 1}`,
          tileX,
          tileY,
          depth(tileX, tileY, z / Z_STEP),
          { personId: id },
          { width: 11, height: 13 },
        );
    }
  }

  const scenery = map.sceneryElements ?? [];
  for (let i = 0; i < Math.min(map.sceneryCount ?? 0, scenery.length / 5); i++) {
    const o = i * 5;
    const x = scenery[o]!;
    const y = scenery[o + 1]!;
    const item = scenery[o + 4]! as SceneryItem;
    const definition = SCENERY_CATALOG[item];
    if (!definition) continue;
    const tile = y * map.width + x;
    const flags = scenery[o + 3]!;
    const wall = isWallScenery(item);
    const z = wall
      ? map.heights[tile]! * Z_STEP
      : sceneryGroundZ(map.heights[tile]!, map.slope[tile]!, camera.rotation);
    const box = sceneryBox(definition);
    const key = wall
      ? wallSpriteName(definition.sprite, flags, map.slope[tile]!, camera.rotation)
      : definition.sprite === 'flower-bed'
        ? flowerBedSpriteName(x, y, camera.rotation, map.slope[tile]!)
        : scenerySpriteName(definition.sprite);
    add(
      key,
      x * TILE_UNITS + 128,
      y * TILE_UNITS + 128,
      z,
      'scenery',
      definition.name,
      x,
      y,
      depth(x, y, z / Z_STEP),
      { sceneryIndex: i, state: 'Placed' },
      box,
    );
  }
  const paths = map.pathElements ?? [];
  for (let i = 0; i < Math.min(map.pathCount ?? 0, paths.length / 6); i++) {
    const o = i * 6;
    const x = paths[o]!;
    const y = paths[o + 1]!;
    const flags = paths[o + 3]!;
    const data = paths[o + 4]!;
    const addition = flags & (PathFlag.Bin | PathFlag.Bench | PathFlag.Shelter | PathFlag.Lamp);
    if (!addition) continue;
    const name =
      flags & PathFlag.Bin
        ? 'Bin'
        : flags & PathFlag.Bench
          ? 'Bench'
          : flags & PathFlag.Shelter
            ? 'Shelter'
            : 'Lamp';
    const broken = (data & PATH_ADDITION_BROKEN) !== 0;
    const placements = pathAdditionPlacements(flags, paths[o + 2]!);
    for (const placement of placements) {
      const view = (placement.edge + camera.rotation) & 3;
      const key = pathAdditionSpriteName(flags, view, data);
      const box = pathAdditionBox(flags, view);
      add(
        key,
        x * TILE_UNITS + 128 + placement.x,
        y * TILE_UNITS + 128 + placement.y,
        placement.groundZ,
        'path-addition',
        `${name}${broken ? ' (vandalised)' : ''}`,
        x,
        y,
        depth(x, y, placement.groundZ / Z_STEP, 3),
        { pathIndex: i, state: broken ? 'vandalised' : 'intact' },
        flags & PathFlag.Shelter ? box : undefined,
      );
    }
  }
  targets.sort((a, b) => a.sortDepth - b.sortDepth);
  return targets;
}

/** Returns the topmost target with a visible source pixel at this screen position. */
export function pickTopmostSprite(
  targets: readonly SpritePickTarget[],
  screenX: number,
  screenY: number,
): string | null {
  for (let index = targets.length - 1; index >= 0; index--) {
    const target = targets[index]!;
    const localX = screenX - target.x;
    const localY = screenY - target.y;
    if (localX < 0 || localY < 0 || localX >= target.width || localY >= target.height) continue;
    const sourceX = Math.floor((localX / target.width) * target.alphaWidth);
    const sourceY = Math.floor((localY / target.height) * target.alphaHeight);
    if (target.alpha[sourceY * target.alphaWidth + sourceX]! > 0) return target.id;
  }
  return null;
}

export function pickTopmostObject(
  targets: readonly ObjectPickTarget[],
  screenX: number,
  screenY: number,
): ObjectPickTarget | null {
  for (let index = targets.length - 1; index >= 0; index--) {
    const target = targets[index]!;
    const localX = screenX - target.x;
    const localY = screenY - target.y;
    if (localX < 0 || localY < 0 || localX >= target.width || localY >= target.height) continue;
    const sourceX = Math.floor((localX / target.width) * target.alphaWidth);
    const sourceY = Math.floor((localY / target.height) * target.alphaHeight);
    if (target.alpha[sourceY * target.alphaWidth + sourceX]! > 0) return target;
  }
  return null;
}

export function findRideIdAtTile(snapshot: Snapshot, tileX: number, tileY: number): number | null {
  for (let i = 0; i < snapshot.rides.count; i++) {
    const offset = i * RIDE_INFO_STRIDE;
    const x = snapshot.rideInfo[offset + RideInfo.RideX];
    const y = snapshot.rideInfo[offset + RideInfo.RideY];
    const type = snapshot.rideInfo[offset + RideInfo.Type] as RideType;
    const definition = RIDE_CATALOG[type];
    const dir = snapshot.rideInfo[offset + RideInfo.Dir];
    if (definition && rideFootprintContains(definition, x, y, dir, tileX, tileY)) {
      return snapshot.rideInfo[offset + RideInfo.Id];
    }
  }

  for (let i = 0; i < snapshot.tracks.count; i++) {
    const offset = i * SNAPSHOT_STRIDE;
    if (Math.floor(snapshot.tracks.data[offset] / TILE_UNITS) !== tileX) continue;
    if (Math.floor(snapshot.tracks.data[offset + 1] / TILE_UNITS) !== tileY) continue;
    return snapshot.tracks.data[offset + 3] >>> 16;
  }

  return null;
}

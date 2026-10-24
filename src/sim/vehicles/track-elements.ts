import type { World } from '../core/world';
import { Z_STEP } from '../core/constants';
import { ElementType } from '../map/tile-map';
import { PIECES } from '../track/catalog';
import type { TrackPath } from '../track/track-path';
import { Bank, PieceFlag, Slope } from '../track/track-types';
import { SCENERY_RADIUS_TILES, SHELTERED_UNIT_WORLD } from './vehicle-ratings';
import type { TrackElementStats } from './vehicle-ratings';

export const NO_TRACK_ELEMENTS: TrackElementStats = {
  flatTurns: [0, 0, 0],
  bankedTurns: [0, 0, 0],
  slopedTurns: [0, 0, 0, 0],
  helices: 0,
  shelteredLength: 0,
  shelteredSections: 0,
  shelteredRollingPieces: 0,
};

/** Number of tile-sized elements a turn spans: small 1, medium 2, large 3. */
function turnElements(shape: string): number {
  if (shape.startsWith('small')) return 1;
  if (shape.startsWith('medium')) return 2;
  return 3;
}

function isTurn(shape: string): boolean {
  return /^(small|medium|large)(Left|Right)$/.test(shape);
}

/** Counts turns, helices and sheltered (below-terrain) track along a ride's centre line. */
export function measureTrackElements(world: World, path: TrackPath): TrackElementStats {
  const flatTurns = [0, 0, 0];
  const bankedTurns = [0, 0, 0];
  const slopedTurns = [0, 0, 0, 0];
  let helices = 0;
  let shelteredUnits = 0;
  let shelteredSections = 0;
  let shelteredRollingPieces = 0;
  let wasSheltered = false;
  const map = world.map;
  const pieceCols = world.track.pieces.cols;
  const segmentCount = path.count - 1;
  const pieces = path.pieceStart.length - 1;
  for (let piece = 0; piece < pieces; piece++) {
    const slot = world.track.pieces.idToSlot[path.piece[path.pieceStart[piece]]];
    const def = PIECES[pieceCols.pieceType[slot]];
    const size = turnElements(def.shape);
    if (isTurn(def.shape)) {
      if (def.entrySlope !== Slope.Flat || def.exitSlope !== Slope.Flat) {
        slopedTurns[Math.min(size, 4) - 1]++;
      } else if (def.entryBank !== Bank.None) bankedTurns[Math.min(size, 3) - 1]++;
      else flatTurns[Math.min(size, 3) - 1]++;
    } else if (def.shape.includes('Helix')) {
      helices++;
    }
    const rolling = def.entryBank !== Bank.None || (def.flags & PieceFlag.Inverted) !== 0;
    let pieceSheltered = false;
    const end = Math.min(path.pieceStart[piece + 1], segmentCount);
    for (let segment = path.pieceStart[piece]; segment < end; segment++) {
      const tx = path.x[segment] >> 8;
      const ty = path.y[segment] >> 8;
      const sheltered =
        map.inBounds(tx, ty) && path.z[segment] < map.heights[map.index(tx, ty)] * Z_STEP;
      if (sheltered) {
        shelteredUnits += path.s[segment + 1] - path.s[segment];
        pieceSheltered = true;
        if (!wasSheltered) shelteredSections++;
      }
      wasSheltered = sheltered;
    }
    if (pieceSheltered && rolling) shelteredRollingPieces++;
  }
  return {
    flatTurns,
    bankedTurns,
    slopedTurns,
    helices,
    shelteredLength: Math.trunc(shelteredUnits / SHELTERED_UNIT_WORLD),
    shelteredSections,
    shelteredRollingPieces,
  };
}

/** Scenery items within SCENERY_RADIUS_TILES of the tile (clipped to the map). */
export function countSceneryNear(world: World, tileX: number, tileY: number): number {
  const map = world.map;
  let items = 0;
  for (let ty = tileY - SCENERY_RADIUS_TILES; ty <= tileY + SCENERY_RADIUS_TILES; ty++) {
    for (let tx = tileX - SCENERY_RADIUS_TILES; tx <= tileX + SCENERY_RADIUS_TILES; tx++) {
      if (!map.inBounds(tx, ty)) continue;
      for (let e = map.firstElement(map.index(tx, ty)); e >= 0; e = map.elNext[e]) {
        const type = map.elType[e];
        if (type === ElementType.SmallScenery || type === ElementType.LargeScenery) items++;
      }
    }
  }
  return items;
}

import type { Snapshot } from '../worker/snapshot';
import type { Rotation } from './projection';

export interface MapData {
  width: number;
  height: number;
  entranceX?: number;
  entranceY?: number;
  heights: Uint8Array;
  surface: Uint8Array;
  slope: Uint8Array;
  waterLevel?: Uint8Array;
  ownership?: Uint8Array;
  pathElements?: Int32Array;
  pathCount?: number;
  sceneryElements?: Int32Array;
  sceneryCount?: number;
}

/**
 * A footpath piece a placement preview draws in the world, in the terms of `MapData.pathElements`:
 * its base level and PathFlag bits. A refused tile is drawn flat on the ground, tinted red.
 */
export interface PathPieceGhost {
  x: number;
  y: number;
  /** Base level of the piece, in the same units as `MapData.heights`. */
  level: number;
  /** PathFlag bits: connections, queue, and slope with its direction. */
  flags: number;
  /** Index into the footpath surfaces: tarmac, crazy paving, dirt. */
  surface: number;
  tone: 'ok' | 'refused';
}

/**
 * A ride or scenery piece a placement preview draws in the world, translucent, at the depth the
 * built piece would take. A refused piece keeps its shape and is tinted red.
 */
export interface SpriteGhost {
  x: number;
  y: number;
  /** Height in levels at the rendered ground pivot; edge props may be between tile levels. */
  level: number;
  /** Atlas key (optionally with a `#frame` suffix) already in the camera's rotation. */
  sprite: string;
  /** Which built kind the piece sorts as: rides and scenery use different depth offsets. */
  kind: 'ride' | 'scenery' | 'path-addition';
  /** Optional rendered box for path additions. */
  width?: number;
  height?: number;
  tone: 'ok' | 'refused';
}

export interface Camera {
  /** World-pixel point at the centre of the viewport. */
  x: number;
  y: number;
  zoom: number;
  rotation: Rotation;
  showGridlines?: boolean;
}

/**
 * Rendering backend contract. The main thread owns exactly one Renderer; it never touches sim
 * state, only the immutable-for-the-frame Snapshot and the (rarely changing) MapData.
 *
 * Implementations: WebGL2Renderer (primary, instanced quads for tiles and entities with a
 * procedural atlas) and Canvas2DRenderer (fallback).
 */
export interface Renderer {
  readonly backend: string;
  readonly visibleSpriteCount: number;
  attach(canvas: HTMLCanvasElement): void;
  resize(width: number, height: number, devicePixelRatio: number): void;
  setMap(map: MapData): void;
  /** Footpath pieces drawn translucently in the world until replaced; an empty list clears them. */
  setGhosts(ghosts: readonly PathPieceGhost[]): void;
  /** Ride and scenery previews drawn in the depth-sorted world pass until replaced. */
  setSpriteGhosts(ghosts: readonly SpriteGhost[]): void;
  draw(snapshot: Snapshot | null, camera: Camera): void;
  dispose(): void;
}

import type { Snapshot } from '../worker/snapshot';
import type { Rotation } from './projection';

export interface MapData {
  width: number;
  height: number;
  heights: Uint8Array;
  surface: Uint8Array;
  slope: Uint8Array;
  waterLevel?: Uint8Array;
  pathElements?: Int32Array;
  pathCount?: number;
  sceneryElements?: Int32Array;
  sceneryCount?: number;
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
  draw(snapshot: Snapshot | null, camera: Camera): void;
  dispose(): void;
}

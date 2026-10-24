import type { Snapshot } from '../worker/snapshot';
import type { Rotation } from './projection';

export interface MapData {
  width: number;
  height: number;
  heights: Uint8Array;
  surface: Uint8Array;
}

export interface Camera {
  /** World-pixel point at the centre of the viewport. */
  x: number;
  y: number;
  zoom: number;
  rotation: Rotation;
}

/**
 * Rendering backend contract. The main thread owns exactly one Renderer; it never touches sim
 * state, only the immutable-for-the-frame Snapshot and the (rarely changing) MapData.
 *
 * Implementations: Canvas2DRenderer (placeholder, shipped) and WebGL2Renderer (planned:
 * instanced quads for tiles and entities, texture atlas generated procedurally).
 */
export interface Renderer {
  attach(canvas: HTMLCanvasElement): void;
  resize(width: number, height: number, devicePixelRatio: number): void;
  setMap(map: MapData): void;
  draw(snapshot: Snapshot | null, camera: Camera): void;
  dispose(): void;
}

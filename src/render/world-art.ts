export const TERRAIN_SLOPE_NAMES = Array.from(
  { length: 16 },
  (_, index) => `shape-${index.toString(16).padStart(2, '0')}`,
);

export type TerrainSurface = 'grass' | 'dirt' | 'sand' | 'rock';
export type PathSurface = 'tarmac' | 'crazy-paving' | 'dirt' | 'queue';

export function terrainSpriteName(surface: TerrainSurface, slopeMask: number): string {
  const shape = Number.isInteger(slopeMask) && slopeMask >= 0 && slopeMask <= 15 ? slopeMask : 0;
  return `terrain/${surface}/shape-${shape.toString(16).padStart(2, '0')}`;
}

export function terrainSurfaceSpriteName(surface: TerrainSurface): string {
  return `terrain/${surface}/surface`;
}

export function pathSpriteName(
  surface: PathSurface,
  edges: number,
  slopeDirection?: number,
): string {
  if (slopeDirection !== undefined && slopeDirection >= 0 && slopeDirection <= 3)
    return `paths/${surface}/ramp-${slopeDirection}`;
  return `paths/${surface}/connection-${(edges & 0x0f).toString(16).padStart(2, '0')}`;
}

export function waterFrameIndex(tick: number): number {
  return Math.floor(Math.max(0, tick) / 8) % 4;
}

export function waterSpriteName(frame: number): string {
  return `water/surface#${((frame % 4) + 4) % 4}`;
}

export function scenerySpriteName(name: string): string {
  return name.startsWith('tree-') ? `trees/${name}` : `scenery/${name}`;
}

export function spriteViewName(name: string, rotation: number): string {
  const view = Number.isInteger(rotation) && rotation >= 0 && rotation <= 3 ? rotation : 0;
  return `${name}/view-${view}`;
}

export function atlasFrameOrFallback<T>(
  sprites: Record<string, { frames: readonly T[] }> | undefined,
  requested: string,
  fallback: T,
): T {
  return sprites?.[requested]?.frames[0] ?? fallback;
}

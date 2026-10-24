import type { World } from './world';

/** FNV-1a over the live portion of all sim state; used by determinism tests and desync checks. */
export function hashWorld(world: World): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 16) & 0xff), 0x01000193);
    h = Math.imul(h ^ (v >>> 24), 0x01000193);
  };
  mix(world.tick);
  for (const w of world.rng.state) mix(w);
  for (const store of [world.guests, world.staff, world.vehicles, world.litter]) {
    mix(store.count);
    for (const key of Object.keys(store.cols)) {
      const col = (store.cols as unknown as Record<string, Int32Array>)[key];
      for (let i = 0; i < store.count; i++) mix(col[i]);
    }
  }
  for (let i = 0; i < world.map.heights.length; i++) mix(world.map.heights[i]);
  mix(world.economy.cash);
  return h >>> 0;
}

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
  for (const store of [
    world.guests,
    world.staff,
    world.vehicles,
    world.litter,
    world.rides,
    world.track.pieces,
    world.rides,
  ]) {
    mix(store.count);
    for (const key of Object.keys(store.cols)) {
      const col = (store.cols as unknown as Record<string, Int32Array>)[key];
      for (let i = 0; i < store.count; i++) mix(col[i]);
    }
  }
  for (const arr of world.map.arrays()) {
    const a = arr as unknown as ArrayLike<number>;
    for (let i = 0; i < a.length; i++) mix(a[i]);
  }
  const e = world.economy;
  for (const v of [
    e.cash,
    e.loan,
    e.maxLoan,
    e.annualInterestBps,
    e.priceMode,
    e.admissionPrice,
    e.historyHead,
    e.monthsCompleted,
    e.campaignId,
    e.campaignWeeksLeft,
    e.parkValue,
    e.parkRating,
    ...Object.values(e.inputs),
  ]) {
    mix(v);
  }
  for (const v of e.monthlyTotals) mix(v);
  for (const v of e.history) mix(v);
  const r = world.research;
  for (const v of [r.funding, r.enabledCategoryMask, r.currentIndex, r.progress, r.unlocked.size]) {
    mix(v);
  }
  for (const inv of r.inventions) {
    mix(inv.itemId);
    mix(inv.category);
    mix(inv.costCents);
  }
  for (const id of r.unlocked) mix(id);
  const s = world.scenario;
  mix(s.status);
  if (s.objective) for (const v of Object.values(s.objective)) mix(v);
  for (const table of world.track.rideTables()) {
    const t = table as Int32Array;
    for (let i = 0; i < t.length; i++) mix(t[i]);
  }
  mix(world.park.entranceX);
  mix(world.park.entranceY);
  mix(world.track.lastResult);
  return h >>> 0;
}

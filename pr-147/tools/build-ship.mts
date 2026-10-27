// usage: tsx build-ship.mts <repoDir> <outDir> <mode: before|after>
import { mkdirSync, writeFileSync } from 'node:fs';
const [repo, out, mode] = process.argv.slice(2);
const imp = (p: string) => import(`${repo}/${p}`);
const { Simulation } = await imp('src/sim/core/simulation.ts');
const { RIDE_CATALOG, RideType } = await imp('src/sim/rides/ride-types.ts');
const { rideFootprintTiles } = await imp('src/sim/rides/ride-footprint.ts');
const { OWNED } = await imp('src/sim/map/tile-map.ts');
const { serialize } = await imp('src/save/save.ts');
const { TILE_UNITS } = await imp('src/sim/core/constants.ts');
const { RidePhase, RideState } = await imp('src/sim/rides/ride-store.ts');
mkdirSync(out, { recursive: true });
const sim = new Simulation({ seed: 1, width: 48, height: 48, maxGuests: 64 });
const w = sim.world;
w.map.waterLevel.fill(0); w.map.fillFlat(2); w.map.ownership.fill(OWNED); w.map.sceneryCount = 0;
w.economy.cash = 100_000_000;
const def = RIDE_CATALOG[RideType.SwingingShip];
w.research.unlocked.add(RideType.SwingingShip);
const bottom = 22, left = 20;
const rel = rideFootprintTiles(def, 0, 0, 0) as [number, number][];
const minX = Math.min(...rel.map((t) => t[0])), maxY = Math.max(...rel.map((t) => t[1]));
const anchor = [left - minX, bottom - maxY];
sim.enqueue({ type: 'createRide', rideType: RideType.SwingingShip, x: anchor[0], y: anchor[1] });
sim.step();
const rideId = w.rides.slotToId[w.rides.count - 1];
const tiles = rideFootprintTiles(def, anchor[0], anchor[1], 0) as [number, number][];
console.log('tiles', JSON.stringify(tiles));
const x = tiles[0][0];
const ys = tiles.map((t) => t[1]);
for (let xx = x - 3; xx <= x + 3; xx++) sim.enqueue({ type: 'placePath', x: xx, y: bottom + 2 });
sim.enqueue({ type: 'placeRideEntrance', rideId, x, y: bottom + 1 });
sim.enqueue({ type: 'placeRideExit', rideId, x: x + 1, y: bottom + 1 });
sim.step();
sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
sim.step();
const slot = w.rides.idToSlot[rideId];
const r = w.rides.cols;
console.log('state', r.state[slot], 'phase', r.phase[slot], 'run', r.runTicks[slot], 'load', r.loadTicks[slot], 'unload', r.unloadTicks[slot]);
const samples: { name: string; phase: number; pt: number; tick: number }[] = [];
const baseTick = 8 * 1000;
samples.push({ name: 'f00-rest', phase: RidePhase.Waiting, pt: 0, tick: baseTick });
if (mode === 'before') {
  for (let k = 0; k < 12; k++) samples.push({ name: `f${String(k + 1).padStart(2, '0')}-run`, phase: RidePhase.Running, pt: 480 - k * 40, tick: baseTick + 8 * k });
} else {
  const run = r.runTicks[slot];
  const { SHIP_SWING_DEGREES: DEG } = await imp('tools/sprites/models/flat-rides.ts');
  const { rideSpriteFrame } = await imp('src/render/world-art.ts');
  const frames = DEG.length + 1;
  const idxs = (process.env.POSES ?? '3,6,13,19,31,43,55,61,67,79,91,103,109,115,127,132').split(',').map(Number);
  idxs.forEach((idx, k) => {
    for (let pt = run; pt >= 1; pt--) {
      const prog = Math.min(1000, Math.round(((run - pt) * 1000) / run));
      if (rideSpriteFrame(RidePhase.Running, 0, frames, prog) === idx + 1) {
        samples.push({ name: `f${String(k + 1).padStart(2, '0')}-pose${String(idx).padStart(3, '0')}-${DEG[idx].toFixed(0)}deg`, phase: RidePhase.Running, pt, tick: baseTick });
        break;
      }
    }
  });
}
samples.push({ name: 'f99-unload', phase: RidePhase.Unloading, pt: 50, tick: baseTick });
const manifest: any = { focus: [(x + 0.5) * TILE_UNITS, (Math.min(...ys) + Math.max(...ys) + 1) / 2 * TILE_UNITS, 2 * 0], samples: [] };
for (const s of samples) {
  r.state[slot] = RideState.Open; r.phase[slot] = s.phase; r.phaseTicks[slot] = s.pt; r.boarded[slot] = s.phase === RidePhase.Waiting ? 0 : 24;
  w.tick = s.tick;
  writeFileSync(`${out}/${s.name}.ocsave`, serialize(w));
  manifest.samples.push(s.name);
}
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 1));
console.log(JSON.stringify(manifest));

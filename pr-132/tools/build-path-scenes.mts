// usage: tsx build-path-scenes.mts <repoDir> <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
const [repo, out] = process.argv.slice(2);
const imp = (p: string) => import(`${repo}/${p}`);
const { Simulation } = await imp('src/sim/core/simulation.ts');
const { OWNED, PATH_ADDITION_BROKEN } = await imp('src/sim/map/tile-map.ts');
const { PathAddition } = await imp('src/sim/map/paths.ts');
const { serialize } = await imp('src/save/save.ts');
const { TILE_UNITS } = await imp('src/sim/core/constants.ts');
mkdirSync(out, { recursive: true });

function park() {
  const sim = new Simulation({ seed: 1, width: 48, height: 48, maxGuests: 64 });
  sim.world.map.waterLevel.fill(0);
  sim.world.map.fillFlat(2);
  sim.world.map.ownership.fill(OWNED);
  sim.world.map.sceneryCount = 0;
  sim.world.economy.cash = 100_000_000;
  return sim;
}
const B = PathAddition.Bench, N = PathAddition.Bin, L = PathAddition.Lamp;
function path(sim: any, tiles: [number, number][]) {
  for (const [x, y] of tiles) sim.enqueue({ type: 'placePath', x, y });
  sim.step();
}
function addition(sim: any, x: number, y: number, addition: number, broken = false) {
  sim.enqueue({ type: 'setPathAddition', x, y, addition });
  sim.step();
  if (broken) {
    const m = sim.world.map;
    m.elData[m.pathElement(m.index(x, y), -1)] |= PATH_ADDITION_BROKEN;
    m.revision++;
  }
}
function guest(sim: any, x: number, y: number, ox = 0, oy = 0) {
  sim.enqueue({ type: 'spawnGuests', count: 1 });
  sim.step();
  const g = sim.world.guests;
  const slot = g.count - 1;
  g.cols.x[slot] = x * TILE_UNITS + TILE_UNITS / 2 + ox;
  g.cols.y[slot] = y * TILE_UNITS + TILE_UNITS / 2 + oy;
  g.cols.z[slot] = sim.world.map.heightAt(g.cols.x[slot], g.cols.y[slot]);
  g.cols.targetX[slot] = x;
  g.cols.targetY[slot] = y;
}
const row = (x0: number, x1: number, y: number) => Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y] as [number, number]);
const col = (x: number, y0: number, y1: number) => Array.from({ length: y1 - y0 + 1 }, (_, i) => [x, y0 + i] as [number, number]);
const manifest: Record<string, any> = {};
const save = (name: string, sim: any, fx: number, fy: number, extra: any = {}) => {
  writeFileSync(`${out}/${name}.ocsave`, serialize(sim.world));
  manifest[name] = { focus: [fx * TILE_UNITS, fy * TILE_UNITS, 0], ...extra };
};

{ // busy straight path: benches, bins, lamps, a few vandalised, guests walking along it
  const sim = park();
  path(sim, row(8, 30, 22));
  const pattern = [B, N, L, B, L, N, B, B, L, N, B, L];
  for (let i = 0; i < 22; i++) addition(sim, 9 + i, 22, pattern[i % pattern.length], i % 7 === 3);
  for (let i = 0; i < 9; i++) guest(sim, 10 + i * 2, 22, (i % 3) * 40 - 40, (i % 2) * 36 - 18);
  for (let i = 0; i < 12; i++) sim.step();
  save('busy-straight', sim, 19.5, 22.5);
}
{ // T-junction
  const sim = park();
  path(sim, row(10, 26, 20).concat(col(18, 21, 28)));
  [[11, 20, B], [13, 20, N], [15, 20, L], [21, 20, B], [23, 20, L], [25, 20, N], [18, 22, B], [18, 24, N], [18, 26, L], [18, 28, B], [18, 20, L]]
    .forEach(([x, y, a]) => addition(sim, x, y, a));
  [[12, 20], [16, 20], [22, 20], [18, 23], [18, 27]].forEach(([x, y], i) => guest(sim, x, y, 0, i % 2 ? 24 : -24));
  save('t-junction', sim, 18.5, 23.5);
}
{ // dead end
  const sim = park();
  path(sim, row(10, 24, 22));
  [[11, 22, N], [13, 22, B], [15, 22, L], [17, 22, B], [19, 22, N], [21, 22, B], [24, 22, B], [23, 22, L]].forEach(([x, y, a]) => addition(sim, x, y, a));
  [[12, 22], [18, 22], [22, 22]].forEach(([x, y], i) => guest(sim, x, y, i * 20 - 20, 0));
  save('dead-end', sim, 17.5, 22.5);
}
{ // close-up: a guest beside each prop type, intact and vandalised
  const sim = park();
  path(sim, row(12, 22, 22));
  [[13, B], [15, N], [17, L], [19, B], [21, N]].forEach(([x, a], i) => addition(sim, x, 22, a, x === 19 || x === 21));
  [13, 15, 17, 19, 21].forEach((x) => guest(sim, x, 22, 0, 0));
  addition(sim, 12, 22, L);
  save('closeup', sim, 17.5, 22.5, { crop: true });
}
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 1));
console.log(Object.keys(manifest));

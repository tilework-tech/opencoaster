// usage: tsx build-wall-scenes.mts <repoDir> <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
const [repo, out] = process.argv.slice(2);
const imp = (p: string) => import(`${repo}/${p}`);
const { Simulation } = await imp('src/sim/core/simulation.ts');
const { OWNED } = await imp('src/sim/map/tile-map.ts');
const { removeScenery } = await imp('src/sim/map/scenery.ts');
const { serialize } = await imp('src/save/save.ts');
const { TILE_UNITS } = await imp('src/sim/core/constants.ts');
mkdirSync(out, { recursive: true });
const HEDGE = 5, WOOD = 6, STONE = 7;
// edge index: 0 = +x side, 1 = +y side, 2 = -x side, 3 = -y side
function park(sloped: boolean) {
  const sim = new Simulation({ seed: 1, width: 48, height: 48, maxGuests: 64 });
  const m = sim.world.map;
  m.waterLevel.fill(0);
  m.fillFlat(2);
  if (sloped) {
    const w1 = m.width + 1;
    for (let vy = 0; vy <= m.height; vy++) for (let vx = 0; vx <= m.width; vx++) m.vertexHeights[vy * w1 + vx] = 2 + Math.max(0, Math.min(4, Math.floor((vx - 17) / 2)));
    for (let i = 0; i < m.heights.length; i++) m.refreshTile(i);
  }
  m.ownership.fill(OWNED);
  m.sceneryCount = 0;
  for (let y = 10; y < 38; y++) for (let x = 10; x < 38; x++) while (removeScenery(m, x, y) !== null);
  sim.world.economy.cash = 100_000_000;
  return sim;
}
const wall = (sim: any, item: number, x: number, y: number, edge: number) => {
  sim.enqueue({ type: 'placeScenery', x, y, item, rotation: edge });
  sim.step();
};
function path(sim: any, tiles: [number, number][]) {
  for (const [x, y] of tiles) sim.enqueue({ type: 'placePath', x, y });
  sim.step();
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
const save = (name: string, sim: any, fx: number, fy: number) => {
  for (let i = 0; i < 3; i++) sim.step();
  writeFileSync(`${out}/${name}.ocsave`, serialize(sim.world));
  const z = sim.world.map.heightAt(fx * TILE_UNITS, fy * TILE_UNITS);
  manifest[name] = { focus: [fx * TILE_UNITS, fy * TILE_UNITS, z] };
};
function enclosure(sim: any, item: number, x0: number, y0: number, n: number) {
  for (let i = 0; i < n; i++) {
    wall(sim, item, x0 + i, y0, 3); // north
    wall(sim, item, x0 + i, y0 + n - 1, 1); // south
    wall(sim, item, x0, y0 + i, 2); // west
    wall(sim, item, x0 + n - 1, y0 + i, 0); // east
  }
}
for (const [name, item, sloped] of [['wood-enclosure', WOOD, false], ['stone-enclosure-slope', STONE, true]] as const) {
  const sim = park(sloped);
  enclosure(sim, item, 20, 20, 4);
  // path loops round the outside
  path(sim, [...row(18, 25, 18), ...row(18, 25, 25), ...col(18, 19, 24), ...col(25, 19, 24)]);
  [[19, 18], [23, 18], [18, 22], [25, 21], [21, 25], [24, 25]].forEach(([x, y], i) => guest(sim, x, y, i % 2 ? 30 : -30, i % 3 ? 20 : -20));
  guest(sim, 21, 21); guest(sim, 22, 22);
  save(name, sim, 22, 22);
}
{ // hedge maze corner: an L and a T
  const sim = park(false);
  for (let x = 18; x < 22; x++) wall(sim, HEDGE, x, 20, 3);
  for (let y = 20; y < 24; y++) wall(sim, HEDGE, 18, y, 2);
  for (let x = 18; x < 25; x++) wall(sim, HEDGE, x, 27, 3);
  for (let y = 27; y < 31; y++) wall(sim, HEDGE, 21, y, 2);
  path(sim, [...row(19, 23, 22), ...row(19, 24, 25), ...row(22, 24, 29)]);
  [[19, 22], [22, 22], [20, 25], [23, 25], [22, 29], [24, 29]].forEach(([x, y], i) => guest(sim, x, y, i % 2 ? 25 : -25, i % 3 ? 15 : -15));
  save('hedge-maze', sim, 21, 25);
}
{ // one tile, fences on all four edges (wood + stone + hedge variants side by side)
  const sim = park(false);
  for (let e = 0; e < 4; e++) wall(sim, WOOD, 22, 22, e);
  for (let e = 0; e < 4; e++) wall(sim, STONE, 25, 22, e);
  for (let e = 0; e < 4; e++) wall(sim, HEDGE, 19, 22, e);
  path(sim, row(17, 28, 24));
  guest(sim, 22, 22); guest(sim, 21, 24, 20, 0); guest(sim, 23, 24, -20, 0);
  save('four-edges', sim, 22, 23);
}
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 1));
console.log(JSON.stringify(manifest));

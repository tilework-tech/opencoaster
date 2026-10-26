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

const sim = park(false);
guest(sim, 22, 24);
path(sim, row(18, 27, 25));
for (let i = 0; i < 3; i++) sim.step();
writeFileSync(`${out}/preview.ocsave`, serialize(sim.world));

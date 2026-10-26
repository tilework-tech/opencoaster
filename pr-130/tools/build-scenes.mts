// usage: tsx build-scenes.ts <repoDir> <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
const [repo, out] = process.argv.slice(2);
const imp = (p: string) => import(`${repo}/${p}`);
const { Simulation } = await imp('src/sim/core/simulation.ts');
const { RIDE_CATALOG, RideType } = await imp('src/sim/rides/ride-types.ts');
const { rideFootprintTiles } = await imp('src/sim/rides/ride-footprint.ts');
const { OWNED } = await imp('src/sim/map/tile-map.ts');
const { serialize } = await imp('src/save/save.ts');
const { TILE_UNITS } = await imp('src/sim/core/constants.ts');
mkdirSync(out, { recursive: true });

type Tile = [number, number];
const RIDES: Record<string, number> = {
  'merry-go-round': 1, 'swinging-ship': 2, 'ferris-wheel': 3, twist: 4, 'haunted-house': 11,
  'spiral-slide': 12, 'top-spin': 13, enterprise: 14, 'observation-tower': 23,
};

function park(w: number, h: number) {
  const sim = new Simulation({ seed: 1, width: w, height: h, maxGuests: 64 });
  sim.world.map.waterLevel.fill(0);
  sim.world.map.fillFlat(2);
  sim.world.map.ownership.fill(OWNED);
  sim.world.map.sceneryCount = 0;
  sim.world.economy.cash = 100_000_000;
  return sim;
}
const centre = (t: Tile) => [t[0] * TILE_UNITS + TILE_UNITS / 2, t[1] * TILE_UNITS + TILE_UNITS / 2];

/** Places the ride so its southern footprint row is `bottom` and its west column starts at `left`;
 *  returns tiles, entrance/exit. */
function addRide(sim: any, type: number, left: number, bottom: number) {
  const def = RIDE_CATALOG[type];
  const rel = rideFootprintTiles(def, 0, 0, 0) as Tile[];
  const minX = Math.min(...rel.map((t) => t[0]));
  const maxY = Math.max(...rel.map((t) => t[1]));
  const anchor: Tile = [left - minX, bottom - maxY];
  sim.world.research.unlocked.add(type);
  sim.enqueue({ type: 'createRide', rideType: type, x: anchor[0], y: anchor[1] });
  sim.step();
  const rideId = sim.world.rides.slotToId[sim.world.rides.count - 1];
  const tiles = rideFootprintTiles(def, anchor[0], anchor[1], 0) as Tile[];
  const xs = tiles.map((t) => t[0]);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const south = tiles.filter((t) => t[1] === bottom).map((t) => t[0]);
  const ent: Tile = [Math.min(...south), bottom + 1];
  const ex: Tile = [Math.max(...south) === ent[0] ? hi + 1 : Math.max(...south), bottom + 1];
  if (ex[0] === ent[0]) ex[1] = bottom; // single column: exit beside, handled below
  // street row at bottom+2
  for (let x = Math.min(ent[0], ex[0]); x <= Math.max(ent[0], ex[0]); x++)
    sim.enqueue({ type: 'placePath', x, y: bottom + 2 });
  sim.enqueue({ type: 'placeRideEntrance', rideId, x: ent[0], y: ent[1] });
  sim.enqueue({ type: 'placeRideExit', rideId, x: ex[0], y: ex[1] });
  sim.step();
  return { rideId, tiles, lo, hi, ent, ex };
}

function path(sim: any, x0: number, x1: number, y: number) {
  for (let x = x0; x <= x1; x++) sim.enqueue({ type: 'placePath', x, y });
  sim.step();
}
function guest(sim: any, i: number, x: number, y: number) {
  sim.enqueue({ type: 'spawnGuests', count: 1 });
  sim.step();
  const g = sim.world.guests;
  const slot = g.count - 1;
  const [px, py] = centre([x, y] as Tile);
  g.cols.x[slot] = px + (i % 2 ? 40 : -40);
  g.cols.y[slot] = py;
  g.cols.z[slot] = sim.world.map.heightAt(g.cols.x[slot], g.cols.y[slot]);
  g.cols.targetX[slot] = x;
  g.cols.targetY[slot] = y;
}

const manifest: Record<string, any> = {};
// single-ride scenes
for (const slug of ['merry-go-round', 'enterprise', 'ferris-wheel', 'top-spin', 'swinging-ship']) {
  const sim = park(48, 48);
  const bottom = 22;
  const r = addRide(sim, RIDES[slug], 20, bottom);
  const y = bottom + 2;
  path(sim, r.lo - 4, r.hi + 6, y);
  // stall and tree on the near side of the street
  sim.world.research.unlocked.add(RideType.FoodStall);
  sim.enqueue({ type: 'createRide', rideType: RideType.FoodStall, x: r.hi + 3, y: y + 1 });
  sim.step();
  sim.enqueue({ type: 'placeScenery', x: r.lo - 2, y: y + 1, item: 0 });
  sim.enqueue({ type: 'placeScenery', x: r.lo - 3, y: bottom, item: 2 });
  sim.step();
  [[r.lo - 3, y], [r.lo, y], [r.lo + 1, y], [r.hi, y], [r.hi + 1, y], [r.hi + 2, y]]
    .forEach(([gx, gy], i) => guest(sim, i, gx, gy));
  sim.step();
  const mid = [(r.lo + r.hi + 1) / 2, bottom - 1];
  writeFileSync(`${out}/${slug}.ocsave`, serialize(sim.world));
  manifest[slug] = { focus: [mid[0] * TILE_UNITS, (mid[1] + 1) * TILE_UNITS, 2 * 0] };
}
// lineup
{
  const sim = park(96, 48);
  const bottom = 22;
  let left = 4;
  const order = Object.keys(RIDES);
  const streetY = bottom + 2;
  const rows: any[] = [];
  for (const slug of order) {
    const r = addRide(sim, RIDES[slug], left, bottom);
    rows.push(r);
    left = r.hi + 4;
  }
  path(sim, 2, left, streetY);
  rows.forEach((r, i) => {
    guest(sim, i, r.hi + 1, bottom); // beside the ride's east edge
    guest(sim, i, r.hi + 1, streetY);
  });
  sim.step();
  writeFileSync(`${out}/lineup.ocsave`, serialize(sim.world));
  manifest.lineup = { focus: [((4 + left) / 2) * TILE_UNITS, (bottom + 1) * TILE_UNITS, 0], span: left - 4 };
}
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 1));
console.log(JSON.stringify(manifest));

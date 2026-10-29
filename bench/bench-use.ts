import { createBalancePark } from './balance-park';
import type { BalanceProfile } from './balance-park';
import { TICKS_PER_MONTH } from '../src/sim/economy/calendar';
import { GuestState } from '../src/sim/guests/guest-store';
import { PathAddition } from '../src/sim/map/paths';
import { ElementType, PathFlag } from '../src/sim/map/tile-map';

/**
 * How often ordinary guests choose, sit on and leave benches in the scripted balance park.
 * Usage: tsx bench/bench-use.ts [--months 6] [--every 3] [--seed 1] [--profile modest]
 * `--every 0` builds no benches (the control run).
 */
function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const months = arg('months', 6);
const every = arg('every', 3);
const seed = arg('seed', 1);
const profileArg = process.argv.indexOf('--profile');
const profile = (profileArg >= 0 ? process.argv[profileArg + 1] : 'modest') as BalanceProfile;

const park = createBalancePark({ seed, profile });
const sim = park.sim;
const world = sim.world;
const map = world.map;

function placeBenches(): number {
  if (every <= 0) return 0;
  let placed = 0;
  let counter = 0;
  for (let tile = 0; tile < map.width * map.height; tile++) {
    for (let e = map.firstElement(tile); e >= 0; e = map.elNext[e]) {
      if (map.elType[e] !== ElementType.Path) continue;
      const flags = map.elFlags[e];
      if (flags & (PathFlag.Queue | PathFlag.Sloped | PathFlag.Bin | PathFlag.Lamp)) break;
      if ((map.pathEdgesOf(e) & 0xf) === 0xf) break;
      if (counter++ % every === 0) {
        sim.enqueue({
          type: 'setPathAddition',
          x: tile % map.width,
          y: Math.floor(tile / map.width),
          addition: PathAddition.Bench,
        });
        placed++;
      }
      break;
    }
  }
  return placed;
}

let benches = 0;
const wasSitting = new Map<number, number>();
const sitters = new Set<number>();
const seen = new Set<number>();
let sessions = 0;
let seatedGuestTicks = 0;
let completed = 0;
let totalSessionTicks = 0;
let peak = 0;
let byTired = 0;
let byNausea = 0;
let byBoth = 0;
const total = months * TICKS_PER_MONTH;
for (let i = 0; i < total; i++) {
  park.runSchedule();
  if (i === TICKS_PER_MONTH * 3) benches = placeBenches();
  sim.step();
  const g = world.guests.cols;
  let now = 0;
  for (let slot = 0; slot < world.guests.count; slot++) {
    const id = world.guests.slotToId[slot]!;
    seen.add(id);
    if (g.state[slot] !== GuestState.Sitting) continue;
    now++;
    if (!wasSitting.has(id)) {
      sessions++;
      const tired = g.energy[slot]! <= 70;
      const sick = g.nausea[slot]! >= 128;
      if (tired && sick) byBoth++;
      else if (tired) byTired++;
      else byNausea++;
      sitters.add(id);
      wasSitting.set(id, world.tick);
    }
  }
  seatedGuestTicks += now;
  peak = Math.max(peak, now);
  if (i % 8 === 0)
    for (const [id, start] of wasSitting) {
      const slot = world.guests.idToSlot[id] ?? -1;
      if (slot >= 0 && world.guests.slotToId[slot] === id && g.state[slot] === GuestState.Sitting)
        continue;
      wasSitting.delete(id);
      completed++;
      totalSessionTicks += world.tick - start;
    }
}

console.log(
  JSON.stringify(
    {
      months,
      ticks: total,
      benches,
      guestsSeen: seen.size,
      sittingSessions: sessions,
      distinctSitters: sitters.size,
      sitterShare: Number((sitters.size / Math.max(1, seen.size)).toFixed(4)),
      completedSessions: completed,
      meanSessionTicks: completed ? Math.round(totalSessionTicks / completed) : 0,
      seatedGuestTicks,
      peakSeated: peak,
      startedTired: byTired,
      startedNauseous: byNausea,
      startedBoth: byBoth,
    },
    null,
    1,
  ),
);

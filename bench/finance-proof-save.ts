import { writeFileSync } from 'node:fs';
import { createBalancePark } from './balance-park';
import { TICKS_PER_MONTH } from '../src/sim/economy/calendar';
import { serialize } from '../src/save/save';
import type { BalanceProfile } from './balance-park';

/**
 * Runs the scripted starter park for a few months and writes the world as a save file, so the
 * Finances window can be filmed over a park with real history. Flags: `--months N` (default 5),
 * `--profile minimal|modest|ambitious`, `--out PATH`, `--cash DOLLARS` to overwrite cash at the end.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const months = Number(arg('months') ?? 5);
const profile = (arg('profile') ?? 'modest') as BalanceProfile;
const out = arg('out');
if (!out) throw new Error('pass --out PATH');
const park = createBalancePark({ profile });
for (let t = 0; t < months * TICKS_PER_MONTH; t++) {
  park.runSchedule();
  park.sim.step();
}
const cash = arg('cash');
if (cash !== undefined) park.sim.world.economy.cash = Math.round(Number(cash) * 100);
writeFileSync(out, serialize(park.sim.world));
console.log(`wrote ${out}: ${months} months, ${profile}, cash ${park.sim.world.economy.cash}`);

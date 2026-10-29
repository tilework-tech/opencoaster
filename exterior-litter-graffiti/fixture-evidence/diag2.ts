import { createBalancePark } from './balance-park';
import { TICKS_PER_MONTH } from '../src/sim/economy/calendar';
const seed = process.argv[2] === 'd' ? undefined : Number(process.argv[2]);
const park = createBalancePark({ seed }); const w = park.sim.world; const FULL = TICKS_PER_MONTH * 8;
const rs: number[] = []; const lits: number[] = []; let minR = 9999;
for (let t = 0; t < FULL; t++) { park.runSchedule(); park.sim.step();
  if (t % 1024 === 0 && t > TICKS_PER_MONTH * 3) { const r = (w.economy as any).parkRating; rs.push(r); lits.push(w.litter.count); minR = Math.min(minR, r); } }
const mean = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
console.log(`seed=${process.argv[2]} fix=${process.env.FIX ?? '-'} status=${w.scenario.status} guests=${w.guests.count} rating=${(w.economy as any).parkRating} meanR(m3+)=${mean(rs)} minR=${minR} meanLit=${mean(lits)} staff=${w.staff.count}`);

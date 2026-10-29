import { createBalancePark } from './balance-park';
import { TICKS_PER_MONTH } from '../src/sim/economy/calendar';
import { RideState } from '../src/sim/rides/ride-store';
import { RIDE_CATALOG } from '../src/sim/rides/ride-types';
import { isShopCategory } from '../src/sim/rides/ride-operations';
import { StaffKind } from '../src/sim/staff/staff-store';
const seed = process.argv[2] === 'd' ? undefined : Number(process.argv[2]);
const park = createBalancePark({ seed });
const w = park.sim.world;
for (let t = 0; t < TICKS_PER_MONTH * 8; t++) { park.runSchedule(); park.sim.step(); }
let open = 0, att = 0;
for (let s = 0; s < w.rides.count; s++) {
  const d = RIDE_CATALOG[w.rides.cols.typeId[s] as number];
  if (isShopCategory(d.category)) continue; att++;
  if (w.rides.cols.state[s] === RideState.Open) open++;
}
let handymen = 0;
for (let s = 0; s < w.staff.count; s++) if (w.staff.cols.kind[s] === StaffKind.Handyman) handymen++;
console.log(JSON.stringify({ seed: process.argv[2], handymen, status: w.scenario.status === 1 ? 'Won' : 'Lost', guests: w.guests.count, rating: (w.economy as { parkRating: number }).parkRating, litter: w.litter.count, openAttractions: `${open}/${att}` }));

# Balance

Tuning notes for the gameplay constants that decide how a park feels: the park rating, who arrives, which rides guests choose, and how stalls and queues behave. Numbers here are OpenCoaster tuning, calibrated with the headless harness below; where a number comes from a described public behaviour it is cited in [mechanics/economy.md](mechanics/economy.md) or [mechanics/guests.md](mechanics/guests.md).

## Harness

`pnpm balance` runs the real `Simulation` headlessly through one in-game year (131,072 ticks, about two seconds of wall time) in the starter scenario, driven only by the commands a player issues, and prints:

- a monthly table: guests, arrivals (admission income divided by the fee), park rating, cash, park value, ride count, litter, unhappy guests (%), lost guests, ride downtime, and average happiness, hunger and thirst;
- per-ride usage: ratings, guests served, current line, cycles;
- the guest thought histogram (summed over month-end samples), the whole-run ledger, and the scenario objective outcome.

Flags: `--profile minimal|modest|ambitious` (default `modest`), `--seed N` (default: the scenario seed), `--ticks N`.

The park is scripted in [bench/balance-park.ts](../bench/balance-park.ts) on flat terrain (the generated terrain is flattened so layout does not depend on the lake): a footpath spine north from the gate with rides on both sides, each with a queue and an exit path.

| Profile   | What is built                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| minimal   | Month 0 only: merry-go-round, Ferris wheel, food and drink stall, toilets. No staff.                                                                            |
| modest    | Minimal plus swinging ship, twist, kiosk and a second set of stalls (month 1), a third set of stalls and a wooden coaster (month 2), 4 handymen and a mechanic. |
| ambitious | Modest plus nine more flat rides, one per fortnight from month 2.                                                                                               |

`bench/balance.test.ts` runs the modest profile for four months in CI: the crowd and rating stay in a sane band, every ride type near the gate (including the coaster) is used, and the run is deterministic and survives a save and load.

## What changed and why

| Problem                                    | Cause                                                                                                                                                     | Fix                                                                                                                                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Park rating saturates at 999               | The excitement/intensity terms of the community formula were never implemented, so only penalties could pull the rating off the 1,000 plateau.            | `computeParkRating` adds the average-proximity terms (ideal 3.68 / 5.20, up to 50 each) and the variety terms (up to 100 each, gone at a total of 80.00). See [Rating](#rating).                                      |
| Guests reject intense coasters (about 4.8) | Preferred intensity (a 0-255 byte) was compared with ride intensity (hundredths) and the refusal limit was `nauseaTolerance * 2`: two different units.    | [guests/preferences.ts](../src/sim/guests/preferences.ts) puts both on the ride scale. A guest refuses a ride above its preferred intensity plus 1.50 and thinks "too intense"; nausea has its own limit and thought. |
| Everyone rides the single best ride        | `queueLength` counted only the guests at the head of the queue, so a 20-guest line cost the same as an empty one.                                         | The guest system derives whole-line counts every tick ([guests/ride-lines.ts](../src/sim/guests/ride-lines.ts)); the score charges 1.00 per guest in line, and the UI reads the whole line.                           |
| Queue capacity is not enforced             | Nothing compared the line with the queue's tile count.                                                                                                    | A line holds `(queue tiles + 1) x 4` guests (`rideQueueCapacity`). Rides with a full line score as unavailable ("queue too long"), and a guest that arrives at a full line is turned away.                            |
| Stalls serve unlimited guests concurrently | Every arrival went straight to `Shopping`.                                                                                                                | A stall serves `capacity` guests at a time; the rest wait at the entrance (`Waiting`) and give up after the queue patience. Service times are longer (below).                                                         |
| Information kiosk is never visited         | Only an impulse purchase by a guest who happened to stand next to it existed; nothing sent guests there, and the generic stall path would have sold food. | A wet guest without an umbrella walks to the nearest kiosk and buys one there; arriving guests who already own one skip it.                                                                                           |
| Arrivals capped too low                    | Hard cap of `200 + 50 x rides`.                                                                                                                           | A soft cap: arrival chance falls linearly to zero as the crowd reaches what the open attractions and stalls support (below), and never exceeds guest-slot capacity.                                                   |

Related retunes found while tuning: guests' needs now age every 8th update (was 4th) so a hunger/thirst cycle outlasts a ride and its queue; ride happiness grows with the ride's excitement; guests drop trash at one in 48 litter checks (was one in 8, enough to push litter past the penalty cap in any park).

## Constants

### Rating

`rating = 1150 + guests/13 - 150 - penalties`, clamped to 0-999 (unchanged base and guest term). Penalties:

| Term               | Value                                         |
| ------------------ | --------------------------------------------- |
| Average excitement | `min(50, abs(avg - 3.68) / 4 hundredths)`     |
| Average intensity  | `min(50, abs(avg - 5.20) / 4 hundredths)`     |
| Total excitement   | `100 - 100 x total / 80.00`, floored at 0     |
| Total intensity    | same                                          |
| Unhappy guests     | `(unhappy% - 50) x 10`, up to 500 (unchanged) |
| Lost guests        | 7 each beyond 25 (unchanged)                  |
| Ride downtime      | `2 x %`, up to 200 (unchanged)                |
| Litter             | 4 each, up to 600 (unchanged)                 |
| Casualties         | 100 each, up to 1000 (unchanged)              |

Averages and totals cover open attractions (rides, not stalls). With no open attraction both proximity terms are at their caps.

Effect: before, only penalties could move the rating off the clamp, so a clean park sat at 999; now the same scripted park sits near 700 and climbing toward 900 needs about a dozen varied attractions _and_ a clean, happy park.

### Guests

| Constant            | Value                                                                                 | Meaning                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preferred intensity | `1.50 + 0.03 x byte` (2.9 - 8.2)                                                      | Where the ride-score intensity gap is measured from.                                                                                                             |
| Intensity ceiling   | preferred + 1.50                                                                      | A ride above it is refused. Ceilings run 4.44 - 9.69: a 4.8 coaster is refused by about 8% of guests, an 8.0 ride by about 68%, anything above 9.69 by everyone. |
| Nausea limit        | `3.00 + 0.04 x tolerance byte`                                                        | Compared with `ride nausea + 0.04 x the guest's nausea byte`.                                                                                                    |
| Score               | `4 x excitement - 2 x intensity gap - 3 x nausea - price - 100 x line - rain + taste` | Hundredths for ratings, cents for price.                                                                                                                         |
| Rain penalty        | 12.00 (score units)                                                                   | A thrill or coaster without an umbrella.                                                                                                                         |
| Taste               | +-2.00, per guest, ride and 2,048-tick epoch                                          | Deterministic hash; spreads guests across similar rides without any stored state.                                                                                |
| Arrival interval    | 40 ticks                                                                              | One arrival roll per interval.                                                                                                                                   |
| Arrival chance      | `(rating - fee penalty) x campaign x (1 - guests / comfortable)` per mille            | `comfortable = 30 + 40 x open attractions + 8 x open stalls`.                                                                                                    |
| Need aging          | every 8th guest update (128 ticks)                                                    | Hunger/thirst/toilet +1; energy -1 while walking or queuing.                                                                                                     |
| Ride happiness      | `8 + excitement / 40`                                                                 |                                                                                                                                                                  |
| Stall line limit    | 8 guests                                                                              | Guests look for another stall past this.                                                                                                                         |
| Trash               | one in 48 checks per guest                                                            | A check is every 160 ticks.                                                                                                                                      |

### Stalls

| Stall             | Service time | Concurrent guests |
| ----------------- | ------------ | ----------------- |
| Food stall        | 60 ticks     | 1                 |
| Drink stall       | 50 ticks     | 1                 |
| Information kiosk | 40 ticks     | 1                 |
| Toilets           | 100 ticks    | 2                 |

One food stall keeps up with about 60 guests at the current need rate; the scripted park adds stalls as it grows, as a player would.

## Results

Starter scenario, one year, scenario seed. "Before" is the pre-change code (main at 69d174e) driven by the same scripted modest park; "after" is this change on top of main at a4c3f69, which also brings rain-driven unhappiness and vandalism.

| Metric                                                         | Before                          | After (modest)        |
| -------------------------------------------------------------- | ------------------------------- | --------------------- |
| Guests at month ends                                           | 53 - 70                         | 88 - 159              |
| Arrivals per month                                             | 138 - 163                       | 128 - 163             |
| Park rating at month ends                                      | 514 - 836 (litter-driven noise) | 649 - 729             |
| Merry-go-round / swinging ship / twist / coaster guests served | 0 / 0 / 0 / 0                   | 780 / 470 / 383 / 248 |
| Ferris wheel guests served                                     | 1,415                           | 959                   |
| Food / drink / toilets served (first stall of each)            | 1,025 / 1,076 / 1,110           | 1,396 / 1,451 / 1,449 |
| Information kiosk served                                       | 0                               | 806                   |
| "Too intense" thoughts (summed over month-end samples)         | 0                               | 151                   |
| Cash at year end                                               | $38,316                         | $38,458               |

Whole-run ledger, modest build (dollars): construction -11,162, ride running -2,398, landscaping -1,220, admission +3,138, shop sales +653, food and drink +4,167 (stock -1,667), wages -1,717, interest -1,750. The park roughly breaks even; income is dominated by food and drink, then the gate.

Year-end crowd and rating by profile at the scenario seed: minimal 70 guests and 226 rating (no staff, so litter and unhappy guests dominate), modest 159 and 714, ambitious 152 and 789.

## Starter objective

Was 50 guests and rating 900 in year one. 50 guests is reached by even the minimal park, and 900 was unreachable once the rating became honest: the ambitious build (fifteen attractions, twelve stalls, $23,000 of rides) peaks around 850 and ends near 800 because the rating floats with litter, rain and breakdowns. It is now **100 guests and rating 730**. Twelve seeds per profile (11 - 16 and 21 - 26), scored at the year-end check:

| Profile   | Guests    | Rating    | Wins    |
| --------- | --------- | --------- | ------- |
| minimal   | 46 - 71   | 156 - 309 | 0 / 12  |
| modest    | 116 - 153 | 668 - 752 | 3 / 12  |
| ambitious | 156 - 178 | 728 - 858 | 11 / 12 |

So a player who builds the full set of stalls and staff but few attractions can still scrape it, and one who keeps adding attractions nearly always wins. Year-end ratings move about 40 points between seeds, which is why the target sits between the profiles rather than at the ambitious floor.

## Known gaps

- Rides far from the gate are seldom visited: guest navigation searches a limited number of path junctions, so a long straight spine with many branches loses guests beyond the sixth or so. This is pathfinding behaviour, not choice scoring.
- Guests do not remember rides they have taken; variety comes from the per-epoch taste swing and from lines.
- Stall demand is not weather-sensitive beyond the kiosk (economy.md describes hot/cold item values).
- Ride prices and the admission fee are not tuned; the scripted park keeps the scenario's admission price and free rides.
- Awards, research-driven novelty and the casualties term are not modelled, so the 1,150 base is reachable only by leaving out penalties no current system produces.
- Constants follow community descriptions but were tuned against this harness, not against the original game.

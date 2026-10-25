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

| Problem                                                                                                              | Cause                                                                                                                                                     | Fix                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Park rating saturates at 999                                                                                         | The excitement/intensity terms of the community formula were never implemented, so only penalties could pull the rating off the 1,000 plateau.            | `computeParkRating` adds the average-proximity terms (ideal 3.68 / 5.20, up to 50 each) and the variety terms (up to 100 each, gone at a total of 80.00). See [Rating](#rating).                                                                                                                  |
| Guests reject intense coasters (about 4.8)                                                                           | Preferred intensity (a 0-255 byte) was compared with ride intensity (hundredths) and the refusal limit was `nauseaTolerance * 2`: two different units.    | [guests/preferences.ts](../src/sim/guests/preferences.ts) puts both on the ride scale. A guest refuses a ride above its preferred intensity plus 1.50 and thinks "too intense"; nausea has its own limit and thought.                                                                             |
| Everyone rides the single best ride                                                                                  | `queueLength` counted only the guests at the head of the queue, so a 20-guest line cost the same as an empty one.                                         | The guest system derives whole-line counts every tick ([guests/ride-lines.ts](../src/sim/guests/ride-lines.ts)); the score charges 1.00 per guest in line, and the UI reads the whole line.                                                                                                       |
| Queue capacity is not enforced                                                                                       | Nothing compared the line with the queue's tile count.                                                                                                    | A line holds `(queue tiles + 1) x 4` guests (`rideQueueCapacity`). Rides with a full line score as unavailable ("queue too long"), and a guest that arrives at a full line is turned away.                                                                                                        |
| Stalls serve unlimited guests concurrently                                                                           | Every arrival went straight to `Shopping`.                                                                                                                | A stall serves `capacity` guests at a time; the rest wait at the entrance (`Waiting`) and give up after the queue patience. Service times are longer (below).                                                                                                                                     |
| Information kiosk is never visited                                                                                   | Only an impulse purchase by a guest who happened to stand next to it existed; nothing sent guests there, and the generic stall path would have sold food. | A wet guest without an umbrella walks to the nearest kiosk and buys one there; arriving guests who already own one skip it.                                                                                                                                                                       |
| Arrivals capped too low                                                                                              | Hard cap of `200 + 50 x rides`.                                                                                                                           | A soft cap: arrival chance falls linearly to zero as the crowd reaches what the open attractions and stalls support (below), and never exceeds guest-slot capacity.                                                                                                                               |
| Far rides starve (the wooden coaster, a 35-tile walk from the gate, served a quarter of the merry-go-round's guests) | The old 220-255 spawn energy and 32-tick walk drain made guests run out of energy en route; earlier pathfinding work separately changed route selection.  | Current guest cadence is one need update every 128 ticks, and guests spawn with 65-128 energy. On the combined navigation/ride baseline, the current starter run served 408 coaster guests and 819 merry-go-round guests. See [guest fidelity](fidelity/guests.md) and the current balance below. |
| Guests who cannot find a target never knew it                                                                        | The lost branch never ran, and a leaving guest with no route to the gate was despawned silently.                                                          | Lost state, park maps and visible leaving guests ([guests docs](../src/sim/guests/docs.md)).                                                                                                                                                                                                      |

Related guest changes: needs decay every 128 world ticks and happiness motives run every 512 ticks, matching the audited cadence; ride happiness grows with ride excitement; guests drop trash at one in 48 litter checks (was one in 8, enough to push litter past the penalty cap in any park).

## Constants

### Rating

`rating = base + guests/13 - 150 - penalties`, clamped to 0-999 (guest term unchanged). `base` is 1,150, or 1,050 when the scenario sets `difficultRating`. Penalties:

| Term               | Value                                                                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Average excitement | `min(50, abs(avg - 3.68) / 4 hundredths)`                                                                                                                                                             |
| Average intensity  | `min(50, abs(avg - 5.20) / 4 hundredths)`                                                                                                                                                             |
| Total excitement   | `100 - 100 x total / 80.00`, floored at 0                                                                                                                                                             |
| Total intensity    | same                                                                                                                                                                                                  |
| Unhappy guests     | `500 - 2 x min(250, 3 x happy%)`: 500 with no happy guest, 200 at 50% happy, none from about 84% happy (an empty park has none). Replaces `(unhappy% - 50) x 10`.                                     |
| Lost guests        | 7 each beyond 25 (unchanged)                                                                                                                                                                          |
| Ride downtime      | `2 x %`, up to 200 (unchanged)                                                                                                                                                                        |
| Litter             | 4 each, up to 600 (unchanged)                                                                                                                                                                         |
| Casualties         | Legacy `casualties`: 100 each. Drownings add 25 to their pool; fatal ride crashes add 200 to theirs. Each typed pool independently retains 90% monthly; combined casualty penalty is capped at 1,000. |

Averages and totals cover open attractions (rides, not stalls). With no open attraction both proximity terms are at their caps.

Effect of the happiness term: the old term forgave everything until half the guests were unhappy, the rating-formula guide's term starts charging as soon as guests are below 84% happy. Mid-game happiness swings, so the scripted park's rating moves by hundreds of points between samples (see [Starter objective](#starter-objective)).

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
| Need aging          | every 128 ticks                                                                       | Hunger/thirst satiation -1; toilet +1 (or +2 at low thirst); energy -1 while wandering or queuing.                                                               |
| Happiness motives   | every 512 ticks                                                                       | -2 at energy ≤50, -1 at hunger or thirst satiation <10, and -1 at toilet ≥195, summed and floored at zero.                                                       |
| Spawn energy        | 65-128                                                                                | Uniform integer range from the audited guest spawn rule.                                                                                                         |
| Nausea tolerance    | four buckets                                                                          | A 0-7 roll maps to none, low, average or high.                                                                                                                   |
| Queue balk          | after 4,300 ticks, 3.3% per 128-tick check                                            | Thrill-ride queue only, when happiness is 65 or lower.                                                                                                           |
| Repeat ride         | last-ride gate                                                                        | Requires the audited ride, happiness, energy, nausea, hunger/thirst and toilet checks plus a random roll.                                                        |
| Ride happiness      | `8 + excitement / 40`                                                                 |                                                                                                                                                                  |
| Stall line limit    | 8 guests                                                                              | Guests look for another stall past this.                                                                                                                         |
| Trash               | one in 48 checks per guest                                                            | A check is every 160 ticks.                                                                                                                                      |

### Navigation

| Constant        | Value                  | Meaning                                                                                                       |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| Junction budget | 16 cost units          | A junction costs 1, or 2 after a stretch with no choice. A park map adds 16.                                  |
| Distance score  | 2 x smaller axis gap   | Compared first; the larger gap is a secondary tie-break.                                                      |
| Lost after      | 12 blind choices       | Junction choices where the pathfinder could not see the target and the guest got no closer. A map doubles it. |
| Lost wander     | 2,400 ticks            | No ride or stall is chosen; a guest without a map seeks the nearest visible information kiosk.                |
| Park map        | 0.60                   | Bought by a lost guest at an information kiosk, in place of an umbrella.                                      |
| Exit not found  | -30 happiness / 11,520 | A leaving guest with no route to the gate stays, wanders and thinks "I'm lost!" (O-44).                       |
| Walking energy  | -1 per need step       | Need steps are 128 ticks; only wandering and queuing guests lose energy this way.                             |

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

### Far rides: guest navigation change

Modest profile, one year, mean guests served per ride over six seeds (11 - 16); "before" is main at 03c3495. The 'pathfinder only' column is this change without the walking-energy retune.

| Ride (average walk to it, tiles)   | Before | Pathfinder only | After |
| ---------------------------------- | ------ | --------------- | ----- |
| Merry-go-round (10)                | 784    | 780             | 905   |
| Ferris wheel (10)                  | 956    | 956             | 1,067 |
| Swinging ship (16)                 | 623    | 786             | 981   |
| Twist (16)                         | 460    | 525             | 662   |
| Wooden coaster (35, opens month 3) | 219    | 261             | 362   |

At the scenario seed the coaster goes 216 to 378, the ship 623 to 973 and the twist 468 to 649. Year-end crowd over the six seeds goes 148 to 198 and the rating 724 to 733; over the twelve objective seeds the modest build now wins 4 of 12 (was 6 of 12 on main, the table below predates that) with 185 - 206 guests and ratings 622 - 750 (was 135 - 158 and 675 - 755). The bigger crowd litters and sours faster than the fixed handyman crew copes with; the objective was not retuned.

## Ride maintenance

Rides now wear and fail on a clock rather than per completed cycle ([fidelity/rides.md](fidelity/rides.md), constants in [DECISIONS.md](DECISIONS.md)). `pnpm balance` prints each ride's reliability, breakdown count and downtime ticks.

Starter scenario, modest build, scenario seed, one year. "Before" is main at 339fecc, "after" is this change on top of it.

| Metric                                      | Before                      | After                                |
| ------------------------------------------- | --------------------------- | ------------------------------------ |
| Guests at month ends                        | 86 - 157                    | 98 - 165                             |
| Park rating at month ends                   | 723 - 763                   | 707 - 771                            |
| Year-end objective (100 guests, rating 730) | 157 guests, rating 760, won | 141 guests, rating 738, won          |
| Cash at year end                            | $38,560                     | $39,019                              |
| Shop sales (toilets now charge $0.20)       | $766                        | $1,146                               |
| Ride reliability at year end                | not modelled (all at 100%)  | 86 - 93% for rides, 100% for stalls  |
| Breakdowns in the year                      | 0                           | 1 (wooden coaster, 2,895 ticks down) |

Starter objective across twelve seeds (11 - 16 and 21 - 26), year-end check:

| Profile   | Wins before | Wins after |
| --------- | ----------- | ---------- |
| modest    | 6 / 12      | 7 / 12     |
| ambitious | 12 / 12     | 12 / 12    |

Both are within seed-to-seed noise: replacing the cycle-count wear changes how many random numbers each year draws, which reshuffles the guest dynamics. A broken ride in the last month costs rating directly (twice the downtime percentage) and a modest-profile seed that ends with its merry-go-round down scores about 570; a single mechanic can take 2,000 ticks to reach a ride, so the modest profile's one mechanic is the weak point. This independent PR result predates the combined guest-navigation and ride-fidelity balance sweep below.

## Starter objective

Historical pre-stack calibration: **100 guests and rating 650** in year one (it was 730 before the economy fidelity pass). Was 50 guests and rating 900 in year one. 50 guests is reached by even the minimal park, and 900 was unreachable once the rating became honest: the ambitious build (fifteen attractions, twelve stalls, $23,000 of rides) peaks around 850 and ends near 800 because the rating floats with litter, rain and breakdowns. It was **100 guests and rating 730**, which the difficulty-pass rating term (see [Rating](#rating)) made unreachable for most modest builds. Twelve seeds per profile (11 - 16 and 21 - 26), scored at the year-end check, on this tree:

| Profile   | Guests    | Rating    | Wins    |
| --------- | --------- | --------- | ------- |
| minimal   | 26 - 77   | 157 - 327 | 0 / 12  |
| modest    | 133 - 153 | 623 - 758 | 5 / 12  |
| ambitious | 152 - 180 | 699 - 829 | 10 / 12 |

So a player who builds the full set of stalls and staff but few attractions can still scrape it, and one who keeps adding attractions nearly always wins. Year-end ratings move about 40 points between seeds, which is why the target sits between the profiles rather than at the ambitious floor.

Difficulty-pass rating (happiness term above), same seeds, same tree, wins out of 12 at each target:

| Profile   | Guests    | Rating (min - max) | Wins @ 730 | Wins @ 670 | Wins @ 650 |
| --------- | --------- | ------------------ | ---------- | ---------- | ---------- |
| minimal   | 27 - 67   | 0 - 364            | 0 / 12     | 0 / 12     | 0 / 12     |
| modest    | 134 - 153 | 598 - 762          | 2 / 12     | 9 / 12     | 10 / 12    |
| ambitious | 137 - 169 | 662 - 759          | 3 / 12     | 9 / 12     | 12 / 12    |

Before this pass (main, same seeds): minimal 26 - 77 guests and 157 - 327 rating; modest 134 - 158 and 675 - 755 (6 / 12 at 730, 12 / 12 at 650); ambitious 159 - 183 and 738 - 840 (12 / 12 at 730). The happiness term punishes the unhappiness every build shares, so the rating separates the profiles less. 650 keeps both attraction-heavy builds winning at least 10 of 12 seeds; 670 is the highest target that keeps both at 9 of 12.

**Default seed:** before guest-needs fidelity, the combined navigation and ride model ended seed 2026 at rating 636 and cleared 575. With audited guest needs and spawn distributions, the corrected satiation-scale model ended at rating 644 and cleared 575 by 69 points. The final deferred-economy implementation ends at rating 554 against its recalibrated 450 target. These are individual scripted builds, not multi-seed difficulty claims.
**PR #33 baseline:** the scenario's own seed (2026) with the scripted modest build ended year one at rating 653, three points above the then-current 650 target. The guest-needs update subsequently set the starter target to 550; the deferred economy pass below is compared with that current main baseline.

## Results: deferred economy pass

Starter scenario, one year (131,072 ticks), scripted modest build, default seed (2026), `pnpm balance` on the deferred economy branch rebased on main at `e93c5bd`:

| Metric                         |      Before (main `e93c5bd`) | After (deferred economy pass) |
| ------------------------------ | ---------------------------: | ----------------------------: |
| Guests at objective check      |                          288 |                           290 |
| Park rating at objective check |                          570 |                           554 |
| Objective                      | Won (100 guests, rating 550) |  Won (100 guests, rating 450) |
| Cash at year end               |              not in baseline |                       $35,164 |
| Park value at year end         |              not in baseline |                        $4,803 |
| Rides                          |              not in baseline |                            14 |

The compared runs use the same default seed and modest scripted build on main and after the economy change. The final food-award correction increases natural arrivals enough to lower the year-end rating from the earlier pre-review result of 628 to 554. At the prior 550 target the corrected build still wins the default seed, but only 7 of 12 calibration seeds win, so the starter target is recalibrated to 450. The older PR #33 figures above belong to a different target and simulation baseline. Exact award predicates and park-value type bonus remain compatibility assumptions (see [DECISIONS.md](DECISIONS.md)).

On the established 12-seed calibration set (11–16, 21–26), the corrected food-award behavior produced ratings from 386 to 688, and every seed exceeded the 100-guest target. At 550, 7 of 12 seeds won; at the current 450 target, 10 of 12 win, with seeds 22 and 26 missing on rating (412 and 386). The default scenario seed wins with 554 rating. This leaves a few deterministic seeds below target while keeping the default and most calibration seeds winnable.

## Results: economy fidelity pass

Starter scenario, one year, default seed (2026), scripted modest build, `pnpm balance`, both on main at 339fecc:

| Metric                                | Before (main)           | After                  |
| ------------------------------------- | ----------------------- | ---------------------- |
| Guests at month ends                  | 86 - 157                | 130 - 153              |
| Park rating at month ends             | 723 - 763               | 415 - 742              |
| Rating range after month 1            | 647 - 790               | 439 - 772              |
| Year-end rating / objective           | 760 / Won (target 730)  | 653 / Won (target 650) |
| Cash at year end                      | $38,560                 | $38,385                |
| Ledger: interest, wages, construction | -1,750, -1,717, -11,162 | unchanged              |

The ledger is unchanged by design: monthly research funding equals the old weekly charge times four, and the scripted park runs no research or campaign. The moves come from the rating's happiness term and the starter target.

## Coaster fidelity on the combined tree (PR #32)

Rebased on main at `f0c48a6` (PR #36, save v11), so this includes guest navigation, ride reliability and the coaster fidelity changes (crash defaults, turn/helix/shelter/scenery terms, multiplicative base ratings, requirements). Twelve seeds per profile (11 - 16 and 21 - 26), `pnpm balance --profile P --seed N`, scored against the scenario's 575-rating target:

| Build (wins / 12) | main `f0c48a6` | this PR |
| ----------------- | -------------- | ------- |
| minimal           | 0              | 0       |
| modest            | 12             | 10      |
| ambitious         | 2              | 3       |

Modest rating ranges: main 580 - 659, this PR 558 - 688. The starter objective stays winnable for the modest build on most seeds (10 / 12).

**Default seed (2026), scripted modest build:** main ends year one at rating 636 and wins; this PR ends at 550 and loses (189 guests, target 100). The coaster rating change moves this one run across the 575 line. The seed-sweep result above is the number to trust; the default run is a near miss in the other direction. Do not retune the target from this PR alone.

## Known gaps

- Far rides still cost a long walk: after the change the wooden coaster (a 35-tile walk, open for the last two thirds of the year) serves 362 guests against 905 for the merry-go-round next to the gate, and it is capped by what its single train carries. Energy is a placeholder until the target-based needs model lands ([fidelity/guests.md](fidelity/guests.md) F2).
- The lost trigger and the park map's effect are placeholders (O-62 has no source); lost guests are rare in the scripted park (never more than one in the month-end samples).
- Guests remember their last ride and total ride count for the repeat-ride gate; they do not keep a broader ride-history list.
- Stall demand is not weather-sensitive beyond the kiosk (economy.md describes hot/cold item values).
- Per-type wear, the age schedule, repair times and stall prices are tuned for plausibility, not measured against RCT2 (see DECISIONS.md).
- Ride prices and the admission fee are not tuned; the scripted park keeps the scenario's admission price and free rides.
- Award records, monthly announcements, guest-generation effects, per-type casualty rating terms, and recent-rider park value are implemented. There is still no drowning/fatal-crash event producer; scenario predicates also use proxies for several awards until scenery, water rides, colors, and guest-thought coverage exist.
- Marketing: the six campaigns carry their target, but targeted campaigns (free ride vouchers, selected-ride advertising, free food or drink) still give the park-wide attraction bonus. Per-target effects and voucher fulfilment belong to the guests workstream.
- Constants follow community descriptions but were tuned against this harness, not against the original game.

## Combined guest-navigation and ride-fidelity

This is the stacked PR #35 + PR #34 result rebased on main after PR #30 (`dac1786`). It includes guest navigation/lost-guest accounting, time-based ride reliability and breakdowns, and the v10→v11 save migration.

The modest scripted starter build served 682 guests over the year, peaked at 207 guests, ended at rating 636, and won the 100-guest / 575-rating objective on the scenario seed (2026). Year-end cash was $38,673. Ride service in the year: merry-go-round 884, Ferris wheel 1,064, swinging ship 981, twist 642, wooden coaster 348. The strict 5,000-guest benchmark measured p99 2.535 ms/tick against a 3 ms budget.

The prior 650 target did not hold for most seeds once the combined model counted lost guests and time-based ride downtime in rating inputs. Across the established 12 seeds (11–16 and 21–26), the modest profile reached these year-end ratings:

| Seed   | 11  | 12  | 13  | 14  | 15  | 16  | 21  | 22  | 23  | 24  | 25  | 26  |
| ------ | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Rating | 596 | 580 | 592 | 592 | 635 | 656 | 622 | 651 | 614 | 621 | 659 | 594 |

At rating 650, 3 / 12 seeds won. Before guest-needs fidelity, the 575 target won on all 12 seeds in this earlier combined-model sweep. The current guest-fidelity run uses a 550 target; its results are recorded below. This is a modest-build balance target, not a claim that every park strategy wins. Detailed harness output and the prior independent-branch results remain above for comparison.

## Guest fidelity on the combined baseline

`pnpm balance` on the current guest, navigation and ride model ran seed 2026 for 131,072 ticks. The park peaked at 292 guests, ended with 288 guests and rating 570, and wins the 100-guest / 550-rating objective by 20 points. At month ends the rating ranged from 350 to 710, so the objective checks the year-end score rather than a monthly minimum. The run served 1,032 merry-go-round guests, 1,046 Ferris wheel guests, 1,019 swinging-ship guests, 660 twist guests and 408 wooden-coaster guests.

On the established modest-build seeds 11–16 and 21–26, year-end ratings ranged from 484 to 690. The old 575 target won on 9 / 12; the revised 550 target wins on 10 / 12. The default seed previously reached 644 before the coaster-fidelity changes on main; the current 570 result includes those changes as well as this guest-fidelity work, so those single-seed values are not an isolated before/after comparison.

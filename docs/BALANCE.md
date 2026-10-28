# Balance

Tuning notes for the gameplay constants that decide how a park feels: the park rating, who arrives, which rides guests choose, and how stalls and queues behave. Numbers here are OpenCoaster tuning, calibrated with the headless harness below; where a number comes from a described public behaviour it is cited in [mechanics/economy.md](mechanics/economy.md) or [mechanics/guests.md](mechanics/guests.md).

## Harness

`pnpm balance` runs the real `Simulation` headlessly through one in-game year (131,072 ticks, about two seconds of wall time) in the starter scenario, driven only by the commands a player issues, and prints:

- a monthly table: guests, estimated arrivals (gate-admission income divided by the fee; this reads as zero when the scenario's gate price is zero), park rating, cash, park value, ride count, litter, unhappy guests (%), lost guests, ride downtime, and average happiness, hunger and thirst;
- per-ride usage: ratings, guests served, current line, cycles;
- the guest thought histogram (summed over month-end samples), the whole-run ledger, and the scenario objective outcome.

Flags: `--profile minimal|sensible|modest|ambitious` (default `modest`), `--seed N` (default: the scenario seed), `--ticks N`.

The park is scripted in [bench/balance-park.ts](../bench/balance-park.ts) on flat terrain (the generated terrain is flattened so layout does not depend on the lake): a footpath spine north from the gate with rides on both sides, each with a queue and an exit path.

| Profile   | What is built                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| minimal   | Month 0 only: merry-go-round, Ferris wheel, food and drink stall, toilets. No staff.                                                                            |
| sensible  | Month 0: the minimal services and four flat rides, with two handymen and one mechanic.                                                                          |
| modest    | Minimal plus swinging ship, twist, kiosk and a second set of stalls (month 1), a third set of stalls and a wooden coaster (month 2), 4 handymen and a mechanic. |
| ambitious | Modest plus nine more flat rides, one per fortnight from month 2.                                                                                               |

`bench/balance.test.ts` runs the modest profile for four months in CI and checks the sensible profile's early cash flow and opening roster. The modest checks cover crowd and rating ranges, ride usage, determinism, and save/load; the sensible check confirms four flat rides, basic services, two handymen and a mechanic.

## Starter economy calibration

The sensible profile is a small opening park: four flat rides, food and drink stalls, toilets, two handymen and one mechanic. It uses the starter's $50 average-cash setting, pay-per-ride mode, zero gate fee and default ride/stall prices. The six-month run uses scenario seed 2026, $50,000 starting cash and a $20,000 loan. The starter objective remains 100 guests and rating 450 by year end.

| Month                  | Main ending cash | Current ending cash | Current cash change |
| ---------------------- | ---------------: | ------------------: | ------------------: |
| Opening                |          $50,000 |             $50,000 |                   — |
| 1 (construction month) |          $42,966 |             $42,431 |             -$7,569 |
| 2                      |          $42,770 |             $42,798 |               +$367 |
| 3                      |          $42,333 |             $43,251 |               +$453 |
| 4                      |          $41,876 |             $43,686 |               +$435 |
| 5                      |          $41,461 |             $44,193 |               +$507 |
| 6                      |          $41,019 |             $44,788 |               +$595 |

The current park has positive month-to-month cash flow from month 2 onward, reaching +$435 in month 4. The matched main baseline declines after the month-one build. Both runs use the same sensible build script from this branch against the respective source trees; on main the script and its profile definition were copied into the temporary measurement snapshot so the construction plan matched exactly. Month-end finances and the detailed RCT2/OpenRCT2 source crosswalk are in [economy fidelity](fidelity/economy.md#economy-calibration-crosswalk).

The full eight-month sensible run ends with 281 guests and rating 553, winning the unchanged year-end objective of 100 guests and rating 450. No scenario objective values were changed; this sensible build now clears the starter objective comfortably, so the target is left unchanged.

The six-month modest profile, which adds more rides and increases the handyman roster from two to four, ends at $40,551 versus $44,788 for the sensible profile. Its extra construction ($4,412), running costs ($465) and wages ($700) outweigh much of its higher ticket and stall income, leaving it $4,237 behind while still solvent. Main's same modest profile ends at $36,990, so the calibrated economy improves its six-month cash by $3,561 while preserving the visible cost of expansion and over-hiring.

## Scenario and performance effects

| Check                            | Main baseline        | Economy branch       | Change                                                                                                  |
| -------------------------------- | -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| All-scenario sweep, seed 1       | 7/10 wins            | 9/10 wins            | Copper Ridge and Glacier Point miss on both; Riverside Fairground and Thunderhead Mesa improve to wins. |
| Strict 5,000-guest benchmark p99 | 3.043 ms/tick median | 2.824 ms/tick median | Branch median is 7.2% lower; both remain within 10%.                                                    |

The scenario sweep is a single-seed comparison, not a general win-rate estimate. Copper Ridge's seed-1 park does not complete its five-coaster 4.60+ objective before year end; Glacier Point does not finish its six-coaster 4.90+ race by tick 22,528. No objective was retuned. Three sequential strict runs per tree used `pnpm bench -- --guests 5000 --ticks 800 --warmup 500 --strict` on the same runtime for main at `b12a16c` and this branch. Main p99s were 3.505, 3.043 and 2.846 ms/tick; branch p99s were 2.824, 2.656 and 3.407. Median mean was 0.709 ms/tick on main and 0.710 here. Two of six total runs exceeded the 3 ms p99 threshold. The median p99 comparison is within the requested 10% bound, though p99 remains noisy on this runtime.

## What changed and why

| Problem                                                                                                              | Cause                                                                                                                                                     | Fix                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Park rating saturates at 999                                                                                         | The excitement/intensity terms of the community formula were never implemented, so only penalties could pull the rating off the 1,000 plateau.            | `computeParkRating` adds the average-proximity terms (ideal 3.68 / 5.20, up to 50 each) and the variety terms (up to 100 each, gone at a total of 80.00). See [Rating](#rating).                                                                                                                                                                                                      |
| Guests reject intense coasters (about 4.8)                                                                           | Preferred intensity (a 0-255 byte) was compared with ride intensity (hundredths) and the refusal limit was `nauseaTolerance * 2`: two different units.    | [guests/preferences.ts](../src/sim/guests/preferences.ts) puts both on the ride scale. A guest refuses a ride above its preferred intensity plus 1.50 and thinks "too intense"; nausea has its own limit and thought.                                                                                                                                                                 |
| A popular ride with an available queue stayed underfilled                                                            | Charging 1.00 score unit per guest made even a modest line erase the ride's appeal.                                                                       | The score now charges `100 x (queued + approaching) / rideQueueCapacity`, so a short line remains attractive and a nearly full line has a bounded cost. At capacity the ride is filtered and arrivals are turned away. The 1,000-guest stress test fills a 56-person committed line by tick 1,000; see [guest Noridoc](../src/sim/guests/docs.md) for state meanings and diagnostics. |
| Queue capacity is not enforced                                                                                       | Nothing compared the line with the queue's tile count.                                                                                                    | A line holds `(queue tiles + 1) x 4` guests (`rideQueueCapacity`). Rides with a full line score as unavailable ("queue too long"), and a guest that arrives at a full line is turned away.                                                                                                                                                                                            |
| Stalls serve unlimited guests concurrently                                                                           | Every arrival went straight to `Shopping`.                                                                                                                | A stall serves `capacity` guests at a time; the rest wait at the entrance (`Waiting`) and give up after the queue patience. Service times are longer (below).                                                                                                                                                                                                                         |
| Information kiosk is never visited                                                                                   | Only an impulse purchase by a guest who happened to stand next to it existed; nothing sent guests there, and the generic stall path would have sold food. | A wet guest without an umbrella walks to the nearest kiosk and buys one there; arriving guests who already own one skip it.                                                                                                                                                                                                                                                           |
| Arrivals capped too low                                                                                              | Hard cap of `200 + 50 x rides`.                                                                                                                           | A soft cap: arrival chance falls linearly to zero as the crowd reaches what the open attractions and stalls support (below), and never exceeds guest-slot capacity.                                                                                                                                                                                                                   |
| Far rides starve (the wooden coaster, a 35-tile walk from the gate, served a quarter of the merry-go-round's guests) | The old 220-255 spawn energy and 32-tick walk drain made guests run out of energy en route; earlier pathfinding work separately changed route selection.  | Current guest cadence is one need update every 128 ticks, and guests spawn with 65-128 energy. On the combined navigation/ride baseline, the current starter run served 408 coaster guests and 819 merry-go-round guests. See [guest fidelity](fidelity/guests.md) and the current balance below.                                                                                     |
| Guests who cannot find a target never knew it                                                                        | The lost branch never ran, and a leaving guest with no route to the gate was despawned silently.                                                          | Lost state, park maps and visible leaving guests ([guests docs](../src/sim/guests/docs.md)).                                                                                                                                                                                                                                                                                          |

Related guest changes: needs decay every 128 world ticks and happiness motives run every 512 ticks, matching the audited cadence; ride happiness grows with ride excitement; guests drop trash at one in 128 litter checks (calibrated from one in 48, then 96, for the rebased starter and real flat-ride footprints).

## Constants

### Rating

`rating = base + guest + happiness + lost + uptime + mix + variety + litter + casualties`, clamped to 0-999, each factor as in [economy docs](../src/sim/economy/docs.md) and shown in the Park window's rating tab. `base` is 1150, or 1050 when the scenario sets `difficultRating`. There is no OpenCoaster development bonus: the former 700/600 bases and the 80-point-per-attraction bonus were calibrations and are removed.

| Term               | Value                                                                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Average excitement | `min(50, abs(avg - 46) / 2)` with ratings in eighths of a hundredth (3.68 = 46)                                                                                                                       |
| Average intensity  | `min(50, abs(avg - 65) / 2)` (5.20 = 65)                                                                                                                                                              |
| Variety            | `(min(1000, excitement total) + min(1000, intensity total)) / 10 - 200`: 0 once both totals reach 80.00                                                                                               |
| Unhappy guests     | `500 - 2 x min(250, 300 x happy / guests)`: 500 with no happy guest, 200 at 50% happy, none from about 84% happy; an empty park takes the full 500.                                                   |
| Lost guests        | 7 each beyond 25 (unchanged)                                                                                                                                                                          |
| Ride downtime      | `2 x %`, up to 200 (unchanged)                                                                                                                                                                        |
| Litter             | 4 each, up to 600 (unchanged)                                                                                                                                                                         |
| Casualties         | Legacy `casualties`: 100 each. Drownings add 25 to their pool; fatal ride crashes add 200 to theirs. Each typed pool independently retains 90% monthly; combined casualty penalty is capped at 1,000. |

Averages and totals cover every rated ride (not stalls), open or not. With no rated ride the mix term is -100.

Effect of the happiness term: the old term forgave everything until half the guests were unhappy, the rating-formula guide's term starts charging as soon as guests are below 84% happy. Mid-game happiness swings, so the scripted park's rating moves by hundreds of points between samples (see [Starter objective](#starter-objective)).

Effect: an empty park starts at 250 (700 base − 150 guest term − 100 missing-proximity terms − 200 missing-variety terms). Opening six attractions restores 480 development points; varied ride ratings further reduce ride penalties, while happy guests and low litter avoid their existing deductions. The 1,150/1,050 values remain the community guide's reported reference, not OpenCoaster's tuned base; see [the fidelity note](fidelity/economy.md#opencoaster-starting-rating-calibration).

### Guests

| Constant            | Value                                                                    | Meaning                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preferred intensity | `1.50 + 0.03 x byte` (2.9 - 8.2)                                         | Where the ride-score intensity gap is measured from.                                                                                                                                                                                  |
| Intensity ceiling   | preferred + 1.50                                                         | A ride above it is refused. Ceilings run 4.44 - 9.69: a 4.8 coaster is refused by about 8% of guests, an 8.0 ride by about 68%, anything above 9.69 by everyone.                                                                      |
| Nausea limit        | `3.00 + 0.04 x tolerance byte`                                           | Compared with `ride nausea + 0.04 x the guest's nausea byte`.                                                                                                                                                                         |
| Score               | `4 x excitement - 2 x intensity gap - 3 x nausea - price - rain + taste` | Hundredths for ratings, cents for price. Queue length is a capacity filter rather than a score penalty.                                                                                                                               |
| Rain penalty        | 12.00 (score units)                                                      | A thrill or coaster without an umbrella.                                                                                                                                                                                              |
| Taste               | +-2.00, per guest, ride and 2,048-tick epoch                             | Deterministic hash; spreads guests across similar rides without any stored state.                                                                                                                                                     |
| Arrival chance      | `50 + clamp(rating - 200, 0, 650)` out of 65,536 per tick                | Quartered over the suggested guest maximum (sum of ride-type bonus values over open rides and stalls) and when the entrance fee exceeds ride value for money; a quarter up or down per award; campaigns add their own per-tick rolls. |
| Need aging          | every 128 ticks                                                          | Hunger/thirst satiation -1; toilet +1 (or +2 at low thirst); energy -1 while wandering or queuing.                                                                                                                                    |
| Happiness motives   | every 512 ticks                                                          | -2 at energy ≤50, -1 at hunger or thirst satiation <10, and -1 at toilet ≥195, summed and floored at zero.                                                                                                                            |
| Spawn energy        | 65-128                                                                   | Uniform integer range from the audited guest spawn rule.                                                                                                                                                                              |
| Nausea tolerance    | four buckets                                                             | A 0-7 roll maps to none, low, average or high.                                                                                                                                                                                        |
| Queue balk          | after 4,300 ticks, 3.3% per 128-tick check                               | Thrill-ride queue only, when happiness is 65 or lower.                                                                                                                                                                                |
| Repeat ride         | last-ride gate                                                           | Requires the audited ride, happiness, energy, nausea, hunger/thirst and toilet checks plus a random roll.                                                                                                                             |
| Ride happiness      | `8 + excitement / 40`                                                    |                                                                                                                                                                                                                                       |
| Stall line limit    | 8 guests                                                                 | Guests look for another stall past this.                                                                                                                                                                                              |
| Trash               | one in 128 checks per guest                                              | A check is every 160 ticks; this simplified rate is calibrated because the checked-in source evidence does not establish the original chance.                                                                                         |
| Guest wallet        | $50 scenario average setting                                             | OpenRCT2 reference offsets are -$10, $0, +$10, and +$20 around the scenario setting. See [economy fidelity](fidelity/economy.md#economy-calibration-crosswalk).                                                                       |

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

Purchase frequency varies with guest needs, weather, product availability and affordability; guests have no fixed number of purchases per visit. The scripted park adds stalls as it grows rather than assuming a fixed guest-to-stall capacity.

### Finances

| Constant          | Value                                                        | Meaning                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wages             | monthly salary / 4, every week                               | A park month is four weeks (16,384 ticks), so a handyman costs $12.50 a week. The old 12/52 conversion undercharged by 8%.                                                    |
| Research funding  | monthly figure / 4, every week                               | $25 / $50 / $100 a week at minimum / normal / maximum; a completed month still holds the full monthly amount.                                                                 |
| Loan interest     | Compatibility conversion, charged weekly                     | The RCT2 manual leaves arithmetic unspecified; the OpenRCT2 behavior reference is $61.03 a week for a $20,000 loan at 10% annual interest ($244.12 over four weekly charges). |
| Ride tickets      | refused above `max($6, 2 x ride value)`                      | Value is the age-adjusted rating value; matches the ride window's "too expensive" label.                                                                                      |
| Ride prices       | $1.00 Merry-Go-Round/Ferris Wheel/Twist; $1.50 Swinging Ship | OpenRCT2 compatibility values; starter ride prices are set from these references. See [economy fidelity](fidelity/economy.md#economy-calibration-crosswalk).                  |
| Stall prices      | Food $1.50; drink $1.20                                      | OpenRCT2 compatibility values; item values and affordability still affect purchase acceptance.                                                                                |
| Stock cost        | Food $0.50; drink $0.30 per sale                             | Descriptor item costs charged separately from sale revenue.                                                                                                                   |
| Ride upkeep       | $3.10 per fortnight for seven types                          | Merry-Go-Round, Ferris Wheel, Swinging Ship, Twist, food stall, drink stall and toilets; other types retain an unsettled local divisor fallback.                              |
| Starter admission | Pay per ride; gate price $0                                  | Ride ticket income is enabled; no gate admission is charged.                                                                                                                  |
| Low-cash warning  | cash below four weeks of recurring bills                     | Shown in the Finances window; an overdrawn park (cash below zero) cannot pay for any construction.                                                                            |

### Previous finance comparison (superseded)

The following profile matrix records an earlier tuning pass before guest cash, the starter gate price, food/drink defaults, and interest arithmetic were aligned to the OpenRCT2 behavior references. It is retained as historical context; use the current calibration above for the current economy. `pnpm balance -- --profile P [--admission DOLLARS] [--repay-loan-month N] [--stalls-at-value]` models a player who sets the gate price, prices food and drink at their value and pays the loan off. Cash at the end of each month, scripted starter park, default seed:

| Build                                        | Month 3 | Month 5 | Month 8 | Cash drift, months 4-8 |
| -------------------------------------------- | ------- | ------- | ------- | ---------------------- |
| minimal, main ($3 gate)                      | $45,704 | $45,276 | $44,655 | -$207 a month          |
| minimal                                      | $46,164 | $45,915 | $45,460 | -$146 a month          |
| modest, main ($3 gate)                       | $37,193 | $36,312 | $35,037 | -$426 a month          |
| modest                                       | $38,044 | $37,357 | $36,288 | -$358 a month          |
| modest, food and drink priced at their value | $38,044 | $37,888 | $37,662 | -$77 a month           |
| ... and the loan repaid in month 3           | $38,044 | $18,388 | $18,912 | +$172 a month          |
| ambitious, main ($3 gate)                    | $35,500 | $31,435 | $30,201 | -$845 a month          |
| ambitious                                    | $36,373 | $33,072 | $32,702 | -$516 a month          |

In that earlier comparison, a first build of five attractions cost about $3,500 of the $50,000 starting cash, and the $1,750 yearly loan interest was its largest recurring bill. Pricing stalls at their value and repaying the loan made that earlier sensible build cash-positive; that result does not apply to the current calibration above. The ambitious profile drained cash faster while adding rides, then held flatter later in the year. Guest counts and park ratings matched across the profiles in that prior comparison because only economy values changed. Raising default food and drink prices to item value was rejected in that pass because guests then ran short of cash for ride tickets and the per-ride scenarios lost win rate (Bramblewood Hollow 6/12 to 2/12).

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

The compared runs use the same default seed and modest scripted build on main and after the economy change. The final food-award correction increases natural arrivals enough to lower the year-end rating from the earlier pre-review result of 628 to 554. At the prior 550 target the corrected build still wins the default seed, but only 7 of 12 calibration seeds win, so the starter target is recalibrated to 450. The subsequent world-fidelity pass, including litter calibration, ends at rating 474 on the default seed. The older PR #33 figures above belong to a different target and simulation baseline. Exact award predicates and park-value type bonus remain compatibility assumptions (see [DECISIONS.md](DECISIONS.md)).

On the established 12-seed calibration set (11–16, 21–26), the corrected food-award behavior produced ratings from 386 to 688, and every seed exceeded the 100-guest target. At 550, 7 of 12 seeds won; at the current 450 target, 10 of 12 win, with seeds 22 and 26 missing on rating (412 and 386). The default scenario seed wins with 554 rating. This leaves a few deterministic seeds below target while keeping the default and most calibration seeds winnable.

| Seed | Guests | Rating | At 450 |
| ---: | -----: | -----: | :----- |
|   11 |    291 |    632 | Won    |
|   12 |    291 |    634 | Won    |
|   13 |    286 |    616 | Won    |
|   14 |    292 |    508 | Won    |
|   15 |    297 |    670 | Won    |
|   16 |    292 |    538 | Won    |
|   21 |    297 |    618 | Won    |
|   22 |    286 |    412 | Lost   |
|   23 |    292 |    670 | Won    |
|   24 |    291 |    452 | Won    |
|   25 |    292 |    688 | Won    |
|   26 |    293 |    386 | Lost   |

### Starter grove layout refresh

After configuring five Starter Park groves (72 trees, 24 shrubs and 16 flower beds), the modest strategy was rerun on the same twelve seeds with a 30-tile by 29-tile clear construction corridor along the entrance spine. All seeds still exceed the 100-guest objective and now clear the 450 rating target (12 / 12 wins, compared with the previously recorded 10 / 12). The default scenario seed (2026) ends at 682 rating. These results use the current landscape and current balance harness.

| Seed | Guests | Rating | At 450 |
| ---: | -----: | -----: | :----- |
|   11 |    299 |    595 | Won    |
|   12 |    292 |    734 | Won    |
|   13 |    294 |    702 | Won    |
|   14 |    289 |    642 | Won    |
|   15 |    291 |    714 | Won    |
|   16 |    297 |    626 | Won    |
|   21 |    292 |    610 | Won    |
|   22 |    293 |    650 | Won    |
|   23 |    289 |    654 | Won    |
|   24 |    298 |    622 | Won    |
|   25 |    287 |    678 | Won    |
|   26 |    295 |    654 | Won    |

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

## World fidelity pass

Default seed 2026, modest harness, one year on flattened terrain. The first world-fidelity run was recorded before rebasing onto the newer guest-navigation and ride-reliability changes. Those mainline changes materially alter the guest and rating trajectory; the current run also includes a lower simplified litter rate to keep the starter scenario winnable at its 450 rating target.

| Metric                 | First world-fidelity run | Rebased current tree |
| ---------------------- | -----------------------: | -------------------: |
| Year-end guests        |                      115 |                  290 |
| Year-end rating        |                      456 |                  474 |
| Objective              |         Won (target 450) |     Won (target 450) |
| Cash                   |                  $37,090 |              $34,406 |
| Staff wages, whole run |                   $2,360 |               $2,179 |

The intervening rebased runs before the final litter calibration ended at 261 guests, rating 208, and $34,016, then 278 guests, rating 269, and $34,320 after monthly base temperatures and scenery/cleanliness effects. The final one-in-96 litter rate brings the default run to a win. The rating target is an OpenCoaster balance decision, not a claim about original-game difficulty or a guarantee across seeds. Terrain edits, staff hiring and park layout can change the result.

## Scenario win rates

`pnpm balance -- --scenario <id|all> [--seeds 12] [--jobs N] [--trace]` plays every shipped park other than the starter with a scripted strategy ([bench/strategy](../bench/strategy)) over seeds 1 to 12 and prints the wins and each seed's final guests, rating, cash, loan and park value. The seed changes the generated terrain, trees, guest rolls and breakdowns; the apron in front of the gate is flat in every seed, so one script fits all of them. For this balance sweep, the harness unlocks the ride catalog before play so the results isolate park and economy tuning from research pacing; normal scenario commands enforce each scenario's research state. A full 12-seed run of all ten parks takes about 50 minutes on one core.

Terrain and tree layout were revised so each park's ground matches its theme and trees are placed by species (see [scenario docs](../src/sim/scenario/docs.md)). The table below is the 12-seed run after the low-start rating calibration. The balance harness unlocks rides before play so results isolate park and economy tuning from research pacing; normal scenario commands enforce research unlocks.

The scripts play a competent but imperfect player. All build gate-relative: a spine path inward from the gate with one ride or stall per row and side, a queue with bins, an exit path with bins, and coasters on reserved pads at the far end. Bins on every queue and exit path matter more than staffing: with bins only on the spine the same parks sat at 200 to 400 litter and a rating near 300, with bins everywhere litter averages under 10 and the rating stays above 700. Handymen are hired at one per two rides and stalls and mechanics at one per three attractions. Expert and Challenging scripts add per-seed hesitation (skipped build decisions and a late start), so their win rates reflect timing luck as well as terrain; Beginner scripts do not hesitate.

| Park                 | Tab         | Objective                                                           | Setup                                                  | Wins  |
| -------------------- | ----------- | ------------------------------------------------------------------- | ------------------------------------------------------ | ----- |
| Meadowbrook Green    | Beginner    | 890 guests, rating 840+, by end of year 2                           | $60k cash, $15k loan, admission $3, south gate         | 9/12  |
| Lantern Bay          | Beginner    | park value $14,000 by end of year 3                                 | $50k, $10k loan, pay per ride, sand and sea, east gate | 9/12  |
| Bramblewood Hollow   | Beginner    | $1,635 a month ride ticket income by end of year 3                  | $45k, $15k loan, pay per ride, dense trees, west gate  | 10/12 |
| Copper Ridge         | Challenging | three coasters of 4.30+ excitement before the end of year 1         | $30k, $25k loan, pay per ride, hills, south gate       | 12/12 |
| Tidewater Docks      | Challenging | repay the $6k loan and reach park value $13,200 by end of year 4    | $28k, $6k loan, pay per ride, west gate                | 9/12  |
| Thunderhead Mesa     | Expert      | 1,260 guests and rating 860+ by end of year 4                       | $30k, $30k loan, difficult rating, hot and dry         | 9/12  |
| Glacier Point        | Expert      | three coasters of 4.50+ excitement within 22,528 ticks (1.4 months) | $33k, $20k loan, pay per ride, cold, hesitant script   | 6/12  |
| Seaside Promenade    | Real        | $1,220 a month food and drink profit by end of year 3               | $40k, $20k loan, free entry and rides                  | 9/12  |
| Riverside Fairground | Real        | 1,345 guests, rating 900+, by end of year 3                         | $50k, $25k loan, admission $3, north gate              | 9/12  |
| Open Grounds         | Other       | Have Fun (no deadline)                                              | $80k, no loan                                          | 12/12 |

Notes on reading the table:

- Wins are counted at the deadline over seeds 1 to 12 with the modest scripted strategy. The thresholds were set from the RCT2 park rating, guest generation and ride rating model (see [Retune after RCT2 ratings and guest generation](#retune-after-rct2-ratings-and-guest-generation)); older sections below record earlier models and their numbers.
- Open Grounds has no in-game objective to win. The harness counts a run as healthy when, after four years, the park is solvent, rated 600 or more and holds 200 or more guests; it passes 12/12 and is a sanity check, not a difficulty target.
- Glacier Point is a race against the script's random start delay (up to three months): the six winning seeds place their coasters in time, the six losing seeds end with no qualifying coaster at the deadline.
- Copper Ridge is 12/12 because the script is deterministic about what it builds: three compact circuits rate 4.33 and two "river run" circuits rate 2.27, whatever the seed. The challenge is the 4.30 bar, not the seed. See the coaster rating note below.
- Coaster ratings are measured on the apron after a test run (see [bench/strategy/coasters.ts](../bench/strategy/coasters.ts)). With the RCT2 ride ratings the compact circuit rates 4.33, the "river run" 2.27 (about half the old figure; an unmet ride requirement, not investigated here) and the "switchback" 4.62. The `excitement` figures recorded in `coasters.ts` come from the earlier rating model and were not re-searched.

## Retune after RCT2 ratings and guest generation

The RCT2 park rating and guest generation (gap 1) and the RCT2 ride ratings plus guest intensity and nausea gates (gap 5) land together with this retune, on top of main at `6ccc758b` (multi-train circuits, front-edge ride entrances and exits). The formulas are untouched; only the scenario objectives below moved.

What the models did to the scripted parks: arrivals follow `(50 + rating above 200, at most 650) / 65536` per tick, so a high rating draws many more guests, and the suggested guest maximum grows with attractions. Year-end crowds rose 2 to 3 times and most parks now end between 860 and 999 rating. Every old objective was set for the old crowd: eight of ten scenarios were won on every seed, and Copper Ridge and Glacier Point were unwinnable because the old excitement bars were set for the old ride ratings.

Method: every scenario was swept over seeds 1 to 12 with the new tree and the old objectives (`pnpm balance -- --scenario all --seeds 12`). The strategies never read the objective, so each seed's value at the deadline (guests, rating, ride income, park value or qualifying coasters) is independent of the threshold, and each target was placed just under the 25th percentile of those twelve values, which gives 9 wins of 12. The harness was then re-run with the new objectives to confirm the counts.

| Scenario             | Objective                                 | Old       | New         | Why                                                                                                                                                                                                                                             |
| -------------------- | ----------------------------------------- | --------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Starter Park         | guests / rating at end of year 1          | 100 / 450 | 530 / 740   | Modest build now ends at 526 to 585 guests and 730 to 797 rating (was 250 - 287 and 400 - 631 on main). Targets sit under the lower quartile of the modest runs and keep the scenario seed (2026, 530 guests and rating 755 at year end) a win. |
| Meadowbrook Green    | guests / min rating by year 2             | 300 / 500 | 890 / 840   | 876 to 1,040 guests and 846 to 901 rating at the deadline (was 347 - 350 and 645 - 816).                                                                                                                                                        |
| Lantern Bay          | park value by year 3                      | $7,000    | $14,000     | Park value follows guests and rating: $13,500 to $14,800 (was $7,700 to $8,200).                                                                                                                                                                |
| Bramblewood Hollow   | monthly ride ticket income by year 3      | $750      | $1,635      | Income in the last full month is $1,542 to $1,753 (was $712 to $865).                                                                                                                                                                           |
| Copper Ridge         | coasters / min excitement by year 1       | 5 / 4.60  | 3 / 4.30    | The compact circuit rates 4.33 and the "river run" 2.27 under the RCT2 ride ratings, so the old 4.60 bar matched nothing the script can build (0/12 on both trees). Three compact circuits clear 4.30.                                          |
| Tidewater Docks      | loan repaid and park value by year 4      | $5,500    | $13,200     | Park value $12,700 to $14,400 (was $6,100 to $6,400); the loan is always repaid.                                                                                                                                                                |
| Thunderhead Mesa     | guests / min rating by year 4             | 460 / 700 | 1,260 / 860 | 1,212 to 1,400 guests and 861 to 880 rating (was 459 - 469 and 741 - 778). The rating floor moves with the difficult-rating base, keeping the expert pairing.                                                                                   |
| Glacier Point        | coasters / min excitement in 22,528 ticks | 6 / 4.90  | 3 / 4.50    | The "switchback" rates 4.62, the "river run" 2.27; the old 4.90 bar was unreachable (0/12 on both trees). Three switchbacks clear 4.50 only when the start delay leaves time, which keeps it a 6/12 race.                                       |
| Seaside Promenade    | monthly food and drink profit by year 3   | $380      | $1,220      | $1,106 to $1,427 (was $167 to $405).                                                                                                                                                                                                            |
| Riverside Fairground | guests / min rating by year 3             | 645 / 600 | 1,345 / 900 | 1,305 to 1,570 guests; the rating sits at the 999 cap, so the rating bar is set at 900 to stay meaningful.                                                                                                                                      |

Win rates, seeds 1 to 12, scripted modest strategy, year-end or deadline check. "Main" is main at `6ccc758b`; "combined" is this branch. Guests and rating are medians with the range in brackets.

| scenario             | main: wins | main: guests  | main: rating  | combined, old objective: wins | combined, retuned: wins | combined: guests | combined: rating |
| -------------------- | ---------- | ------------- | ------------- | ----------------------------- | ----------------------- | ---------------- | ---------------- |
| bramblewood-hollow   | 8/12       | 417 (407-421) | 805 (783-834) | 12/12                         | 10/12                   | 1133 (1062-1206) | 926 (909-943)    |
| copper-ridge         | 0/12       | 379 (335-408) | 817 (751-875) | 0/12                          | 12/12                   | 824 (716-842)    | 924 (899-934)    |
| glacier-point        | 0/12       | 101 (77-244)  | 511 (276-759) | 0/12                          | 6/12                    | 128 (97-186)     | 724 (688-770)    |
| lantern-bay          | 12/12      | 674 (660-683) | 912 (871-948) | 12/12                         | 9/12                    | 1323 (1260-1395) | 999 (994-999)    |
| meadowbrook          | 12/12      | 349 (347-350) | 788 (645-816) | 12/12                         | 9/12                    | 927 (876-1040)   | 880 (846-901)    |
| open-grounds         | 11/12      | 422 (212-426) | 859 (58-875)  | 12/12                         | 12/12                   | 1658 (1545-1711) | 993 (985-998)    |
| riverside-fairground | 12/12      | 703 (689-713) | 922 (873-941) | 12/12                         | 9/12                    | 1383 (1305-1570) | 999 (999-999)    |
| seaside-promenade    | 9/12       | 343 (152-347) | 694 (18-724)  | 12/12                         | 9/12                    | 1055 (973-1254)  | 869 (829-888)    |
| thunderhead-mesa     | 10/12      | 464 (459-469) | 766 (741-778) | 12/12                         | 9/12                    | 1299 (1212-1400) | 872 (861-880)    |
| tidewater-docks      | 12/12      | 555 (546-561) | 823 (752-878) | 12/12                         | 9/12                    | 1321 (1262-1439) | 954 (912-981)    |

Starter Park, scripted profiles, twelve seeds (11 - 16 and 21 - 26), year-end check, `pnpm balance --profile P --seed N`:

| Profile   | Main wins (100 guests / 450 rating) | Main guests   | Main rating   | Combined wins, old objective | Combined wins, 530 / 740 | Combined guests | Combined rating |
| --------- | ----------------------------------- | ------------- | ------------- | ---------------------------- | ------------------------ | --------------- | --------------- |
| minimal   | 0/12                                | 111 (103-117) | 0 (0-0)       | 0/12                         | 0/12                     | 156 (140-167)   | 0 (0-175)       |
| modest    | 10/12                               | 277 (250-287) | 552 (400-631) | 12/12                        | 10/12                    | 555 (526-585)   | 762 (730-797)   |
| ambitious | 12/12                               | 329 (296-338) | 687 (592-751) | 12/12                        | 1/12                     | 459 (355-597)   | 716 (630-784)   |

Findings that this retune does not fix:

- The ambitious Starter build wins 1/12 at 530 / 740 even though it builds more. In every ambitious run a Ferris wheel, and often a ship and the wooden coaster, stays broken for tens of thousands of ticks and is never repaired; main shows the same (the second Ferris wheel is down for 86,833 ticks in `pnpm balance --profile ambitious --seed 2026`). The targets follow the modest profile, which is the harness default; the unrepaired breakdowns are a separate mechanic-routing problem.
- `bench/rating-trajectory.test.ts` bounds relaxed from 1.15 to 1.4 times the suggested maximum and from 120 to 250 rating points. #157 alone on main with front-edge entrances and exits (#167) already overshot the old bounds (445 guests against 442.75 allowed), because guests now leave more slowly once the park is over its maximum; the combined park holds 509 guests against a maximum of 385 at month six.

### Real flat-ride footprints

Flat rides now occupy their real footprints (Merry-Go-Round 3x3, Ship 1x5, Ferris wheel 1x4, Enterprise 4x4, ...), so a scripted park spans more tiles and holds fewer attractions in the same apron. With the old constants the sweep fell to Bramblewood Hollow 0/12, Lantern Bay 0/12, Riverside Fairground 0/12, Thunderhead Mesa 0/12 and Tidewater Docks 0/12. Causes found with traces: parks twice as long keep the handymen sweeping spine litter, so bins stop being emptied and litter pins the rating; and the 30-row apron only fits 17 rides, where the park value and guest objectives assumed 28. Retunes:

- Trash drop rate 1 in 96 to 1 in 128 per litter check (still a calibrated simplification).
- Scripted handymen: one per ride or stall (Tidewater Docks and Thunderhead Mesa one per 1.5), was one per two.
- Build aprons widened where the script ran out of rows: Lantern Bay 50 rows (owned margin 16%), Riverside Fairground 54 (16%), Tidewater Docks 50 (16%), Thunderhead Mesa 60 (16%).
- Starter objective, twelve seeds (11 - 16, 21 - 26), year-end check: modest 12/12, ambitious 11/12.

Scenario sweep after the retune (`pnpm balance -- --scenario all --seeds 12`): the table above. Bramblewood Hollow 11/12 (one miss), Riverside Fairground 12/12 (was 5/12, the wider apron now fits 31 rides), Thunderhead Mesa 7/12 and Glacier Point 6/12 stay inside the Expert band.

## Known gaps

- Far rides still cost a long walk: after the change the wooden coaster (a 35-tile walk, open for the last two thirds of the year) serves 362 guests against 905 for the merry-go-round next to the gate, and it is capped by what its single train carries. Energy is a placeholder until the target-based needs model lands ([fidelity/guests.md](fidelity/guests.md) F2).
- The lost trigger and the park map's effect are placeholders (O-62 has no source); lost guests are rare in the scripted park (never more than one in the month-end samples).
- Guests remember their last ride and total ride count for the repeat-ride gate; they do not keep a broader ride-history list.
- Stall demand is not weather-sensitive beyond the kiosk (economy.md describes hot/cold item values).
- Per-type wear, the age schedule, and repair times are tuned for plausibility rather than measured against RCT2 (see DECISIONS.md). Starter ride and food/drink prices use selected OpenRCT2 compatibility references; other stall prices are not comprehensively calibrated.
- The starter's pay-per-ride mode uses the default flat-ride ticket prices; gate admission is $0.
- Award records, monthly announcements, guest-generation effects, per-type casualty rating terms, and recent-rider park value are implemented. There is still no drowning/fatal-crash event producer; scenario predicates also use proxies for several awards until scenery, water rides, colors, and guest-thought coverage exist.
- Marketing: the six campaigns carry their target, but targeted campaigns (free ride vouchers, selected-ride advertising, free food or drink) still give the park-wide attraction bonus. Vouchers are honoured at the gate, rides and stalls (see docs/fidelity/economy.md).
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

## Gap #4: RCT2 breakdowns, reliability, inspection and downtime

Scenario win counts from `pnpm balance -- --scenario all --jobs 3` (12 seeds each, scripted strategies, no scenario retuned), main at `152c6df` (#160) against this change:

| scenario             | tab         | before | after |
| -------------------- | ----------- | ------ | ----- |
| bramblewood-hollow   | beginner    | 6/12   | 7/12  |
| copper-ridge         | challenging | 0/12   | 0/12  |
| glacier-point        | expert      | 0/12   | 0/12  |
| lantern-bay          | beginner    | 12/12  | 12/12 |
| meadowbrook          | beginner    | 12/12  | 12/12 |
| open-grounds         | other       | 11/12  | 11/12 |
| riverside-fairground | real        | 12/12  | 12/12 |
| seaside-promenade    | real        | 9/12   | 9/12  |
| thunderhead-mesa     | expert      | 6/12   | 8/12  |
| tidewater-docks      | challenging | 12/12  | 12/12 |

Two scenarios gain wins (bramblewood-hollow +1, thunderhead-mesa +2); none lose. The strategies keep every ride open and a mechanic hired, so the repair reliability gain and the end of wear on closed rides outweigh the higher per-type unreliability factors. The 5,000-guest bench (`pnpm bench -- --guests 5000 --ticks 200`, three runs each, quiet machine) is unchanged: mean 0.49-0.50 ms/tick on main against 0.49-0.54 ms on this branch, p99 1.21 ms against 1.20-1.33 ms.

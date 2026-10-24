# RCT2 Ride Fidelity: Ratings, Operations, Maintenance, and Value

**Status:** behavioral reference for clean-room implementation. This document describes publicly supported behavior and distinguishes direct RCT2 manual evidence from community analysis and OpenRCT2 source-level reconstruction. No original game files, assets, decompiled code, or copied source are used here. The OpenRCT2 repository is cited only as a behavioral cross-check; it is not treated as proof that every detail matches vanilla RCT2.

**Scope:** flat and gentle rides, thrill rides, ride operations, maintenance and breakdowns, ride ticket value, and shops/stalls. Water, transport, and coaster track construction are included only where they share these systems.

## Evidence and confidence

| Mark | Meaning |
|---|---|
| Manual | The original RCT2 manual describes the player-visible behavior directly. |
| Reported | A public guide or technical write-up reports the rule or number; reproduction/version caveats apply. |
| Port reference | The cited OpenRCT2 revision implements or preserves a detail, sometimes with legacy RCT2 annotations. It is useful evidence, but not an independent vanilla-game measurement. |
| Open | Available material does not establish an exact RCT2 rule. Do not fill the gap with a plausible constant. |

The RCT2 manual establishes that the ride window exposes test/open/close, ride statistics, ride-specific mechanical settings, reliability, downtime, inspection frequency, and (in pay-per-ride scenarios) ticket price. It does not publish the rating coefficients, reliability equation, or complete ride-by-ride mode matrix. **Manual:** [RCT2 manual, ride construction and ride window (PDF pages 34–41)](https://rct2.rctspace.com/rct2_manual.pdf#page=18).

## Ratings

### What a player sees

Rides that require testing are tested before opening; testing produces ratings and ride statistics. Flat rides are pre-designed and their ratings are primarily ride-type data plus mode-specific adjustments. Tracked rides add test-derived characteristics. The displayed ratings are **excitement, intensity, and nausea**. Excitement is desirable, intensity constrains which guests will ride, and nausea predicts queasiness. Rating values are not ride prices and are not the same thing as guest satisfaction. The manual lists statistics including average speed, ride time and length, positive and negative vertical G, airtime, and inversions. **Manual:** [RCT2 manual, ride statistics and test/open controls](https://rct2.rctspace.com/rct2_manual.pdf#page=19).

Stalls and facilities are not rated as rides. They sell or provide a particular service and use item prices, item costs, customer demand, and service rules instead. **Reported:** [OpenRCT2 shop/stall documentation](https://docs.openrct2.io/en/latest/playing/shops_and_stalls/); [RCT2 manual, Shops & Stalls](https://rctv2.rctspace.com/downloads/RCTycoon%20Manual%2008311.pdf).

### Tracked-ride shared rating terms

The following are the published, ride-independent terms before the particular ride type's multipliers and other modifiers. Ratings are in points, conventionally displayed to two decimal places. The formulas are a **reported, incomplete reconstruction**, not a complete formula for any particular coaster. Signed negative G is used in the second term; it is capped at −2.5 G for excitement. Lateral G contributes to excitement only up to 1.5 G.

| Input | Excitement contribution | Intensity contribution | Nausea contribution |
|---|---:|---:|---:|
| Maximum vertical G | 0.08 × maximum positive G | 0.8 × maximum positive G | 0.26 × maximum positive G |
| Minimum vertical G (signed) | −0.24 × clamp(minimum negative G, −2.5, 0) | 0.8 × (1 − minimum vertical G) | 0.22 × (1 − minimum vertical G) |
| Maximum lateral G | 0.4 × min(1.5, maximum lateral G) | maximum lateral G | 0.33 × maximum lateral G |
| Drops | 0.11 × min(9, drop count) + 0.0049 × highest-drop height | 0.14 × drop count + 0.0098 × highest-drop height | 0.10 × drop count + 0.0016 × highest-drop height |
| Inversions | 0.27 × min(6, inversion count) | 0.50 × inversion count | 0.22 × inversion count |

The highest-drop height uses the game's rating measurement units; these equations must not be applied to OpenCoaster world units without a verified conversion. More than nine drops continue to increase intensity and nausea but not the drop-count portion of excitement; more than six inversions continue to increase intensity and nausea but not inversion excitement. **Reported:** [Ride-rating calculation write-up](https://github.com/OpenRCT2/OpenRCT2/wiki/Ride-rating-calculation).

Two lateral-G thresholds are reported: above **2.8 G**, add **3.75 intensity** and **2.00 nausea**; above **3.1 G**, halve the excitement accumulated so far and add another **8.50 intensity** and **4.00 nausea**. Excitement is then reduced by **25% for each** exceeded intensity threshold above **10.00, 11.00, 12.00, 13.20, and 14.50**. Threshold comparisons are described as “above,” so equality does not trigger a penalty. These precise constants come from the incomplete rating analysis, not the manual. **Reported:** [Ride-rating calculation write-up](https://github.com/OpenRCT2/OpenRCT2/wiki/Ride-rating-calculation).

### Other rating inputs and per-type behavior

RCT2 does not use one shared rating equation with one coefficient set for every ride. The public analysis describes ride-type-specific multipliers, minimum requirements, and additions for speed, length, train length, G forces, turns, drops, shelter, rotations, operating options, proximity, scenery, and synchronized stations. It reports that length affects excitement but not intensity or nausea; extra cars can add excitement; synchronization has a ride-type-specific excitement and intensity adjustment; and failing a ride's per-type minimums can divide all three ratings. The analysis explicitly calls itself incomplete and does not provide a fully validated matrix for every RCT2 flat, gentle, thrill, and tracked ride. **Reported / Open:** [Ride-rating calculation write-up](https://github.com/OpenRCT2/OpenRCT2/wiki/Ride-rating-calculation); [rating data and calculation cross-check at pinned OpenRCT2 revision](https://github.com/OpenRCT2/OpenRCT2/blob/47163dabbb7a13d1bf11e6c24e735c3d59201208/src/openrct2/ride/RideRatings.cpp).

Scenery is an excitement input, not an intensity or nausea input. The write-up reports a station-area scan within **5 tiles**, **0.05 raw points per scenery item**, and a cap of **47 items** (raw maximum **2.35**) before the ride-type multiplier. An underground station reportedly substitutes **0.40 raw points**. The source is uncertain about which station tile is scanned and how multi-tile scenery counts. Nearby paths, scenery, water, track, rides, station proximity, and special track interactions can add excitement; exact radii, caps, and per-type multipliers are not fully documented there. **Reported / Open:** [Ride-rating calculation write-up](https://github.com/OpenRCT2/OpenRCT2/wiki/Ride-rating-calculation); [RCT2 manual, scenery and near-collision excitement](https://rct2.rctspace.com/rct2_manual.pdf#page=14).

For flat and gentle rides, exact ratings must be authored per ride type and adjusted by the actual selectable operating option where the original does so. Examples of mode-dependent behavior include the Ferris Wheel's forward/backward rotation and ride-specific rotation counts or durations. The public material found does **not** supply a reliable, complete RCT2 base-rating and mode-adjustment table for every flat/gentle/thrill ride. The mode names or current OpenRCT2 constants alone do not close that evidence gap. **Open:** validate each target ride and mode against vanilla RCT2; do not substitute a generic duration multiplier.

The catalog target is the RCT2 ride/stall catalogue for the edition OpenCoaster chooses to support (base game versus Triple Thrill Pack must be decided when the catalogue is authored). The original manual separates transport, gentle rides, roller coasters, thrill rides, water rides, and shops/stalls. A broader secondary inventory includes many families and object variants; it must not be mistaken for a count of distinct ride types. **Manual / Reported:** [RCT2 manual, ride categories](https://rct2.rctspace.com/rct2_manual.pdf#page=17); [ride family inventory](https://rct.miraheze.org/wiki/Rides); [ride object type reference](https://openrct2-doc.readthedocs.io/en/latest/ride.html).

## Operating modes and cycle state

### Mode selection

Operating mode is a ride-specific choice, not a universal setting. Public mode documentation lists these RCT2-era modes: normal; continuous circuit; reverse-incline launched shuttle; powered launch; shuttle; boat hire; upward launch; rotating lift; station-to-station; single or unlimited ride per admission for spiral slides; maze; race; bumper-car; swing; shop/stall; rotation; forward or backward Ferris Wheel rotation; film/cinema variants; Space Rings; beginner, intense, or berserk gravitron; LIM launch; haunted house; circus show; downward launch; crooked house; freefall drop; and, in RCT2, continuous-circuit block-sectioned, powered-launch, and powered-launch block-sectioned modes. **Reported:** [RCT2 operating mode list](https://tid.rctspace.com/OperatingModes.html).

That list is not a selector matrix. Each ride type exposes only its compatible modes; individual modes can change operating settings and ratings. The original manual confirms that ride mechanical options vary by ride and include minimum and maximum waits, load target, station synchronization, lift speed, and other ride-specific controls. For dispatch options, the documented load choices are **full, 3/4, 1/2, 1/4, or any load**. A selected minimum wait is a lower bound; maximum wait forces dispatch despite an unmet load target. “Leave if another train arrives” can override the target load while respecting the minimum wait. **Manual / Reported:** [RCT2 manual, mechanics panel](https://rct2.rctspace.com/rct2_manual.pdf#page=19); [Ride Operation Options](https://rct.fandom.com/wiki/Ride_Operation_Options).

### Player-visible ride lifecycle

The documented lifecycle is **closed → test (where required) → open → operating cycle → open**, with **broken** as a maintenance state and **closed** as the player-controlled stand-down state. Testing determines whether a ride is safe/operable and generates stats; it is not the same as an ordinary passenger cycle. For a dispatched flat ride, guests load, experience the ride for its ride-specific duration, unload, and then the next dispatch may begin. Tracked rides use their track layout and vehicle behavior; modes such as shuttle, race, and block-sectioned circuit change how vehicles circulate and when a station can dispatch. Stalls serve customers at the stall and do not run a passenger queue cycle. **Manual:** [RCT2 manual, ride construction and testing](https://rct2.rctspace.com/rct2_manual.pdf#page=18); [operation options](https://rct.fandom.com/wiki/Ride_Operation_Options).

The manual establishes settings and cycle concepts but not one universal numerical cycle duration. Durations, car/train counts, launch or lift speed, and other operating parameters are ride-specific and often player-configurable. A 40 Hz tick is an OpenCoaster engine design decision; do not convert RCT2 minutes or seconds into OpenCoaster ticks until the relevant clock mapping is independently validated. **Open.**

## Reliability, inspections, and breakdowns

### Inspections and reliability

The player can choose inspection frequency **every 10, 20, 30, 45, or 60 minutes; every 2 hours; or never**. The maintenance window also shows reliability and downtime, and the player can call the mechanic nearest the ride. The manual describes reliability as a percentage measure of operation and downtime as the time spent broken. It says maintenance reduces failures; an inspection schedule is not itself an instantaneous guarantee of full reliability. **Manual:** [RCT2 manual, maintenance record and mechanic controls](https://rct2.rctspace.com/rct2_manual.pdf#page=19); [OpenRCT2 inspection interval reference](https://github.com/OpenRCT2/OpenRCT2/blob/47163dabbb7a13d1bf11e6c24e735c3d59201208/src/openrct2/ride/Ride.cpp#L133-L150).

The cited OpenRCT2 revision provides a source-level reconstruction of time-based deterioration: it checks reliability and breakdown state once per **256 global game ticks**, reduces reliability by a ride-specific unreliability amount plus an age penalty, and makes older rides lose reliability more quickly. Reliability is represented internally on a **0–25,855** scale (100% plus a fractional byte). At each check while reliability is above zero, the inclusive breakdown roll succeeds for **25,857 − current reliability** values out of **3,145,728** possible masked random values; at zero, failure is forced. This is a per-check chance, not a per-minute rate. Completing a mechanic inspection adds `floor((100 − whole-percent reliability) / 4) × randomByte` internal units, with the random byte ranging from **0 to 255**; the integer division happens first, so a one-point missing-reliability gap adds nothing. The same revision applies different age multipliers across the ride's years. These mechanics are useful evidence, but the exact vanilla tick phase and ride-specific wear data still require direct RCT2 validation before being called exact. **Port reference / Open:** [reliability and breakdown reconstruction](https://github.com/OpenRCT2/OpenRCT2/blob/47163dabbb7a13d1bf11e6c24e735c3d59201208/src/openrct2/ride/Ride.cpp#L1060-L1155); [inspection restoration behavior](https://github.com/OpenRCT2/OpenRCT2/blob/47163dabbb7a13d1bf11e6c24e735c3d59201208/src/openrct2/entity/Staff.cpp#L2560-L2645); [ride-specific rating and wear descriptors](https://github.com/OpenRCT2/OpenRCT2/tree/47163dabbb7a13d1bf11e6c24e735c3d59201208/src/openrct2/ride/rtd).

### Breakdown types and odds

The named RCT2 breakdown families are **Safety Cut-out, Restraints Stuck Closed, Restraints Stuck Open, Doors Stuck Closed, Doors Stuck Open, Vehicle Malfunction, Brakes Failure, and Control Failure**. The available set depends on ride type. Effects differ: a safety cut-out can stop powered vehicles or a train on a lift; restraint and door failures affect boarding or unloading; vehicle malfunctions can immobilize a vehicle; brakes failure can create a collision risk; and control failure affects some flat rides. Some rides do not break down. **Reported:** [Breakdown overview](https://rct.fandom.com/wiki/Breakdown); [manual maintenance tab](https://rct2.rctspace.com/rct2_manual.pdf#page=19).

No single public source found gives the original absolute breakdown probability for every ride and operating state. One source-level reconstruction shows an overall reliability-driven failure roll, then selects a reason using ride-specific weights. As one example, a Mine Train Coaster's conditional reason weights are reported as **25, 12, 10, 6, 3** for safety cut-out, restraints closed, restraints open, vehicle malfunction, and brakes failure. That makes brakes failure **3/56 (about 5.4%) of breakdown reasons** in that example, not a 5.4% per-time-unit failure chance. Rain raises the brakes-failure reason weight to **20**, making it **20/73 (about 27.4%) of reason selections**, while changing the reason mix rather than the overall breakdown roll. RCT2 source references further condition brakes failure on ride age, reliability, block-sectioning, and settings. **Reported / Port reference:** [weather and breakdown-weight example](https://outof.games/realms/rollercoastertycoon/guides/536-guide-to-climate-weather-and-temperature-in-roller-coaster-tycoon-1-2/); [reason selection and conditions](https://github.com/OpenRCT2/OpenRCT2/blob/47163dabbb7a13d1bf11e6c24e735c3d59201208/src/openrct2/ride/Ride.cpp#L1128-L1210).

### Repair, crashes, and downtime

Mechanics are dispatched to inspect or repair; a broken ride is unavailable until the required repair completes. The manual exposes the mechanic call action and a downtime record, but does not give a universal repair duration. Crashes are distinct from ordinary breakdowns: the breakdown write-up reports that some failures can cause collisions, with a reported combined speed threshold of **30 mph / 48 km/h** in particular cases. Treat that collision threshold as a community report, not a universal crash rule. RCT2 block-sectioned modes and ride layout affect whether a brake failure can cause a collision. **Manual / Reported:** [RCT2 manual maintenance controls](https://rct2.rctspace.com/rct2_manual.pdf#page=19); [Breakdown](https://rct.fandom.com/wiki/Breakdown); [Crash](https://rct.fandom.com/wiki/Crash).

## Ticket price, ride value, and stalls

### Ride ticket value

In pay-per-ride scenarios, ticket price is editable from the ride's financial tab. Ride value is derived from excitement, intensity, and nausea with ride-type-specific weights, then adjusted for age and other rides of the same type. A reverse-engineered pricing guide gives the fixed-point structure as the sum of each rating multiplied by its ride-type coefficient and divided by **32,768**, truncating fractional remainders; the resulting internal value is converted to ticket money by dividing by **10**. A second open ride of the same game-defined type reduces each same-type ride's value by **25%**. **Manual / Reported:** [RCT2 manual, financial data and ticket price](https://rct2.rctspace.com/rct2_manual.pdf#page=20); [ride price/value derivation](https://forums.openrct2.org/topic/2737-guide-how-much-can-you-charge-for-your-rides/).

The vanilla age schedule reported by the value guide and the version-history report is:

| Ride age | Value adjustment |
|---|---:|
| 0–4 months | add 30 internal value points |
| 5–12 months | add 10 internal value points |
| 13–39 months | ×1.00 |
| 40–63 months | ×0.75 |
| 64–87 months | ×0.56 |
| 88–103 months | ×0.42 |
| 104–119 months | ×0.32 |
| 120–127 months | ×0.16 |
| 128–199 months | ×0.08 |
| 200 months and older | ×0.56 |

The first two adjustments are additive, not multipliers. This is specifically noted as a vanilla/OpenRCT2 difference in earlier OpenRCT2 pricing; use the additive values when targeting RCT2. Guests are reported to call a ride “good value” at a ticket price no greater than half its value and “too expensive” when price exceeds twice its value. Willingness to pay is reported to be reduced by **75%** when guests paid for park admission. These are behavioral-guide thresholds; purchase still depends on guest funds and demand. **Reported:** [ride value and guest reaction thresholds](https://forums.openrct2.org/topic/2737-guide-how-much-can-you-charge-for-your-rides/); [vanilla age pricing correction](https://outof.games/news/8417-openrct2-v0-4-27-is-out-new-title-sequence-reverting-pricing-algorithm-to-use-vanilla-games-algorithm/).

### Shops, stalls, and facilities

Shops and stalls use **per-item** prices and stocking costs; their income is not ride-ticket value. Costs are charged against the number sold, and the player sets individual product prices. Weather and temperature affect demand and the reference price guests accept for some products; umbrellas are especially weather-sensitive. Different stall objects can sell the same product, and a park-wide price synchronization option may couple those prices. Bathrooms/facilities have their own admission fee and service behavior. **Manual / Reported:** [RCT2 Shops & Stalls manual](https://rctv2.rctspace.com/downloads/RCTycoon%20Manual%2008311.pdf); [food and drink item costs and pricing behavior](https://outof.games/realms/rollercoastertycoon/guides/541-guide-to-food-and-drink-stalls-in-roller-coaster-tycoon-1-and-2/).

The consulted public stall guide supplies item-level data but is not a verified vanilla RCT2 reference for every expansion stall. No exhaustive, original-game-validated product price/cost and weather table was found during this pass. Do not make all stalls share a generic fixed service price or classify stalls with ride-rating/value rules. **Open.**

## Current OpenCoaster behavior and fidelity gaps

The paths below are from the current repository at the time of research. “Original behavior” cells use only the confidence stated above; unresolved evidence remains marked open.

| Area | Current OpenCoaster behavior and files | RCT2 behavior supported by sources | Severity | Suggested fix |
|---|---|---|---|---|
| Catalog coverage | `src/sim/rides/ride-types.ts` defines 10 entries: four flat rides, two coasters, and four stalls/facilities. | RCT2 has broad ride and stall catalogues across gentle, thrill, water, transport, and coaster groups; the chosen base/expansion edition must be explicit. | Gameplay-visible | Build the target-version catalogue, including each ride subtype, permitted modes, maintenance profile, and stall product set. |
| Flat/gentle/thrill ratings | Flat ratings are static authored E/I/N constants in `src/sim/rides/ride-types.ts`; no mode-specific rating changes. | Ratings are type-specific, with selected operation settings and other conditions modifying results. Complete original per-ride formulas are not established in the public rating write-up. | Gameplay-visible | Capture vanilla rating observations for every flat/gentle/thrill ride and supported mode; encode per-type baselines and verified adjustments only. |
| Tracked ratings | `src/sim/vehicles/vehicle-ratings.ts` uses shared provisional terms; `src/sim/rides/coaster-system.ts` adds a type baseline. | Shared tracked inputs are followed by per-type weights, thresholds, and bonuses/penalties; the published formula explicitly remains incomplete. | Gameplay-visible | Replace provisional shared scoring after comparing controlled test rides with vanilla; preserve measurement units and rounding order. |
| Ride modes | `src/sim/rides/ride-types.ts` and `src/sim/rides/ride-store.ts` have no selectable ride-mode state. `src/sim/rides/ride-operations.ts` exposes only generic timing and load controls. | Modes and options are specific to ride type; include film, rotation, race, launch, shuttle, and RCT2 block-sectioned behavior where applicable. | Gameplay-visible | Add a ride-type-to-mode matrix, then implement and expose each mode’s own transition and settings. |
| Dispatch and timing | `src/sim/rides/ride-system.ts` dispatches on a generic load fraction or max wait, then uses authored load/run/unload ticks. | Manual confirms per-ride minimum/maximum wait, load target, and other mechanical settings; public option guide describes the five load targets and override rules. Original numeric durations vary by ride and are not one shared cycle. | Gameplay-visible | Author exact controls and timing per supported mode; validate dispatch boundaries and elapsed times against fixed vanilla scenarios. |
| Reliability decay | `src/sim/rides/ride-system.ts` loses one reliability point every 32 completed cycles. | Source-level reconstruction is time-based and affected by ride wear data and age; a failure chance is checked independently from cycle completion. Exact vanilla rates need measurement. | Gameplay-visible | Replace cycle-count wear with measured time-based deterioration, ride age, and per-type wear calibration. |
| Breakdown types and probability | `src/sim/rides/ride-system.ts` uses one generic failure chance at reliability ≤10; `src/sim/rides/ride-operations.ts` has a generic breakdown operation and no reason type. | RCT2 has ride-specific reason sets and weighted selection; weather and ride conditions affect some reason weights. No universal absolute failure rate is supported. | Gameplay-visible | Add named reasons and per-type allowed/weighted breakdowns; validate aggregate frequency and conditional reason mix separately. |
| Inspection and repair | `src/sim/rides/ride-operations.ts` offers a manual inspection hook and due check; inspection interval defaults to one hour. Manual inspection adds a flat 25 points and can immediately return a broken ride to service. Staff scheduling, travel, repair, and duration are absent. | Seven selectable intervals (10/20/30/45/60/120 minutes or never); mechanics are called, travel, inspect, and repair. A completed inspection restores a random fraction of missing reliability in the source-level reconstruction; breakdown repair is a distinct mechanic job. | Gameplay-visible | Implement selectable schedules and mechanic jobs with travel/work durations, reliability effects, and blocked ride states. |
| Downtime/crash | Current ride state has generic Broken and downtime counters; no reason-specific effects or crash model. | Maintenance UI reports downtime; some failures can stop vehicles, delay departures, or crash depending on layout, ride, and speed. | Gameplay-visible | Model each supported failure’s effect and recovery; track downtime and crash consequences distinctly. |
| Ride value and pricing | `src/sim/rides/ride-operations.ts` uses a 50–150% rating multiplier and 5% monthly depreciation to a 40% floor at 12 months; `src/ui/game-ui.ts` exposes a ride price field. | Ride value uses per-type E/I/N weights, age bands, same-type penalty, and guest willingness/park-admission adjustments. | Gameplay-visible | Implement verified vanilla value arithmetic and guest reaction thresholds; add controlled age and duplicate-type cases. |
| Stall prices | `src/sim/rides/ride-types.ts` has four stall/facility definitions; service cadence is simple. Stall goods do not use the full RCT2 catalogue. | Product prices/costs, weather-sensitive items, and service/facility rules are item-specific. | Gameplay-visible | Add target-version stalls, product selection, prices/costs, and weather/demand effects from validated item data. |
| Ride information UI | `src/ui/game-ui.ts` omits full operation settings, inspection options, downtime, capacity, and price/value reaction. | Original ride window exposes mechanics, maintenance, financial, and guest-data views; panels differ by ride type. | Gameplay-visible | Provide ride-specific operation and maintenance controls/readouts, including current mode and failure state. |
| Numeric/refresh details | Current stats are stored as authored integer hundredths; `src/sim/vehicles/vehicle-ratings.ts` clamps ratings to 0–65,535. | Manual displays tested stats; public write-up does not settle original refresh timing, all rounding rules, or every maximum. | Subtle | Record vanilla rounding, caps, rating refresh points, and stat invalidation separately from display formatting. |

## Prioritized, PR-sized implementation tasks

1. **Lock target catalogue and evidence matrix.** Decide base RCT2 versus Triple Thrill Pack; enumerate every in-scope ride and stall/product. Record supported modes, test requirement, breakdown eligibility, base ratings, and which fields are measured versus fixed.
2. **Build a vanilla calibration harness and fixtures.** Capture repeatable rides at controlled age, mode, scenery, test stats, and price. Store expected visible outputs as original prose/test fixtures without importing original files or game data.
3. **Implement flat/gentle/thrill rating models.** Replace static generic values with per-type base ratings and mode-specific duration/rotation/lap adjustments, adding only values confirmed by the calibration set.
4. **Implement tracked-rating components.** Match rating units and rounding, per-type contribution weights, minimum-stat penalties, mode bonuses, scenery/proximity, and update timing; keep uncertain terms isolated until validated.
5. **Implement typed operation modes and ride-specific dispatch.** Add per-type mode availability and corresponding settings, wait/load behavior, and train/vehicle rules; preserve deterministic replay.
6. **Implement reliability wear and inspection scheduling.** Add selectable intervals, age/type-dependent wear, mechanic travel and inspection, and measurable reliability restoration; compare month-by-month traces with vanilla.
7. **Implement breakdown profiles and recovery.** Add ride-allowed reasons, weighted type selection, weather modifiers, reason-specific stop/boarding/crash effects, mechanic response, repair time, and downtime.
8. **Implement ride value and guest-facing price behavior.** Use type-specific rating weights, vanilla age bands, same-type penalty, admission-price effect, and good-value/too-expensive reactions; verify in per-ride and park-admission scenarios.
9. **Implement stalls and facilities as distinct services.** Add complete target-version stall/product catalogue, item costs, user prices, weather effects, sales, toilet fees, and service throughput; do not route them through ride E/I/N logic.
10. **Expose the ride system in responsive UI.** Add mode, wait/load, capacity, maintenance, breakdown, financial, and guest fields using type-appropriate panels that remain usable at phone widths.

## Source index

- **Original RCT2 manual, 2002:** https://rct2.rctspace.com/rct2_manual.pdf
- **Alternate RCT2 manual mirror:** https://www.andrewsteele.me.uk/technology/game_manuals/rollercoaster_tycoon_ii.pdf
- **Ride-rating analysis (self-described incomplete):** https://github.com/OpenRCT2/OpenRCT2/wiki/Ride-rating-calculation
- **Operating mode names and notes:** https://tid.rctspace.com/OperatingModes.html
- **Ride operating option summaries:** https://rct.fandom.com/wiki/Ride_Operation_Options
- **Breakdown names and effects:** https://rct.fandom.com/wiki/Breakdown
- **Crash behavior (community reference):** https://rct.fandom.com/wiki/Crash
- **Ride value and pricing reverse engineering:** https://forums.openrct2.org/topic/2737-guide-how-much-can-you-charge-for-your-rides/
- **Vanilla age-pricing correction:** https://outof.games/news/8417-openrct2-v0427-is-out-new-title-sequence-reverting-pricing-algorithm-to-use-vanilla-games-algorithm/
- **Breakdown reason mix and weather example:** https://outof.games/realms/rollercoastertycoon/guides/536-guide-to-climate-weather-and-temperature-in-roller-coaster-tycoon-1-2/
- **Food/drink products, costs, and weather:** https://outof.games/realms/rollercoastertycoon/guides/541-guide-to-food-and-drink-stalls-in-roller-coaster-tycoon-1-and-2/
- **OpenRCT2 ride data documentation:** https://openrct2-doc.readthedocs.io/en/latest/ride.html
- **Pinned OpenRCT2 rating cross-check (not an original-game authority):** https://github.com/OpenRCT2/OpenRCT2/blob/47163dabbb7a13d1bf11e6c24e735c3d59201208/src/openrct2/ride/RideRatings.cpp
- **Pinned OpenRCT2 maintenance cross-check (not an original-game authority):** https://github.com/OpenRCT2/OpenRCT2/blob/47163dabbb7a13d1bf11e6c24e735c3d59201208/src/openrct2/ride/Ride.cpp

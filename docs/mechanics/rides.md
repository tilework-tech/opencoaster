# OpenCoaster Rides Mechanics Specification

**Target:** RCT2-era behavior, implemented independently. This is a behavior specification, not a source-code port. Do not use proprietary RCT assets, decompiled code, or OpenRCT2 source code. Numeric formulas sourced from public reverse-engineering writeups are provisional and need gameplay validation against RCT2.

Confidence labels used below: **multiple sources** means independent written references agree; **single source** means one public reference; **inferred** means a design recommendation or conclusion from incomplete evidence. The exact rating analysis linked below is one incomplete reverse-engineering document. Manual statements are authoritative for the user-facing model and controls but do not expose all algorithms.

## 1. Overview: how rides feel to the player

Rides turn a park into a set of promises: a ride type establishes a baseline identity, its layout and operating settings determine what the guests experience, and guests trade time and money for a suitable thrill. A player should feel the feedback loop: build or place an attraction, test or observe it, read excitement/intensity/nausea and capacity, connect an entrance and exit, choose dispatch behavior and price, then improve throughput or surroundings when demand exposes a bottleneck. **Confidence: multiple sources** (RCT2 manual; ride-rating and operations references).

The three headline ratings serve different roles:

- **Excitement** communicates novelty and enjoyment and is a major contributor to ride appeal and ticket value.
- **Intensity** communicates how forceful or alarming the ride feels; high intensity narrows the guest pool and can sharply reduce excitement.
- **Nausea** predicts sickness after riding and affects guest willingness/tolerance and downstream cleanup. **Confidence: multiple sources** (RCT2 manual; ride-rating references).

Queues, dispatch settings, breakdowns, inspections, and prices make a ride an operating system rather than a static attraction. Throughput is seats dispatched per cycle, not a fixed property of the ride name. Guests can wait, abandon a line, refuse an unsuitable ride, ride it, and react to the price and result. **Confidence: multiple sources for the overall loop; exact guest decision thresholds remain open.**

## 2. Precise rules and confidence

### 2.1 Rating calculation

Ratings are calculated from the ride type and the ride's tested characteristics. Flat attractions have preset/per-type behavior; tracked attractions use measured speed, forces, drops, inversions, length and other ride-specific features. Do not use one universal formula with identical weights for every ride. **Confidence: multiple sources for inputs and per-type differences; single source for the coefficients below.**

#### Tracked rides: provisional shared terms

A public, explicitly incomplete reverse-engineering analysis reports these shared base terms before ride-type coefficients:

```text
E_g = 0.08 * maxPositiveG
      - 0.24 * clamp(-2.5, maxNegativeG, 0)
      + 0.4 * min(1.5, maxLateralG)
I_g = 0.8 * maxPositiveG
      + 0.8 * (1 - maxNegativeG)
      + maxLateralG
N_g = 0.26 * maxPositiveG
      + 0.22 * (1 - maxNegativeG)
      + 0.33 * maxLateralG
```

Here `maxNegativeG` is the signed negative value (e.g. `-1.0`), and `clamp(low, value, high)` clamps to the inclusive range. The source says values are multiplied by ride-specific coefficients before being accumulated. **Confidence: single source; provisional, not independently verified on vanilla RCT2.**

Reported lateral-G penalties:

- If maximum lateral G is above `2.8`, add `3.75` intensity and `2` nausea.
- If it is above `3.1`, additionally halve excitement and add `8.5` intensity and `4` nausea.

**Confidence: single source; provisional.**

Reported drop contributions before ride-specific coefficients:

```text
E_drop = 0.11 * min(9, dropCount) + 0.0049 * highestDrop
I_drop = 0.14 * dropCount          + 0.0098 * highestDrop
N_drop = 0.10 * dropCount          + 0.0016 * highestDrop
```

The excitement count term caps after 9 drops; intensity and nausea count terms do not. Height units/scaling must match the game's internal ride measurement before using this as implementation data. **Confidence: single source; provisional.**

Reported inversion contributions:

```text
E_inversion = 0.27 * min(6, inversionCount)
I_inversion = 0.50 * inversionCount
N_inversion = 0.22 * inversionCount
```

The excitement count term caps after 6 inversions. **Confidence: single source; provisional.**

The analysis also reports ride-specific contributions from maximum and average speed, track length, and train length; and penalties when ride-specific minimums for speed, drops, drop height, negative/lateral G are not reached. Ride length directly affects excitement but not intensity/nausea in that analysis. Exact tables are not sufficiently established here; keep them as per-ride data and mark each value unverified until tested. **Confidence: single source for contribution shape; open for exact constants.**

Reported intensity penalty: excitement is multiplied by `0.75` at each exceeded threshold `10`, `11`, `12`, `13.2`, and `14.5` (thus cumulative; e.g. above two thresholds yields `0.75²`). Apply after accumulating intensity and before display rounding if validating this rule. **Confidence: single source; provisional.**

#### Flat and gentle rides

Flat and gentle rides use predefined ride-type baselines and ride-specific operating variables such as duration, number of swings/rotations/circuits or race laps. The RCT2 manual confirms that ride modes/options vary by ride, but public sources located for this specification do not establish one accurate cross-category equation or the complete per-ride coefficient table. Implement a data-driven `ratingModel` per ride type; do not invent generic multipliers. MVP should support authored base E/I/N plus deterministic mode adjustments, then replace those estimates as they are verified. **Confidence: multiple sources for per-type/predefined nature and mode dependence; exact formulas open.**

#### Scenery and proximity bonuses

- Scenery increases excitement, not intensity or nausea, according to the public calculation description. **Confidence: multiple sources for direction; single reverse-engineered source for the exact rule.**
- Reported station scenery scan: count scenery within about 5 tiles of the first station (roughly an 11×11 tile area), add `0.05` per item up to 47 items (maximum raw scenery score `2.35`), then apply the ride-type coefficient. An underground station reportedly substitutes a fixed raw score of `0.4`. The description itself is unsure which station tile is scanned, and multi-tile objects/counting semantics need validation. **Confidence: single source; provisional.**
- Tracked ride excitement can also benefit from track near paths, scenery, water, other track/attractions, and interactions such as interlocking layouts or tunnels. Different effects appear to scan ride segments and cap independently. The RCT2 manual describes themed scenery and near-collision illusions as excitement-enhancing; exact proximity scoring is not fully documented. **Confidence: multiple sources for qualitative effect; exact amounts open.**
- A RCT player test guide corroborates that station-area scenery and proximity count, while the manual independently supports scenery adding excitement. **Confidence: multiple sources for qualitative rule, not coefficient.**

Compute these when ride layout, nearby scenery/path/water, or the park spatial index changes, or when a completed test run refreshes measured values. Avoid rescanning the world every simulation tick. **Confidence: inferred implementation choice.**

### 2.2 Age, rating decay, ride value, and willingness to pay

Keep three concepts separate:

1. **Test ratings (E/I/N):** the consulted sources do not establish a periodic age-driven decrement to displayed E/I/N. The manual says age/novelty factors into excitement/appeal in broad terms, but the reverse-engineered rating inputs omit age. Treat any direct rating decay as **open** until measured; do not silently decay tested ratings each month. **Confidence: inferred from mixed evidence.**
2. **Ride value / ticket willingness:** ride value is derived from E/I/N and ride-type coefficients, then modified by age and possibly duplicate-ride effects. One reverse-engineered pricing guide reports the rating contribution as fixed point arithmetic: for each stat, `(ratingHundredths * statCoefficient * 32) / 32768` using integer division; sum E/I/N contributions. Its example gives a Giga coaster with `8.00/5.50/4.00`, coefficients `51/32/10`, and contributions `39 + 17 + 3 = 59`. This is a source-specific reverse-engineered recipe, not a validated universal RCT2 formula. **Confidence: single source.**
3. **Age price brackets:** a secondary version-history article reports vanilla RCT2 price bonuses of `+$6` under 5 months, `+$2` from 5 through 12 months, then no novelty bonus; later age depreciation continues. The RCT calendar has 8 months/year. The same article says a prior OpenRCT2 version used multipliers and later reverted to vanilla behavior, so keep the target explicitly RCT2 and do not copy successor-specific adjustments. **Confidence: single secondary source; exact boundaries and interaction with base value need test validation.**

The pricing guide reports that guests call a ride good value when its price is below about half its value and recommends about twice the value as a revenue-maximizing ceiling. Use this only as a starting hypothesis: guest cash, preferences, ride type, novelty, and price feedback affect actual purchase behavior. **Confidence: single reverse-engineered/player guide.**

### 2.3 Queues and queue lines

- Each ride has an entrance, an exit, and a queue path from the entrance to the normal park path. The manual documents queue construction/connection; the queue is a real guest path, not only a wait timer. **Confidence: verified from RCT2 manual.**
- Entrances and exits connect to a path only through their front edge, the one facing away from the ride; nothing connects on their sides, only queueing guests enter an entrance, only guests leaving the ride use an exit, and other guests never route across or step onto an exit tile. This was reported by the owner's playtester as RCT2 behaviour and is the intended rule; no public source was found to cite for it. **Confidence: playtester report, not independently sourced.** OpenCoaster stores the front per tile and migrates older parks by keeping the edge their queue or path already uses.
- Queue tiles hold several guests; public player references disagree between approximately 4 and 5 guests per tile. Treat occupancy as a visual/pathfinding constraint to validate, not a stable constant. OpenCoaster stands guests four to a tile, 64 units apart, single file along the chain of queue tiles (design choice within the reported 4-5 range): [one forum estimate of about 5 per tile](https://forums.openrct2.org/topic/6352-guest-complain-about-queue-lengths/), [queue-length discussion](https://forums.openrct2.org/topic/2375-stoping-guests-from-complaining-in-line/). **Confidence: single/community sources, conflicting.**
- The ride's displayed queue time should be an estimate based on queue size and observed/configured service throughput, not merely queue length. Useful MVP approximation: `estimatedWait = queuedGuests / max(recentGuestsPerSecond, epsilon)`. **Confidence: inferred.**
- Queue length should be planned from dispatch capacity and cycle time: `seatCapacityPerDispatch = sum(seats of vehicles dispatched together)`; `throughput ≈ seatCapacityPerDispatch / (rideCycle + load/unload + wait)`; use this to estimate queue wait. Keep ride-running duration and station wait separate. **Confidence: inferred from capacity/dispatch behavior.**
- Guests can abandon a long line. Fan references report abandonment near 11 minutes, extended to roughly 12 minutes with an entertainer, while other guides recommend shorter waits (about 8 minutes). These disagree and may be contextual/version-specific. **Confidence: single secondary/community sources; exact thresholds open.**
- Vanilla RCT2 is reported to have a 1,000-guest queue cap; later OpenRCT2 removed it. Do not rely on that cap for the clean-room game unless compatibility testing confirms it is desired. **Confidence: single wiki description.**
- RCT1 queue color behavior differs: RCT2 lets players change queue colors; the basic queue/entrance concept is common. **Confidence: single fan-wiki source.**

### 2.4 Operating modes and dispatch options

A ride has one operating mode selected from the modes supported by its type. The RCT2 manual confirms mode-specific controls and that options vary by ride. Modes documented across RCT1/RCT2 descriptions include continuous circuit, powered launch, shuttle, race, and single-ride admission; rotating/cycle modes for flat rides; boat-hire/free-navigation for some water rides; and RCT2 continuous-circuit block-sectioned mode. Avoid exposing incompatible modes on every ride. **Confidence: manual plus single secondary source; exact mode list per catalog entry needs data authoring.**

Common dispatch controls reported for RCT2:

- **Load threshold:** full, 3/4, 1/2, 1/4, or any load. Dispatch once occupancy meets the selected fraction of capacity.
- **Minimum wait:** do not dispatch before elapsed station wait reaches this value, even if the load target is met.
- **Maximum wait:** dispatch when this time is reached even if load target is unmet; it overrides load threshold but not minimum wait.
- **Leave if another train arrives:** reported to override load target while still respecting minimum wait.
- **Synchronize adjacent stations:** tracked-ride option; a station waits for the physically adjacent ride's departure to enable racing. RCT2 rating analyses report a fixed excitement bonus for synchronization, but whether a genuinely adjacent station is required has conflicting descriptions and should be validated.
- Ride-specific options include lift/launch speed, laps, rotation count, and train/car count.

**Confidence:** manual verifies that these control families exist; the exact option semantics above are from one secondary operations reference and require behavior validation. **RCT2 difference:** block-sectioned continuous-circuit mode is reported as new in RCT2; RCT1 has no block-sectioned mode.

#### Trains per ride by mode

Behaviour reference only (OpenRCT2's description of the max-train calculation was read; no code is copied):

- **Continuous circuit, block-sectioned (and powered-launch block-sectioned):** the limit is the number of stations plus the number of block brakes, minus one, never below 1. One section is always left empty so trains can advance. With no block brakes, a single station gives a limit of 1; with N block brakes and one station it is N. Trains are kept apart by the sections: a train waits at a closed block brake until the section ahead is free. Track length and train length do not enter the limit. Source: OpenRCT2 `Ride::updateMaxVehicles` (https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/ride/Ride.cpp) and the community guides below.
- **Continuous circuit (no sections):** the limit comes from how much track there is per train, not from block brakes: the station length decides how many trains the platform holds, and for continuous circuit and station-to-station rides whose type allows more vehicles, the total track length does (a quarter of the length, reduced as the maximum speed rises). Block brakes in this mode do not separate trains. Players report about two trains is typical (https://forums.openrct2.org/topic/44-tutorial-block-brakes/).
- **Shuttle, reverse-incline launched shuttle, powered launch (no sections), LIM launch:** always 1 train.
- **Block-section counting:** the station counts as a section; a chain lift counts only when it is the last piece before the station (https://forums.openrct2.org/topic/44-tutorial-block-brakes/); "trains = sections - 1" (https://rctmart.rctspace.com/fossil/BlockBrakes.html).

Cars per train is limited by the station platform length (block-sectioned mode also subtracts a safety margin) and by the ride type's mass limit.

Suggested dispatch state machine (design, not a claimed engine formula): `Closed → Testing → Open/WaitingForLoad → Dispatching/Running → Unloading → Open/WaitingForLoad`; breakdown transitions from any operating state to `BrokenDown`, rejects new boarding, handles occupied vehicles safely, then mechanic repair returns to open/closed policy. Check `minWait` first, then dispatch if `load >= threshold OR maxWait elapsed`, with synchronized departure as an additional gate unless a documented emergency/force rule supersedes it. **Confidence: inferred implementation.**

### 2.5 Reliability, inspections, breakdowns, and crashes

- Ride UI exposes reliability, lifetime downtime, time since inspection, and selectable inspection interval. Mechanics inspect and repair rides; the RCT2 manual states mechanics reduce breakdown/accident chance and fix failures. **Confidence: verified from manual.**
- Reported inspection choices: every 10, 20, 30, 45, or 60 minutes, every 2 hours, or never. **Confidence: single documentation reference; verify exact UI list.**
- Breakdowns generally become more frequent as rides age and reliability falls; regular inspection delays/reduces failures but cannot guarantee none. **Confidence: manual + single fan wiki.**
- Common documented failure names include safety cut-out/emergency stop, restraints stuck open/closed, vehicle malfunction, brakes failure, and control failure; some rides have a subset, and some do not break down. RCT1 labels the station-brake failure differently; RCT2 calls it brakes failure. **Confidence: single fan wiki.**
- Crash reports describe high-speed collisions and track/design failures; one fan wiki gives a combined collision speed threshold of 30 mph / 48 km/h. Treat this number as unverified. Station/brakes failure can remove normal stopping behavior and cause a collision. **Confidence: single source; exact threshold open.**
- Crashes can kill/remove riders, close the ride, and create a lasting safety/reputation consequence; repair/reopen behavior and guest fear should be modeled as distinct from ordinary breakdown recovery. **Confidence: single fan wiki.**
- The implemented model (gap 4 in [gap-audit.md](gap-audit.md)) follows OpenRCT2 `src/openrct2/ride/Ride.cpp`, `ride/rtd/*` and `entity/Staff.cpp` for behaviour only: reliability on a 0-25,855 scale checked every 256 ticks for open rides, per-type unreliability plus an age penalty, a `25,857 - reliability` roll out of 2^21, per-type breakdown sets, a repair that restores reliability, and downtime kept as eight 8192-tick windows. The sim runs 40 ticks/s like RCT2, so RCT2 tick counts apply unconverted (an inspection minute is 2048 ticks). Constants are in [DECISIONS.md](DECISIONS.md). Repair durations, explosion/crash behaviour, and RCT2's extra unreliability terms are not sourced or not modelled; do not claim exact RCT probabilities until measured. **Confidence: behaviour read from public source; not verified against vanilla RCT2.**

### 2.6 Ride catalog and capacity

RCT2's user-facing categories are **Transport, Gentle, Thrill, Roller Coasters, Water Rides, and Shops & Stalls**. Catalog entries must be keyed by ride type plus vehicle/configuration variant. A fan inventory counts 155 ride/vehicle/stall objects including variants and expansion content; it is not 155 distinct base ride types. **Confidence: manual + single community inventory.**

Capacity is configuration-dependent. Store the vehicle seat count and allowed car counts. For ordinary tracked dispatch, capacity is approximately `trainCount × carsPerTrain × seatsPerCar`; for nontracked rides use active vehicle count × seats/vehicle or an authored batch capacity. For stalls, capacity is service throughput (customers per tick/time), not seats. **Confidence: manual describes capacity and adjustable vehicle counts; formula inferred and must allow ride-specific overrides.**

The following is a categorized base-game family inventory, not a claim that every expansion/configuration variant is enumerated. `Per vehicle` means seats per dispatched car/boat/chair, not total ride capacity.

| Category | Ride families (examples from RCT2-era catalog) | Capacity representation / known examples |
|---|---|---|
| Transport | Miniature railway, monorail, suspended monorail, chairlift, monorail cycles, trams | Seats × active vehicle/car count × trains; source examples: miniature railway cars about 2–6 seats, monorail cars about 4–10, chairlift 2 per chair. Not full verified catalog. |
| Gentle | Merry-Go-Round, Ferris Wheel, Haunted House, Spiral Slide, Maze, Observation Tower, Car Ride, Space Rings, Bumper Cars/Dodgems, Mini Golf, Crooked House, Circus, Flying Saucers, Rowing Boats, Swans, Water Tricycles | Usually fixed batch or per-vehicle; reported examples: Ferris Wheel up to 32, Observation Tower 20, Haunted House 15, Merry-Go-Round 16. Secondary-guide values; validate. |
| Thrill | 3D Cinema, Bumper Boats, Enterprise, Go Karts, Launched Freefall, Magic Carpet, Motion Simulator, Pirate Ship, Roto-Drop, Snow Cups, Space Rings, Swinging Inverter Ship, Top Spin, Twist, Virginia Reel (class varies by title/version) | Seats × vehicle count for dispatch or one guest batch per cycle; varies widely. For example one guide reports 3D Cinema 20-seat batch. Need full per-type table. |
| Water | Boat Hire/Rowing Boats, Log Flume, River Rapids, River Rafts, Dinghy Slide, Splash Boats, Water Coaster, Submarine Ride, Jet Skis | Boats/seats per vehicle and concurrent vehicles. Reported boat hire variants include 1–6 per boat; Water Coaster boats are vehicle-specific. Exact catalog capacities open. |
| Roller coasters | Air Powered Vertical, Bobsleigh, Corkscrew, Floorless, Flying, Giga/Hyper, Inverted, Junior, LIM/Powered Launch, Looping, Mine Train/Mine Ride, Multi-Dimension, Reverse Freefall, Side-Friction, Spinning/Wild Mouse, Stand-up, Suspended, Vertical Drop, Wooden, and related types | `trains × cars/train × seats/car`; train and car limits are per type/vehicle. Vehicle variants range from solo cars to multi-seat articulated trains. Validate a full table before balancing. |
| Shops & stalls | Food/drink stalls, shops/souvenirs, information kiosks, cash machines, first aid, restrooms | No ride seats; model service duration/throughput and service capacity. Product/vehicle object variants are not separate ride dispatch types. |

**Confidence:** Categories and capacity display are from the RCT2 manual; names/examples are supported by a community RCT2 inventory; individual counts mostly come from single secondary sources and are explicitly provisional. Full canonical type IDs, unlock conditions, vehicle seat counts, operating modes, and car limits are an implementation data task. Do not infer omitted/new expansion objects to be vanilla RCT2.

## 3. Data model proposal and CPU budget

Keep high-volume, frequently updated guest and vehicle state in struct-of-arrays typed storage; rides are lower-volume but can use the same indexed layout for predictable iteration. Static ride definitions remain ordinary immutable tables.

```ts
type RideId = number;
type RideTypeId = number;
type VehicleConfigId = number;
type RidePhase = 0 | 1 | 2 | 3 | 4 | 5; // closed, testing, waiting, running, unloading, broken

interface RideDefinition {
  typeId: RideTypeId;
  category: 'transport' | 'gentle' | 'thrill' | 'water' | 'coaster' | 'shop';
  vehicleConfigs: VehicleConfigId[];
  supportedModes: number[];
  ratingModel: number;
  baseExcitement: number;
  baseIntensity: number;
  baseNausea: number;
  inspectionOptionsMinutes: number[];
  failureProfileId: number;
}

interface RideArrays {
  typeId: Uint16Array;
  vehicleConfigId: Uint16Array;
  phase: Uint8Array;
  mode: Uint8Array;
  minWaitTicks: Uint16Array;
  maxWaitTicks: Uint16Array;
  loadFractionQ8: Uint8Array;
  capacity: Uint16Array;
  queuedGuests: Uint16Array;
  boardCount: Uint16Array;
  rideCycleTicks: Uint32Array;
  phaseTicks: Uint32Array;
  ageMonths: Uint16Array;
  excitementQ8: Uint16Array;
  intensityQ8: Uint16Array;
  nauseaQ8: Uint16Array;
  reliabilityQ8: Uint8Array;
  downtimeTicks: Uint32Array;
  lastInspectionTick: Uint32Array;
  nextInspectionTick: Uint32Array;
  breakdownKind: Uint8Array;
  breakdownTicks: Uint16Array;
}
```

Track vehicles likewise use arrays for rideId, trainId, carCount/seat count, trackSegment, speed, state, and rider range/count. Queue membership should use a linked index/ring-buffer per ride or a shared FIFO pool to avoid scanning all guests for each ride; each guest carries `queueRideId` and queue-node/next index. Spatial scenery, path, and track adjacency should be indexed by tile so ride rating invalidation only recomputes affected rides.

At 40 simulation ticks/sec, the frame budget is 25 ms across the whole simulation/rendering pipeline. **Budget proposal (inferred):** ordinary ride phase/dispatch checks are O(number of rides) with primitive reads and simple arithmetic each tick; vehicle movement is O(active vehicles); guest boarding/queue movement is O(guests that actually transition/move), not a full guest×ride scan. Do not calculate scenery proximity, track stats, ride ratings, or full queue wait estimates from scratch each tick. Use dirty flags and low-frequency rolling throughput samples. Aim for less than 1 ms/tick for ride core at target scale (thousands of guests; hundreds of rides) and benchmark in-browser before committing to this budget. **Confidence: inferred engineering target, not measured.**

## 4. Dependencies on other subsystems

- **Guests:** preferences/tolerance for intensity and nausea, funds, ride desire, queue behavior/abandonment, boarding/seating, ride satisfaction, sickness, and post-ride thoughts.
- **Track and physics:** track graph, station direction, vehicle movement, speed/G-force/drop/inversion test sampling, circuit completion, block sections, collision detection, and ride statistics.
- **Economy:** construction/running cost, ticket pricing and age adjustments, guest wallet checks, income/refunds, shop sales, and ride value contribution to park value.
- **Staff/world:** mechanic dispatch/pathfinding, inspection tasks, repair, reliability, downtime, vandalism/weather effects where supported, and queue entertainers.
- **Pathing/queues:** queue paths connect entrances to normal paths, guest FIFO, per-tile capacity, estimated waits, queue abandonment, and station boarding order.
- **Scenery/spatial index:** station and track proximity checks, path/water/scenery/other-ride bonuses; invalidate affected ride rating caches after map edits.
- **Rendering/audio:** ride state, vehicles, queue rails, entrances/exits, signs/status, breakdown/crash presentation, and optional ride music. Keep product assets original; no RCT sprites, sounds, music, or data files.

## 5. Prioritized implementation checklist

### MVP

1. Define the original OpenCoaster ride catalog schema by category and separate ride type from vehicle variant; include authored base ratings, seat count, car/train constraints, modes, and rating model IDs.
2. Implement rides as phase machines: closed, testing, waiting/loading, running, unloading, broken. Testing records a completed deterministic ride profile before stats become available.
3. Add configurable capacity and dispatch with minimum/maximum wait, target load fraction, and per-ride cycle duration; implement one simple flat/gentle mode and one simple tracked circuit.
4. Add queue paths linked to ride entrances, FIFO boarding, exit routing, approximate wait display, queue occupancy, and guest abandonment with a single configurable threshold.
5. Implement ratings for authored flat/gentle base stats; for tracked rides add test-derived speed, drops, inversions, and G-force features with per-type coefficient tables clearly marked provisional. Keep test samples and scoring deterministic.
6. Add scenery excitement baseline with a 5-tile station influence scan, 47-object cap, and cache invalidation. Gate on manual behavioral validation because the exact scan point/multiplier remains uncertain.
7. Add ride value/price feedback using a configurable ride-type formula; begin with E/I/N contribution plus age buckets, surface guest “too expensive/good value” reactions, and tune using scenario-like playtests.
8. Add reliability, periodic inspections, breakdown/repair lifecycle, and downtime tracking with tunable probabilities; do not claim exact RCT probabilities until empirically measured.
9. Expose ride status, ratings, capacity, queue size/wait, operating mode, price, reliability, and inspection interval in the UI.
10. Benchmark 40 ticks/sec with thousands of guests and large ride/vehicle counts; prove no per-tick full spatial scans or guest×ride loops.

### Fidelity

1. Validate all reverse-engineered tracked-rating terms, fixed-point rounding order, thresholds, and ride-specific coefficients with controlled RCT2 behavior observations and record each test setup.
2. Author exact catalog of ride types, vehicle variants, per-vehicle seats, min/max cars/trains, dispatch modes, queue/exit rules, inspection options, and non-breaking rides.
3. Measure and implement per-ride flat/gentle mode formulas; differentiate RCT1-only behavior only when reproducing it intentionally.
4. Add tunnel, sheltered, water, scenery, path, nearby-track/ride, sync-station, and interlocking proximity terms with verified caps/radii.
5. Confirm whether displayed E/I/N ratings age-decay; separately measure novelty, ride value, duplicate-type penalties, exact ticket-price rounding, and RCT2 age brackets.
6. Measure queue tile capacity, actual wait-time rounding, abandonment and entertainer effects, and any intended 1,000-person compatibility limit.
7. Add ride-specific breakdown tables, probability weights, inspection reset effects, mechanic response/repair timing, weather interactions, crash edge cases, and RCT1/RCT2 terminology differences.
8. Add guest satisfaction/safety consequences, recovery after crash, and ride popularity decay/revival if behavioral testing supports them.
9. Profile and optimize against deterministic seeded scenarios; store replayable ride test traces for regressions.

## 6. Open questions and sources

### Open questions

- Do original RCT2 displayed E/I/N ratings themselves decay with age, or do age/novelty affect ride value and willingness-to-pay only? Manual prose is broad; sources conflict or conflate concepts.
- What are the verified flat/gentle per-ride rating equations and how do duration, rotations, circuits, laps, and load affect them?
- What are the exact ride-type coefficients, minimum-stat thresholds, units, integer rounding sequence, and clamps for tracked rides?
- What station tile and scenery object counting rules produce the scenery bonus? Do multi-tile scenery pieces count once, per tile, or by object-specific weight?
- Which proximity bonuses are present in vanilla RCT2, with which radius, caps, weights, and interaction rules?
- What exact price formula, thresholds, age schedule, duplicate-type discount, and guest response behavior should OpenCoaster emulate?
- What are queue capacity per tile, wait estimate rounding, abandonment threshold, and entertainer effect in RCT2 versus RCT1?
- What is the reliability decay and breakdown probability formula? How do inspections, age, ride type, rain, mechanics, and operating time affect it?
- Which breakdowns are possible per ride type, what are their exact probabilities, and which can crash a ride? Is 30 mph/48 km/h a vanilla RCT2 collision threshold?
- What is the complete base RCT2 catalog and exact capacity/configuration data per ride vehicle? How should expansion rides be versioned?

### Sources

1. RCT2 manual mirror (ride creation, queue setup, ratings, capacity, operations, inspection and mechanics): https://www.andrewsteele.me.uk/technology/game_manuals/rollercoaster_tycoon_ii.pdf
2. RCT2 manual alternate mirror (search indexed manual): https://rct2.rctspace.com/rct2_manual.pdf
3. Public incomplete ride-rating analysis (exact terms, scenery score, track contributions and penalty description): https://github-wiki-see.page/m/openrct2/openrct2/wiki/Ride-rating-calculation
4. Ride operations options (wait, load, synchronization, reliability and inspections): https://rct.fandom.com/wiki/Ride_Operation_Options
5. Ride excitement qualitative factors and age/scenery discussion: https://rct.fandom.com/wiki/Excitement
6. Ride breakdown behavior and names: https://rct.fandom.com/wiki/Breakdown
7. Crash behavior and reported collision threshold: https://rct.fandom.com/wiki/Crash
8. Queue line details: https://rct.fandom.com/wiki/Queue_Lines
9. Queue hints and reported guest impatience: https://rct.fandom.com/wiki/Hints_and_Tips
10. RCT2 ride/stall/vehicle inventory including variants: https://rctmart.rctspace.com/forums/index.php?showtopic=1086
11. Capacity examples for classic rides (secondary guide): https://gamefaqs.gamespot.com/pc/132866/roller-coaster-tycoon/faqs/7440
12. RCT2 ride price/value reverse-engineering discussion: https://forums.openrct2.org/topic/2737-guide-how-much-can-you-charge-for-your-rides/
13. OpenRCT2 v0.4.27 summary describing return to vanilla pricing algorithm: https://outof.games/news/8417-openrct2-v0427-is-out-new-title-sequence-reverting-pricing-algorithm-to-use-vanilla-games-algorithm/
14. RCT2 tracked ride statistic fields and RCT1/RCT2 airtime distinction: https://strategywiki.org/wiki/Template%3ARollerCoaster_Tycoon/Rides/Documentation
15. RCT2 ride vehicle/seat and car constraints documentation (schema reference only; do not copy implementation): https://openrct2-doc.readthedocs.io/en/latest/ride.html
16. Academic description of RCT2 tracked coaster ratings and guest tolerance: https://campbelljc.com/research/papers/campbell-23-trackrl.pdf

This document is a clean-room design specification. Public behavior descriptions and manuals are references; no original assets, decompiled code, or OpenRCT2 implementation code were used or included.

## Observation Tower

Reference facts (public guides, restated in our own words; confidence in parentheses):

- A station with a 1x1 column that the player extends upward, in the same family as the Elevator, Launched Freefall and Roto-Drop (high). [Observation Tower guide](https://outof.games/realms/rollercoastertycoon/guides/507-guide-to-building-an-observation-tower-in-rollercoster-tycoon-1-2/)
- No tower-specific height limit; the global construction cap of about 600 ft applies, supports are free, and taller towers rate higher but carry fewer guests per hour (medium). Same guide; [Elevator guide](https://outof.games/realms/rollercoastertycoon/guides/483-guide-to-building-an-elevator-in-rollercoaster-tycoon-1-2/).
- Capacity 20 for the single-deck cabin; cabin speed about 4 mph empty and about 0.5 mph slower full (high / medium). Same guide.

Not found in public sources, therefore OpenCoaster tuning: height per section, section price, top dwell, boarding and unloading durations, whether height can be edited after opening, clearance rules and breakdown behaviour.

Implemented behaviour (see `src/sim/rides/observation-tower.ts`):

| Parameter | Value | Basis |
|---|---|---|
| Height range | 8–64 land levels, default 11 (the pre-v35 art height) | tuning |
| Cabin speed | 39 ticks per level each way (about 1 level/s, about 3.5 mph at 5 ft per level) | tuned near the cited 4 mph |
| Top dwell | 160 ticks (4 s) | tuning |
| Loading / unloading | 120 ticks (3 s) each | tuning |
| Section price | $18.00 above or below the default height; 70% refunded when removed | tuning |
| Cycle at 1x (40 ticks/s) | Loading + 2 × travel + dwell + Unloading; 8 levels: 673 ticks (16.8 s); 11 levels: 907 ticks (22.7 s) | derived |

Before this change a tower ran a fixed 400-tick Running phase regardless of height inside an 80 + 400 + 80 tick cycle (14 s), and its art looped an eight-pose cabin animation every 64 ticks, so the cabin bobbed about six times per trip.

## Shops and stalls: storefront

Reference facts (public sources, restated in our own words; confidence in parentheses):

- A stall serves guests from one side only and must be built with that side toward a footpath; the game marks the buying side with an arrow during placement (high). [OpenRCT2 forum, "How do I play"](https://forums.openrct2.org/topic/1668-hi-how-do-i-play/); [Toilets wiki](https://rct.fandom.com/wiki/Toilets) (toilets are front-only in RCT2).
- The Information Kiosk is the exception in RCT2: guests can use it from every side (single source). [Information Kiosk wiki](https://rct.fandom.com/wiki/Information_Kiosk)
- OpenRCT2 turns a stall being placed to face an adjacent footpath automatically; once the player rotates it manually, the manual facing is kept (high). [OpenRCT2 PR #7411](https://github.com/OpenRCT2/OpenRCT2/pull/7411) and the OpenRCT2 changelog entry for it.
- The footpath must meet the stall at the stall's own height; a stall and a path at mismatched heights do not connect (multiple sources). [OpenRCT2 issue #17566](https://github.com/OpenRCT2/OpenRCT2/issues/17566); [forum, changing a shop's height](https://forums.openrct2.org/topic/5178-shop-stallride-construction-question-changing-height/)
- A sloped path can serve a stall when its end meets the stall floor (single source). [OpenRCT2 PR #11758](https://github.com/OpenRCT2/OpenRCT2/pull/11758)
- No public source found on whether a newly built stall starts open; the searched OpenRCT2 docs and forums do not say ([Shops & Stalls docs](https://docs.openrct2.io/en/latest/playing/shops_and_stalls/index.html)).

Implemented behaviour (see `src/sim/rides/stall-front.ts`):

| Rule | OpenCoaster | Basis |
|---|---|---|
| Facing | Stored per stall (`dir`), chosen before building, kept until the player turns it | sources above |
| Automatic facing | Current facing if it serves, else first serving side in +x, +y, -x, -y order, until the player rotates | OpenRCT2 #7411 |
| Serving piece | Path piece on the front tile whose edge toward the stall is level with the stall floor (tile height, one level up on sloped ground): flat at floor level, or a ramp whose low or high end meets it | #17566, #11758 |
| Refused fronts | Queue line, ride exit, ramp running across the front, wrong height, unowned land, map edge, no path — each reported with its own reason | tuning (reasons are OpenCoaster wording) |
| Open state | Opens when built; losing access never closes it, guests just ignore it and it does not count toward value for money, guest capacity or awards (upkeep is still charged); a player's close is respected | OpenCoaster tuning: keeps the existing auto-open after placement and lets a path built later serve without reopening |
| Shared path tile | Two stalls may face the same path tile | inferred; RCT2 places no object on the front tile |

Known difference: the Information Kiosk is front-only in OpenCoaster, although RCT2 serves it from all sides. This is deliberate for now, so that side access cannot hide a wrong facing.

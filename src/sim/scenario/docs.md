# Noridoc: Scenario Simulation

Path: @/src/sim/scenario

### Overview

- Defines scenario starting finances, pricing, research, entrance placement and objective state, plus each scenario's generated map: terrain recipe, land ownership, trees and pre-built rides.
- Validates scenario JSON and evaluates dated or open-ended objectives against the simulation.
- Keeps the active objective and win/loss status in `World` for deterministic saves and continuation.

### How it fits into the larger codebase

- The worker prepares new scenarios through [scenario-layout.ts](scenario-layout.ts), which applies scenario settings and builds the optional entrance path.
- [scenario-file.ts](scenario-file.ts) validates documents loaded by [catalog.ts](catalog.ts); errors identify the scenario and field, while duplicate IDs invalidate the catalog.
- [scenario-system.ts](scenario-system.ts) runs after economy processing and reads current guest, ride, track, economy and ledger state when evaluating a deadline.
- [scenario.ts](scenario.ts) owns the flat objective record and terminal status in `World`; [save.ts](../../save/save.ts) preserves those fields without storing the source scenario document.
- In the final world-fidelity balance run, the default seed (2026) wins at park rating 474 against the 450 target after the trash rate was calibrated from one-in-48 to one-in-96. The earlier deferred-economy seed sweep is a separate baseline. See [docs/BALANCE.md](../../../docs/BALANCE.md#world-fidelity-pass) for the comparison and assumptions.

- [scenario-map.ts](scenario-map.ts) generates the map from the recipe in a scenario file (`terrain`, `land`, `trees`); [scenario-prebuilt.ts](scenario-prebuilt.ts) places standing rides; [park-grid.ts](park-grid.ts) is the gate-relative coordinate frame both share with the balance strategies in [bench/strategy](../../../bench/strategy).
- The shipped catalog is every `scenarios/*.json`: the starter plus ten more across the Beginner, Challenging, Expert, Real and Other tabs. Each tab's scenarios and objectives are listed with their scripted win rates in [docs/BALANCE.md](../../../docs/BALANCE.md#scenario-win-rates). Completion is remembered per browser by [scenario-progress.ts](../../save/scenario-progress.ts) and shown by the title screen.

### Core Implementation

- `generateScenarioMap` replaces the default seeded terrain when a file has a `terrain` block. It layers coarse noise (`relief`, `cell`), `hills` and `lakes` over `baseLevel`, then clamps vertices near a flat build apron to `buildLevel` (one level of slope per vertex of distance, so the apron is exactly flat and relaxation never touches it). The apron is `buildLength` tiles inward from the gate edge and `buildWidth` across, centred on the owned edge, and must fit inside the owned land. Water fills tiles below `seaLevel`; tiles at or below it are sand, the rest use `surface`.
- `land.ownedMarginPercent` insets the owned rectangle (default 25, the starter's centre half); `land.saleMarginPercent` leaves an outer ring unsellable, and the rest is for sale. `trees` scatters small-scenery elements in `groves` on dry, flat, grass tiles, never on or within one tile of the apron. The generator is seeded from the world seed, so different seeds give different noise, lakes' banks and trees around the same apron.
- `prepareScenario` order: terrain, entrance (placed on the apron midpoint), standing rides, then `applyScenario`; construction of standing rides is free because cash and the month's ledger are reset afterwards. Standing rides use `prebuilt` entries (`type`, `row` inward from the gate, signed `lateral` across the spine of at least 2) and are opened with a queue, entrance and exit.
- The renderer draws its own ambient trees from tile coordinates (see [render docs](../../render/docs.md)). Scenario trees are `SmallScenery` elements (oak, item 0) that count toward guest surroundings and coaster scenery ratings, and the renderer draws each one with the oak sprite as scenery, alongside but distinct from the ambient trees.

- [scenario.ts](scenario.ts) defines objective kinds and the numeric objective record, and applies starting finance, price policy, research availability and objective state. [scenario-layout.ts](scenario-layout.ts) also places and registers an optional gate path.
- [scenario-file.ts](scenario-file.ts) validates bounded numeric fields, enums (including optional climate), income category masks, optional coaster thresholds and deadlines. It converts `byYear` to simulation ticks; a `byTick` deadline is used as supplied. Scenario JSON does not need to match an embedded interface shape beyond the fields the parser accepts.
- Scenario climate is applied to the world weather state, hashed and saved; scenarios that omit it use the warm default. The starter scenario declares that default explicitly.
- [scenario-system.ts](scenario-system.ts) judges dated objectives once, on the first tick at or after their deadline; the result is terminal. Families include guest count/rating, park value, loan repayment plus park value, monthly income, ride counts, qualifying or complete coasters, best-ride excitement and `HaveFun`. Aliases include `guestsByDate`, `parkValueByDate`, `monthlyRideIncome` and `monthlyFoodProfit`.
- `monthlyFoodProfit` uses net food/drink sales and stock costs. Kiosk and toilet revenue is recorded as general shop sales and does not satisfy that objective.
- Ride objectives scan ride and track stores at the evaluation tick. `QualifyingRides` counts open non-shop attractions; `BuildRides` counts current ride entities; `QualifyingCoasters` counts distinct open track-ride types meeting excitement and length thresholds; `CompleteCoasters` counts rides with a closed track and sufficient excitement; `BestRide` compares excitement for open rides. These criteria describe current state, not lifetime achievements.
- `MonthlyIncome` reads the most recently completed month. `Guests` may require a minimum park rating; `GuestsAndRating` requires both guest and rating thresholds; `RepayLoanAndParkValue` also requires zero loan. Park-value objectives use the economy's latest published park value input. `HaveFun` has no deadline and remains active.
- The [objective UI](../../ui/objective.ts) reads the objective and live metric. The park window shows the objective, active awards and current date; the HUD shows objective status and announces recent award news.

### Things to Know

- Park value includes the economy's valuation of closed non-shop rides and current guest count, but its ride inputs refresh periodically; an objective can therefore observe the most recently published value at its evaluation tick.
- Coaster length uses the track system's stored centre-line tile length. Objective field semantics and thresholds remain compatibility assumptions where checked-in mechanics sources do not establish original RCT2 behavior; see [docs/DECISIONS.md](../../../docs/DECISIONS.md).
- Entrance search starts at the owned-land edge midpoint and takes the first straight inward run of the requested length that is buildable, flat, dry and empty. If no run qualifies, no path or gate is placed.

Created and maintained by Nori.

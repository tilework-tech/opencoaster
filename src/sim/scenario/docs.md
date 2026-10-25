# Noridoc: Scenario Simulation

Path: @/src/sim/scenario

### Overview

- Defines scenario starting finances, pricing, research, entrance placement and objective state.
- Validates scenario JSON and evaluates dated or open-ended objectives against the simulation.
- Keeps the active objective and win/loss status in `World` for deterministic saves and continuation.

### How it fits into the larger codebase

- The worker prepares new scenarios through [scenario-layout.ts](scenario-layout.ts), which applies scenario settings and builds the optional entrance path.
- [scenario-file.ts](scenario-file.ts) validates documents loaded by [catalog.ts](catalog.ts); errors identify the scenario and field, while duplicate IDs invalidate the catalog.
- [scenario-system.ts](scenario-system.ts) runs after economy processing and reads current guest, ride, track, economy and ledger state when evaluating a deadline.
- [scenario.ts](scenario.ts) owns the flat objective record and terminal status in `World`; [save.ts](../../save/save.ts) preserves those fields without storing the source scenario document.
- In the final headless balance sweep, the default seed (2026) wins at park rating 554 against the 450 target. At the calibrated target, 10 of 12 modest-build seeds win, with ratings from 386 to 688; seeds 22 and 26 miss at 412 and 386. See [docs/BALANCE.md](../../../docs/BALANCE.md#starter-objective) for the harness and assumptions.

### Core Implementation

- [scenario.ts](scenario.ts) defines objective kinds and the numeric objective record, and applies starting finance, price policy, research availability and objective state. [scenario-layout.ts](scenario-layout.ts) also places and registers an optional gate path.
- [scenario-file.ts](scenario-file.ts) validates bounded numeric fields, enums, income category masks, optional coaster thresholds and deadlines. It converts `byYear` to simulation ticks; a `byTick` deadline is used as supplied. Scenario JSON does not need to match an embedded interface shape beyond the fields the parser accepts.
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

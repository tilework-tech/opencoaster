# OpenCoaster mechanics specifications

These research specs describe player-visible mechanics and proposed implementation models for a clean-room reimplementation. The numeric values in most specs are low-confidence, often based on fan wikis or search snippets, and must be calibrated in playtesting. Each spec marks evidence, inference, and open questions where available.

## Specs

- [Guests](guests.md) — guest needs, decisions, pathfinding, park entry and exit, and guest state.
- [Rides](rides.md) — ride operations, capacity, ratings, pricing, queues, reliability, and breakdowns.
- [Track](track.md) — track construction, train motion, ride testing, ratings, and operating behavior.
- [World](world.md) — staff, litter, weather, land, paths, scenery, and park upkeep.
- [Engine](engine.md) — world representation, simulation clock, rendering, camera, interface, and save concepts.
- [Economy spec (PR #1)](https://github.com/tilework-tech/opencoaster/pull/1) — finance, loans, income and costs, research, marketing, park value, and scenario objectives.

## Cross-spec conflicts

- **Tick-rate certainty:** Guests, rides, track, and engine use a 40 Hz simulation target; the world spec says the original game's tick rate is not confirmed. Treat 40 Hz as the current OpenCoaster target until a chosen reference version is validated.
- **World storage model:** Engine describes each map coordinate as an ordered stack of heterogeneous elements. World proposes a simpler tile record for terrain, path, and litter, while track lays pieces on a half-tile grid. These proposals need a shared representation or a defined mapping between layers.
- **Calendar and wage cadence:** Engine proposes 16,384 ticks per month and an eight-month year based on OpenRCT2-oriented sources. Economy describes weekly wage charges (alongside monthly salary labels), while world lists monthly wage accounting. Define one validated calendar conversion and clarify whether these refer to charge cadence or report cadence; vanilla equivalence remains open.
- **Rating formulas:** Rides and track overlap on excitement, intensity, and nausea inputs, with low-confidence coefficients. Rides reports cumulative ×0.75 excitement penalties at intensity thresholds; track records a source conflict between ×0.75 and ×0.5 penalties and provisionally chooses ×0.75. Guests marks the park-rating formula unresolved because its source conflicts (1150 versus 150 baseline); economy separately reports a single-source 0–999 clamp. Keep ride ratings and park rating distinct and validate both.
- **Guest food-seeking:** The guests spec preserves conflicting reports about whether hungry guests seek the nearest food stall or wander until they encounter one. This behavior needs an observed test case before choosing a rule.
- **Entity schemas and scale:** Guests proposes a guest store with an example capacity of 8,192; engine sets a 5,000-guest performance target; rides uses a 16-bit ride capacity field. These are draft design choices and need a common capacity-growth and serialization policy.

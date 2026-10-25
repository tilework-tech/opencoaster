# Noridoc: Research Simulation

Path: @/src/sim/research

### Overview

- Owns scenario research state, category-gated progress, funding levels, invention priority, and the set of unlocked items.
- The research system updates progress at weekly boundaries and charges funding at monthly boundaries.
- Research unlock state is a simulation invariant used by ride construction and presented to the UI through simulation feedback.

### How it fits into the larger codebase

- [World](../core/world.ts) owns research state; [core simulation](../core/simulation.ts) applies research actions and checks unlocks before accepting `createRide` commands.
- [Scenario setup](../scenario/docs.md) supplies each park's ordered invention list and starting unlocked items.
- The research system runs in the fixed [simulation order](../core/simulation.ts); it charges through the [economy API](../economy/api.ts), with monthly rollover processed later in that same tick order.
- Research state is included in [save/load](../../save/docs.md) and deterministic state hashing through the world model.

### Core Implementation

- [research.ts](research.ts) defines funding, state, save helpers, unlock queries, and the `setFunding`, `setCategories`, and `setPriority` actions.
- [research-system.ts](research-system.ts) charges monthly funding even when no invention is eligible, accrues work weekly when funding and an enabled category allow progress, and adds completed item ids to `unlocked`.
- The player priority list is considered first; remaining eligible inventions retain scenario order. Changing the current target resets progress, while excess work carries to the next invention.
- Core ride creation calls `isUnlocked` and reports `RideResult.ResearchRequired` for a locked ride type. This keeps the simulation authoritative even when the UI filters locked rides from the selection menu.

### Things to Know

- Funding levels charge $0, $100, $200, or $400 per month and add 0, 21, 28, or 42 work units per week. An invention's work requirement is scenario data.
- An empty category mask pauses progress but does not pause monthly funding charges. Items available at scenario start are already in `unlocked`.
- Priority actions reject unknown or duplicate item ids; an empty priority list follows scenario order.
- Legacy saves stored invention cost and progress in cents; `upgradeLegacyResearchSave` converts those values to current work units. Saves without a priority list resume in scenario order.

Created and maintained by Nori.

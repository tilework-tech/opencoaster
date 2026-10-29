# Noridoc: Research Simulation

Path: @/src/sim/research

### Overview

- Owns scenario research state, category-gated progress, funding levels, invention priority, and the set of unlocked items.
- The research system updates progress at weekly boundaries and pays one quarter of the selected monthly funding amount at each weekly boundary.
- Research unlock state is a simulation invariant used by ride construction and presented to the UI through simulation feedback.

### How it fits into the larger codebase

- [World](../core/world.ts) owns research state; [core simulation](../core/simulation.ts) applies research actions and checks unlocks before accepting `createRide` commands.
- [Scenario setup](../scenario/docs.md) supplies each park's ordered invention list and starting unlocked items. Applying a scenario replaces the world's invention catalog and unlock set from that scenario, derives funding and enabled categories from the inventions still locked, and resets priority, target and progress.
- The research system runs in the fixed [simulation order](../core/simulation.ts); it charges through the [economy API](../economy/api.ts), with monthly rollover processed later in that same tick order.
- Research state is included in [save/load](../../save/docs.md) and deterministic state hashing through the world model.

### Core Implementation

- [research.ts](research.ts) defines funding, state, save helpers, unlock queries, and the `setFunding`, `setCategories`, and `setPriority` actions. The scenario setup path copies invention records and rebuilds unlocked state, so starting availability is not inherited from a prior/default world state.
- [research-system.ts](research-system.ts) charges weekly quarters of the selected monthly funding amount even when no invention is eligible, accrues work weekly when funding and an enabled category allow progress, and adds completed item ids to `unlocked`.
- The player priority list is considered first; remaining eligible inventions retain scenario order. Changing the current target resets progress, while excess work carries to the next invention.
- Core ride creation calls `isUnlocked` and reports `RideResult.ResearchRequired` for a locked ride type. This keeps the simulation authoritative even when the UI filters locked rides from the selection menu.

### Things to Know

- Funding levels charge $0, $100, $200, or $400 per month and add 0, 21, 28, or 42 work units per week. An invention's work requirement is scenario data.
- An empty category mask pauses progress but does not pause monthly funding charges. Items available at scenario start are already in `unlocked`; an empty remaining invention queue starts with no funding and no enabled research categories.
- Priority actions reject unknown or duplicate item ids; an empty priority list follows scenario order.
- Saves store their own invention list, unlocked ids, funding, category mask and progress. Loading restores this saved research state instead of reapplying the current scenario catalog, preserving parks created with older scenario availability. Legacy saves stored invention cost and progress in cents; `upgradeLegacyResearchSave` converts those values to current work units. Saves without a priority list resume in scenario order.

Created and maintained by Nori.

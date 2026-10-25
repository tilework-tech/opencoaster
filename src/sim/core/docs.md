# Noridoc: Simulation Core

Path: @/src/sim/core

### Overview

- Owns the deterministic simulation kernel, including world state, seeded randomness, entity storage, and state hashing.
- Applies player and debug commands at tick boundaries, then advances systems in a fixed, documented order.
- Provides the world state consumed by worker snapshots and persistence code.

### How it fits into the larger codebase

- [Simulation](simulation.ts) is constructed by [src/worker](../../worker/docs.md), accepts commands through `enqueue`, and advances the world through `step`.
- Commands are applied in arrival order at the start of a tick. Replaying the same seed and tick-command sequence reproduces the same simulation state.
- Map commands are routed to [map command handlers](../map/map-commands.ts), track commands to [track command handlers](../track/track-commands.ts), ride commands (`placeRideEntrance`, `placeRideExit`, `setRideStatus`) to [ride commands](../rides/ride-commands.ts), and ride creation is validated in the core before calling [ride operations](../rides/ride-operations.ts). After `placePath`, `placePathRun`, or `removePath` is applied, core calls [refreshRideQueueConnections](../rides/ride-commands.ts): ordinary ride queue connectivity and stall/facility adjacent-path access are recalculated from the updated map. Path runs use the same refresh path as single-tile placements because the footpath tool submits runs. Economy and research commands are delegated to their respective modules.
- The ordered systems advance weather, research, track, rides, the ride queue, vehicles, coasters, guests, staff, vandalism, litter, park inputs, economy, and scenarios. Vandalism runs after staff movement and before litter aging/generation; the order is part of the determinism contract.
- [World](world.ts) owns the state stores, map, weather, scenario and `park` (gate tile). [hashWorld](hash.ts) hashes persistent simulation state, including weather climate and the active scenario objective, for deterministic checks and replay comparisons; saves persist that state separately through [save/load](../../save/docs.md).

### Core Implementation

- [commands.ts](commands.ts) defines the `Command` union for guest and staff spawning, staff hiring/firing, staff renaming, role and per-person patrol tiles, flower beds, `setParkEntrance` (the gate must stand on a footpath), ride creation, `RideCommand` (entrance/exit placement, ride status and price), map edits, economy, research, and track placement or removal.
- [feedback.ts](feedback.ts) holds `world.feedback` (`seq`, `domain`, `code`, `subject`). `reportFeedback` is called by command handlers with a `FeedbackDomain` (`Track` -> `TrackResult`, `Ride` -> `RideResult`) so the UI learns the outcome through snapshots. `seq` increments on every report so repeated identical outcomes are distinguishable. It is neither hashed nor saved.
- `Simulation.enqueue` appends commands to a pending queue. At the next `step`, the queue is drained before systems update; each command is dispatched to the owning domain operation.
- The additive `createRide` command carries a ride type, anchor tile coordinates and an optional orientation `dir` (quarter turns, default 0). Core checks that the catalog type is unlocked by research before affordability, then `validateRidePlacement` ([rides/ride-footprint.ts](../rides/ride-footprint.ts)), which covers every tile of the rotated footprint: map bounds, build rights, supported surfaces, water, paths, scenery, other rides, track and the ground-height spread the ride's supports allow. A locked type reports `RideResult.ResearchRequired` through simulation feedback. It charges the catalog cost to `RideConstruction` only when ride creation succeeds.
- `placeTrack` and `removeTrack` are handled entirely by `applyTrackCommand` in the [track command handler](../track/track-commands.ts), including ride-type rules, ownership, funds and charging. A successful `createRide` also reports the new ride id as the feedback subject.
- [EntityStore](entity-store.ts) stores entities in typed-array columns with stable IDs and dense slot reuse. World schemas supply the domain fields, and [hash.ts](hash.ts) incorporates store arrays into the state hash.
- [constants.ts](constants.ts) centralizes simulation scale, tick rate, and capacities; [prng.ts](prng.ts) provides seeded random values used by simulation systems.

### Things to Know

- Simulation state uses integer values and seeded randomness; do not introduce wall-clock reads, `Math.random`, or floating-point stored state into the kernel.
- System ordering and command application order affect outcomes and are part of the deterministic replay behavior.
- Entity storage uses dense swap-remove while IDs remain stable, so a slot index is not an entity identity.
- Rejected commands leave state unchanged, but track and ride commands report their outcome in `world.feedback`; map and other commands still give no result. Ride creation reports research, funds, map and obstruction failures through the ride result channel. Feedback holds only the latest outcome.
- `coasterSystem` must stay right after `vehicleSystem`: it consumes train state the vehicle system just advanced.

Created and maintained by Nori.

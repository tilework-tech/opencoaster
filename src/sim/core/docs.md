# Noridoc: Simulation Core

Path: @/src/sim/core

### Overview

- Owns the deterministic simulation kernel, including world state, seeded randomness, entity storage, and state hashing.
- Applies player and debug commands at tick boundaries, or applies pending commands directly while paused without advancing systems.
- Provides the world state consumed by worker snapshots and persistence code.

### How it fits into the larger codebase

- [Simulation](simulation.ts) is constructed by [src/worker](../../worker/docs.md), accepts commands through `enqueue`, and advances the world through `step`.
- Commands are applied in arrival order. During normal play the queue drains at the start of a tick; the worker can also drain it while paused, leaving the tick counter and systems unchanged. Replaying the same seed and ordered command sequence reproduces the same simulation state.
- Map commands are routed to [map command handlers](../map/map-commands.ts), track commands to [track command handlers](../track/track-commands.ts), ride commands (`placeRideEntrance`, `placeRideExit`, `setRideStatus`) to [ride commands](../rides/ride-commands.ts), and ride creation is validated in the core before calling [ride operations](../rides/ride-operations.ts). After a path placement or removal command is applied, core refreshes queue connectivity for rides with entrances so their connection flag follows the current queue-to-path layout. Economy and research commands are delegated to their respective modules.
- The ordered systems advance weather, research, track, rides, the ride queue, vehicles, coasters, guests, staff, vandalism, litter, park inputs, economy, and scenarios. Vandalism runs after staff movement and before litter aging/generation; the order is part of the determinism contract.
- [World](world.ts) owns the state stores, map, weather, scenario and `park` (gate tile), plus the fixed-capacity packed patrol-mask pool addressed by each staff member's area ID. [hashWorld](hash.ts) hashes persistent simulation state, including patrol masks, weather climate and the active scenario objective, for deterministic checks and replay comparisons; saves persist that state separately through [save/load](../../save/docs.md).

### Core Implementation

- [commands.ts](commands.ts) defines the `Command` union for guest and staff spawning, staff hiring/firing, staff renaming, role and per-person patrol tiles, flower beds, `setParkEntrance` (the gate must stand on a footpath), ride creation, `RideCommand` (entrance/exit placement, ride status and price), map edits, economy, research, and track placement or removal.
- [feedback.ts](feedback.ts) holds `world.feedback` (`seq`, `domain`, `code`, `subject`). `reportFeedback` is called by command handlers with a `FeedbackDomain` naming which result enum the code belongs to (for example `Track` -> `TrackResult`, `Path` -> `PathResult`, `Land` -> `LandResult`) so the UI learns the outcome through snapshots. Several domains can share one enum: the Water and Clear scenery tools report `LandResult` codes under their own `Water` and `Clear` domains so each tool's client only reacts to its own refusals. `seq` increments on every report so repeated identical outcomes are distinguishable. It is neither hashed nor saved.
- `Simulation.enqueue` appends commands to a pending queue. `applyPendingCommands` drains it without advancing time; `step` calls the same operation before systems update and increments the tick afterward. Each command is dispatched to the owning domain operation.
- The additive `createRide` command carries a ride type, anchor tile coordinates and an optional orientation `dir` (quarter turns, default 0). Core checks that the catalog type is unlocked by research before affordability, then `validateRidePlacement` ([rides/ride-footprint.ts](../rides/ride-footprint.ts)), which covers every tile of the rotated footprint: map bounds, build rights, supported surfaces, water, paths, scenery, other rides, track and the ground-height spread the ride's supports allow. A locked type reports `RideResult.ResearchRequired` through simulation feedback. It charges the catalog cost to `RideConstruction` only when ride creation succeeds.
- `placeTrack` and `removeTrack` are handled entirely by `applyTrackCommand` in the [track command handler](../track/track-commands.ts), including ride-type rules, ownership, funds and charging. A successful `createRide` also reports the new ride id as the feedback subject.
- [EntityStore](entity-store.ts) stores entities in typed-array columns with stable IDs and dense slot reuse. World schemas supply the domain fields, and [hash.ts](hash.ts) incorporates store arrays into the state hash.
- [constants.ts](constants.ts) centralizes simulation scale, tick rate, and capacities; [prng.ts](prng.ts) provides seeded random values used by simulation systems.

### Things to Know

- Simulation state uses integer values and seeded randomness; do not introduce wall-clock reads, `Math.random`, or floating-point stored state into the kernel.
- System ordering and command application order affect outcomes and are part of the deterministic replay behavior. Paused command application intentionally performs no system updates, so construction can change world state while game time remains frozen.
- Entity storage uses dense swap-remove while IDs remain stable, so a slot index is not an entity identity.
- Rejected commands leave state unchanged. Track, ride, economy, footpath placement and the area map tools (Land, Water, Clear scenery) report their outcome in `world.feedback`; other map commands give no result. Ride creation reports research, funds, map and obstruction failures through the ride result channel. Feedback holds only the latest outcome.
- `coasterSystem` must stay right after `vehicleSystem`: it consumes train state the vehicle system just advanced.

Created and maintained by Nori.

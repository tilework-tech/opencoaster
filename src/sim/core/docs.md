# Noridoc: Simulation Core

Path: @/src/sim/core

### Overview

- Owns the deterministic simulation kernel, including world state, seeded randomness, entity storage, and state hashing.
- Applies player and debug commands at tick boundaries, then advances systems in a fixed, documented order.
- Provides the world state consumed by worker snapshots and persistence code.

### How it fits into the larger codebase

- [Simulation](simulation.ts) is constructed by [src/worker](../../worker/docs.md), accepts commands through `enqueue`, and advances the world through `step`.
- Commands are applied in arrival order at the start of a tick. Replaying the same seed and tick-command sequence reproduces the same simulation state.
- Map commands are routed to [map command handlers](../map/map-commands.ts), track construction commands to [track command handlers](../track/track-commands.ts), and ride creation is validated in the core before calling [ride operations](../rides/ride-operations.ts). Economy and research commands are delegated to their respective modules.
- The ordered systems advance weather, research, track, rides, vehicles, guests, staff, litter, economy, and scenarios. The order is part of the determinism contract.
- [World](world.ts) owns the state stores and map. [hashWorld](hash.ts) hashes those state arrays for deterministic checks and persistence integration.

### Core Implementation

- [commands.ts](commands.ts) defines the `Command` union for guest and staff spawning, ride creation, map edits, economy, research, and track placement or removal.
- `Simulation.enqueue` appends commands to a pending queue. At the next `step`, the queue is drained before systems update; each command is dispatched to the owning domain operation.
- The additive `createRide` command carries a ride type and tile coordinates. Core checks affordability, build rights and supported surfaces across the catalog footprint, and overlap with existing ride or track footprints before calling the ride creation operation. It charges the catalog cost to `RideConstruction` only when ride creation succeeds.
- `placeTrack` commands are affordability-gated in core using the catalog piece cost, then passed to the [track command handler](../track/track-commands.ts) for track-specific placement rules. An unaffordable piece is not placed; a successful placement is charged to `RideConstruction`. Ownership is not enforced in this dispatch path, so direct commands follow the track handler's existing behavior.
- [EntityStore](entity-store.ts) stores entities in typed-array columns with stable IDs and dense slot reuse. World schemas supply the domain fields, and [hash.ts](hash.ts) incorporates store arrays into the state hash.
- [constants.ts](constants.ts) centralizes simulation scale, tick rate, and capacities; [prng.ts](prng.ts) provides seeded random values used by simulation systems.

### Things to Know

- Simulation state uses integer values and seeded randomness; do not introduce wall-clock reads, `Math.random`, or floating-point stored state into the kernel.
- System ordering and command application order affect outcomes and are part of the deterministic replay behavior.
- Entity storage uses dense swap-remove while IDs remain stable, so a slot index is not an entity identity.
- Map, ride, and track commands can be silently ignored when their core or domain validation rejects them; the UI does not receive a command result through this kernel interface. The track tool's build-rights check is a main-thread gate based on the latest worker snapshot, not a track-handler invariant.

Created and maintained by Nori.

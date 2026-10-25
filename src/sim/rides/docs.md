# Noridoc: Rides

Path: @/src/sim/rides

### Overview

- Defines ride types and owns per-ride state, operating cycles, ratings, reliability, maintenance, and ride commands.
- Covers flat rides, service stalls and facilities, transport rides, coasters, and tracked water rides such as Log Flume and River Rapids.
- Ride state uses deterministic integer data and is part of the simulation's saved and hashed world state.

### How it fits into the larger codebase

- Ride instances live in `World.rides`, a struct-of-arrays `EntityStore` defined by [ride-store.ts](ride-store.ts) and created by [core/world.ts](../core/world.ts). The core state hash includes this store through [core/hash.ts](../core/hash.ts). [save/save.ts](../../save/save.ts) writes ride columns in save version 4 and migrates version 3 rides by replacing only the legacy ride schema segment, preserving allocator IDs and surrounding track arrays. Migrated rides remain closed until entrance/exit placement and queue connection are configured.
- [ride-system.ts](ride-system.ts) runs in the ordered simulation tick through [core/simulation.ts](../core/simulation.ts). It advances ride phases and age, then runs the time-based reliability and breakdown checks of [ride-maintenance.ts](ride-maintenance.ts) using the world's seeded PRNG.
- Ride-associated ticket, stall, food/drink, toilet, and kiosk receipts accumulate in the ride's lifetime `incomeCents` field; [save/save.ts](../../save/save.ts) persists it from version 8 and defaults older versions to zero. Version 11 appends `reliabilityRaw`, `mode`, `breakdownReason`, `serviceTicks` and `serviceLastTick`; version 12 appends the rolling rider-history columns after them. Older saves initialize absent fields from the legacy reliability percent/default mode and zero rider history.
- Placement accepts tile coordinates from callers and checks them against [map/tile-map.ts](../map/tile-map.ts). Queue connectivity is derived by walking queue tiles from a placed entrance until a regular path touches the line; [core/simulation.ts](../core/simulation.ts) refreshes that derived state after path placement, path-run placement, or removal. [Guest behavior](../guests/docs.md) walks guests to the entrance over the footpath network (queue tiles are ordinary path elements with the queue flag, accepted as `Surface.Path` or `Surface.Queue`).
- The track workstream owns layouts ([track](../track/docs.md)) and [vehicles](../vehicles/docs.md) own train physics and test-run metrics. [coaster-system.ts](coaster-system.ts) (ordered right after `vehicles` in `SYSTEM_ORDER`) bridges them for rides whose type has `usesTrack`, including Log Flume and River Rapids; [ride-system.ts](../ride-system.ts) skips those rides. Water rides use the same test, queue, train dispatch, and measured-rating path as coasters, with water-specific vehicle controls described in [vehicles](../vehicles/docs.md); [ride-operations.ts](../ride-operations.ts) exposes the validated measured-stat interface.
- Ride setup and status commands (`placeRideEntrance`, `placeRideExit`, `setRideStatus` with `open` / `close` / `test`) are routed from [core/simulation.ts](../core/simulation.ts) to [ride-commands.ts](ride-commands.ts). `createRide` and these commands report a `RideResult` ([ride-results.ts](ride-results.ts)) through `world.feedback`; core rejects ride types that are not yet research-unlocked with `ResearchRequired`.
- [staff](../staff/docs.md) owns staff entities and movement. A mechanic walks to a broken ride, or to one whose inspection is due, and calls `serviceRide` every staff update while standing at it; `rideServiceX/Y` give the tile to walk to (a track ride has no tile, so its exit serves).
- Ride trips record completed riders into rolling ride history in [ride-store.ts](ride-store.ts). [Economy park inputs](../economy/park-inputs.ts) reads that five-minute total and values every non-shop ride, including closed rides, for park value.

### Core Implementation

- [ride-commands.ts](ride-commands.ts) creates rides, validates and places entrances/exits, opens/closes/tests rides, and demolishes rides. Ordinary rides require boarding points and a connected queue; track rides also require a passed test. Stalls and facilities use a neighboring public path as direct access.
- Entrance and exit candidates are accepted around the complete flat-ride footprint or the footprints of every coaster station piece. Queue connectivity is derived by walking queue tiles from the entrance until they touch a regular path; path placement and removal refresh this derived state.
- Flat-ride tests run a deterministic dry cycle without guests or replacing authored ratings. Track rides use [coaster.ts](coaster.ts) and [coaster-system.ts](coaster-system.ts) to run vehicles and record measured test statistics; this includes Log Flume and River Rapids, whose water-track rules are defined by their ride types.
- [ride-refund.ts](ride-refund.ts) calculates construction cost from the ride catalog plus its attached track pieces, then returns the full cost if no guest was served or 70 percent rounded down otherwise. The same calculation feeds the ride-window refund preview through [worker snapshots](../../worker/docs.md) and the authoritative demolition command. Demolition aborts testing, removes trains, clears guests' ride targets and navigation, and moves them to a walkable exit, entrance, or nearest walkable tile; orphaned track is removed by [track-system.ts](../track/track-system.ts).
- [ride-maintenance.ts](ride-maintenance.ts) applies seeded reliability and breakdown checks. Ride income, reliability, operating mode, service state, and rolling rider history are persisted by the save system.

### Things to Know

- `allowsWater` is ride-type capability metadata. Track command validation rejects each rotated piece footprint over open water for rides without that capability; Log Flume and River Rapids may place their track over open water.
- Queue and service access are derived from the map. Removing the last adjacent public path clears a stall/facility's access and closes it; ordinary ride queues must reach at least one regular path tile.
- Consecutive station pieces are supported, and every station footprint contributes tiles where entrance and exit candidates can be placed. Any track edit invalidates the ride's tested state.
- Track rides dispatch and unload through the coaster system; flat rides use the regular ride phase system. A ride's phase and guest occupancy constrain when boarding points and operating settings can change.

Created and maintained by Nori.

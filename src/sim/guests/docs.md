# Noridoc: Guests

Path: @/src/sim/guests

### Overview

- Stores guest state in typed struct-of-arrays columns and advances guest behaviour through the `guests` simulation system.
- Guests arrive at the park gate, walk the real footpath network with the [pathfinder](../pathfinding/docs.md), use rides, stalls and toilets, pay through the [economy](../economy/docs.md), and leave through the gate.
- Litter has separate store and system entry points in this folder; guests do not drop litter yet.

### How it fits into the larger codebase

- [World](../core/world.ts) owns the guest and ride stores, the map, the economy ledger and `world.park` (the gate tile, [park.ts](park.ts)). [Simulation](../core/simulation.ts) runs `guestSystem` in the deterministic system order and routes `spawnGuests` and `setParkEntrance` here.
- Movement calls `nextDirection` from [pathfinding](../pathfinding/navigate.ts) at every tile centre, passing the target tile (a ride or stall entrance, or the gate) or `-1` to wander. `heading` stores the last direction so the pathfinder avoids reversing. Guests never leave the footpaths: positions advance 12 units per update toward the next tile centre.
- Destinations are ride-store entries (rides, stalls, toilets alike) addressed by `targetRide`. A destination is only chosen when `isReachable` says a footpath route to its entrance exists.
- The [ride queue system](../rides/queue-system.ts) seats `Waiting` guests when a ride dispatches; this system finishes the ride when the ride's completed-cycle counter moves on.
- Money: gate fees post to `Admission`, tickets to `RideTickets` (at boarding, only in per-ride price mode), food and drink to `FoodDrinkSales` with a stock cost to `FoodDrinkStock`, toilet fees to `ShopSales`. Arrival chance reads `parkRating` and the active marketing campaign from the economy.

### Core Implementation

- [Guest store](guest-store.ts): states `Wandering`, `Queuing` (walking a queue path toward the ride entrance), `Riding`, `Leaving`, `Shopping` (using a stall or toilets at its entrance tile) and `Waiting` (at the head of the queue, counted in the ride's `queueLength`). `spawnGuest` places the guest on the gate tile, or on a random tile while the park has no gate.
- [Guest system](guest-system.ts) updates a guest when `(tick + id) % 4 === 0`. Needs advance once every four updates. A decision happens only at tile centres: leave if happiness, energy or cash is exhausted; otherwise keep or pick a destination (toilets when `toilet >= 128`, then food or drink for hunger/thirst `>= 128`, then the best-scoring open, affordable, reachable ride once the post-ride cooldown has elapsed).
- Stalls and toilets are noticed within 10 tiles (Chebyshev), which realises the decision "head to a stall it has seen, otherwise wander and buy on encounter": a stall on the guest's own tile has distance 0. There is no per-guest memory of seen stalls.
- Rides: a guest arriving at the entrance tile becomes `Waiting` and increments `queueLength`; guests still walking the queue are not counted. On dispatch the queue system turns that many `Waiting` guests (lowest slot first) into `Riding`, stamping the low 16 bits of the ride's `cyclesCompleted` in `activityTicks`. When the counter changes the guest steps onto the ride exit tile (or the entrance when the exit is not a footpath), gains happiness and energy, and starts a ride cooldown.
- Patience: 2,400 ticks to reach a destination, 3,200 ticks queuing or waiting. A guest that times out, or whose ride closes, drops the destination (decrementing `queueLength` if it was `Waiting`).
- Arrivals: every 80 ticks a park with a gate may admit one guest with probability `(rating - feePenalty) * marketingAttraction`, up to `200 + 50 * rides` guests. The gate fee is taken from the new guest's cash.
- Leaving guests walk to the gate and despawn there; with no gate or no route they despawn at once.

### Things to Know

- Rates, thresholds, scores, patience and capacities are tunable design choices, not claims about the original game.
- Guests in `Riding` stand on the ride's footprint tile, which is not a footpath; consumers that check footpath occupancy (for example the lost-guest count in [park inputs](../economy/park-inputs.ts)) skip them.
- A guest whose tile is not a footpath (for example after the path under it is removed, or spawned by `spawnGuests` into a park without a gate) cannot move; it eventually leaves when its energy runs out and counts as lost for the park rating.
- `queueLength` counts only guests at the head of the queue, so ride choice and the wait estimate under-count a long line. The queue capacity from `connectRideQueue` is not enforced against walking guests.
- Stalls serve any number of guests at once; `capacity` is not enforced. The Information Kiosk is never visited.
- Save version 5 added the `heading` column; version 3 and 4 saves migrate with `HEADING_NONE`.

Created and maintained by Nori.

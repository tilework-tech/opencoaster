# Noridoc: Guests

Path: @/src/sim/guests

### Overview

- Stores guest state in typed struct-of-arrays columns and advances guest behaviour through the `guests` simulation system.
- Guests arrive at the park gate, walk the real footpath network with the [pathfinder](../pathfinding/docs.md), use rides, stalls and toilets, pay through the [economy](../economy/docs.md), and leave through the gate.
- Litter has separate store and system entry points in this folder; guests periodically create trash or vomit on walkable tiles.

### How it fits into the larger codebase

- [World](../core/world.ts) owns the guest and ride stores, the map, the economy ledger and `world.park` (the gate tile, [park.ts](park.ts)). [Simulation](../core/simulation.ts) runs `guestSystem` in the deterministic system order and routes `spawnGuests` and `setParkEntrance` here.
- Movement calls `nextDirection` from [pathfinding](../pathfinding/navigate.ts) at every tile centre, passing the target tile (a ride or stall entrance, or the gate) or `-1` to wander. `heading` stores the last direction so the pathfinder avoids reversing. Guests never leave the footpaths: positions advance 12 units per update toward the next tile centre.
- Destinations are ride-store entries (rides, stalls, toilets alike) addressed by `targetRide`. A destination is only chosen when `isReachable` says a footpath route to its entrance exists.
- The [ride queue system](../rides/queue-system.ts) seats `Waiting` guests when a ride dispatches; this system finishes the ride when the ride's completed-cycle counter moves on.
- Money: gate fees post to `Admission`, tickets to `RideTickets` (at boarding, only in per-ride price mode), food and drink to `FoodDrinkSales` with a stock cost to `FoodDrinkStock`, and toilet fees and successful umbrella kiosk purchases to `ShopSales`. Arrival chance reads `parkRating` and the active marketing campaign from the economy.

### Core Implementation

- [Guest store](guest-store.ts): states `Wandering`, `Queuing` (walking a queue path toward the ride entrance), `Riding`, `Leaving`, `Shopping` (using a stall or toilets at its entrance tile) and `Waiting` (at the head of a ride queue, counted in the ride's `queueLength`, or waiting for a busy stall). `spawnGuest` places the guest on the gate tile, or on a random tile while the park has no gate.
- [Guest system](guest-system.ts) updates a guest when `(tick + id) % 4 === 0`. Needs advance once every eight updates. A decision happens only at tile centres: leave if happiness, energy or cash is exhausted; otherwise keep or pick a destination (toilets when `toilet >= 128`, then food or drink for hunger/thirst `>= 128`, then, in rain without an umbrella, the nearest open kiosk, then the best-scoring open, affordable, reachable ride once the post-ride cooldown has elapsed).
- Stalls and toilets are noticed within 10 tiles (Chebyshev), which realises the decision "head to a stall it has seen, otherwise wander and buy on encounter": a stall on the guest's own tile has distance 0. There is no per-guest memory of seen stalls.
- Ride choice ([guest-system.ts](guest-system.ts) `scoreRide`) works in ride units (hundredths). [preferences.ts](preferences.ts) converts the guest's 0-255 preferred-intensity and nausea-tolerance bytes: a ride above the guest's intensity ceiling (preferred + 1.50) is refused with a "too intense" thought, a ride too sickening for the guest's tolerance with "too nauseous", and one whose line is full with "queue too long". Remaining rides score `4 x excitement - 2 x intensity gap - 3 x nausea - price - 100 x line length - rain penalty + taste`; `taste` is a small deterministic hash of guest, ride and a 2,048-tick epoch. [docs/BALANCE.md](../../../docs/BALANCE.md) lists every constant.
- Lines: [ride-lines.ts](ride-lines.ts) recounts, at the start of every guests update, per ride slot the guests `queued` (Queuing or Waiting), `approaching` (Wandering with that ride as destination) and `serving` (Shopping). The counts live on `world.rideLines`, are derived from guest state, and are neither saved nor hashed, so a loaded game recounts to the same values. A ride's line capacity is `rideQueueCapacity` (queue tiles + 1, four guests each); a ride whose line (queued + approaching) is full is not chosen, and a guest arriving at a full line is turned away. The worker snapshot reports `queued` as the ride's queue length.
- Rides: a guest arriving at the entrance tile becomes `Waiting` and increments `queueLength`, which still counts only the guests available to board. On dispatch the queue system turns that many `Waiting` guests (lowest slot first) into `Riding`, stamping the low 16 bits of the ride's `cyclesCompleted` in `activityTicks`. When the counter changes the guest steps onto the ride exit tile (or the entrance when the exit is not a footpath), gains happiness (`8 + excitement / 40`) and energy, and starts a ride cooldown.
- Stalls and facilities serve `capacity` guests at a time for `runTicks` each. A guest arriving at a busy one becomes `Waiting` at its entrance (without touching `queueLength`) and starts shopping as soon as a place is free, or gives up after the queue patience. Guests skip stalls whose line is eight or longer.
- Patience: 2,400 ticks to reach a destination, 3,200 ticks queuing or waiting. Walking to a destination refreshes that patience whenever the guest gets closer to the entrance than it has been (`approachGap`, the smallest tile gap since the destination was chosen), so a long walk that keeps making progress is not abandoned, while a guest that stops making progress is lost. A guest that times out, or whose ride closes, drops the destination (decrementing `queueLength` if it was `Waiting` for a ride). Before this rule a guest walking more than about 2,400 ticks to a far ride timed out, re-picked the same ride at once and never arrived.
- Arrivals: every 40 ticks a park with a gate may admit one guest with probability `(rating - feePenalty) * marketingAttraction * (1 - guests / comfortable)`, where `comfortable = 30 + 40 x open attractions + 8 x open stalls`. The gate fee is taken from the new guest's cash.
- Weather and rain shelters: guests without an umbrella receive a ride-score penalty for thrill and coaster rides during rain or storms, and in rain walk to the nearest affordable open kiosk and buy an umbrella there (price to `ShopSales`; ownership is stored by stable guest id). A wandering guest can also buy from an open kiosk within one tile; both purchase routes increment that kiosk's `guestsServed` counter. Outdoors (wandering, queuing or waiting) and without an umbrella or a nearby shelter, a guest loses 2 happiness once every 128 ticks in rain or storm; a rain shelter on the guest's tile or an adjacent tile (`PathFlag.Shelter`) stops that loss. Guests whose happiness reaches the leave threshold depart, so shelters reduce leaving in the rain. Litter: Guest litter generation is handled by [litter-system.ts](litter-system.ts): sufficiently nauseous guests create vomit, while other guests may create trash (about one check in 48). Trash increments a bin on the tile up to its capacity; when there is no bin or it is full, both trash and vomit use the litter entity store.
- Leaving guests walk to the gate and despawn there; with no gate or no route they despawn at once.

### Things to Know

- Rates, thresholds, scores, patience and capacities are tunable design choices, not claims about the original game.
- Guests in `Riding` stand on the ride's footprint tile, which is not a footpath; consumers that check footpath occupancy (for example the lost-guest count in [park inputs](../economy/park-inputs.ts)) skip them.
- A guest whose tile is not a footpath (for example after the path under it is removed, or spawned by `spawnGuests` into a park without a gate) cannot move; it eventually leaves when its energy runs out and counts as lost for the park rating.
- `queueLength` counts only guests at the head of the queue, so ride choice and the wait estimate under-count a long line. The queue capacity from `connectRideQueue` is not enforced against walking guests.
- Stalls serve any number of guests at once; `capacity` is not enforced. The Information Kiosk is selected for umbrellas in rain and also sells them to nearby wandering guests.
- Current saves use version 9. Version 5 added the guest `heading` column; version 6 added staff patrol masks and per-guest umbrella ownership; version 7 added the grounds byte per tile and player staff names; version 8 added per-ride income; version 9 added the guest `approachGap` column and the per-ride train count and cars per train (zero means automatic). Loading older saves initializes missing fields to defaults and rebuilds the weekly wage input from saved staff. Versions 3 and 4 also migrate guests with `HEADING_NONE`.

### Vandalism

- [vandalism.ts](vandalism.ts) runs every 32 ticks after the staff system. An angry guest (happiness at or below `ANGRY_HAPPINESS`, 64) standing on a path tile with a bench or bin breaks it with probability 1 in 8 per check. The broken addition is removed and the element reverts to plain path; a bin's stored trash is lost. Riding guests are skipped.
- A security guard within `SECURITY_RADIUS` (6 tiles, Chebyshev) of the guest stops the attempt before it lands. Lamp additions are visual path features and are not vandalized by guests.
- Breakage is not tracked as a counter; rebuild the bench or bin with the Bench or Bin tool.

Created and maintained by Nori.

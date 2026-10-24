# Noridoc: Guests

Path: @/src/sim/guests

### Overview

- Stores guest state in typed struct-of-arrays columns and advances guest behaviour through the `guests` simulation system.
- Covers guest generation, needs and thoughts, ride selection, movement, queueing, riding, and leaving; litter has separate store and system entry points in this folder.

### How it fits into the larger codebase

- [World](../core/world.ts) owns the guest and ride entity stores, map, economy ledger, and seeded random generator. [Simulation](../core/simulation.ts) runs `guestSystem` as part of the deterministic system order and routes the `spawnGuests` command to `spawnGuest`.
- Ride choice reads open state, price, intensity, excitement, nausea, queue length, and entrance coordinates from the [ride store](../rides/ride-store.ts). A selected ride's queue length is adjusted directly by guest behaviour; there is no separate queue-operation system yet.
- Movement calls the [pathfinding contract](../pathfinding/pathfinder.ts) to request the next tile toward the current target. The system reuses a route buffer sized to the map area, growing it when a larger map is used, so it can hold any map path. Until a pathfinder finds a path, the default null implementation falls back to moving directly toward the target tile.
- The default admission provider reads optional `parkRating` and `entranceFee` properties from the economy ledger, with defaults when those fields are absent. `createGuestSystem` accepts an admission provider so this dependency can remain narrow while economy support develops.
- [Guest mechanics](../../../docs/mechanics/guests.md) describes the broader target behaviour. Food, drink, toilet, stall, and queue-service operations are not implemented by this module yet.

### Core Implementation

- [Guest store](guest-store.ts) defines guest states and needs, preferences, cash in integer cents, ride target, patience and activity counters, and four typed thought columns addressed as a rotating ring. `spawnGuest` allocates an entity, gives it a seeded random map position and initial stats, and initializes it as wandering.
- [Guest system](guest-system.ts) updates each guest when `(tick + stable entity id) % 4` is zero. Needs are integer counters with bounded updates: hunger, thirst, and toilet rise; energy falls while wandering and some is restored when a ride completes; happiness falls when hunger or thirst is very high. Hunger and thirst thoughts are written to the ring when their thresholds are reached, while an identical latest thought is suppressed.
- Wandering guests score every ride that is open, affordable, and within the guest's intensity tolerance. The score combines excitement, preference gap, nausea, price, and queue length. Guests move toward the chosen ride entrance, join its queue counter on arrival, wait with a patience timer, ride for a fixed activity duration, pay the ride price on completion, and receive a happiness increase and nausea cost.
- Guests whose happiness, energy, or cash reaches its leaving threshold enter `Leaving` and move toward a map-corner exit target. When no ride is selected, a guest occasionally gets a random map target and continues wandering.
- Arrivals are considered at fixed tick intervals. The economy provider's park rating and entrance fee produce a bounded chance; ride count raises the baseline arrival capacity, up to the guest-store capacity. Reaching the baseline alone does not permanently stop arrivals when ride capacity is available. Arrivals use the same `spawnGuest` initialization as explicit spawn commands.

### Things to Know

- The numeric rates, thresholds, ride score weights, patience, ride duration, arrival interval, and admission calculation are implementation design choices. They are not exact claims about the original game's mechanics.
- Leaving guests are despawned when they reach their map-corner exit target, which frees entity capacity for later arrivals.
- Queueing is a placeholder counter and timer: no queue path, boarding slot, ride capacity, or queue-service system is consulted. A timed-out guest decrements the ride's queue length when the target ride still exists.
- Guests do not consume food or drink, use toilets, receive stall effects, or alter litter through this system. Thought categories exist for these needs, but current need handling records hunger and thirst thoughts only.
- `nullPathfinder` returns no route. The guest system then uses the target tile directly for movement, so the fallback does not validate path connectivity.
- The guest store and system use typed arrays and bounded loops; the system avoids updating every guest every tick by staggering work using stable entity IDs.

Created and maintained by Nori.

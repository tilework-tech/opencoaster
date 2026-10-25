# Noridoc: Weather Simulation

Path: @/src/sim/weather

### Overview

- Holds the park's selected climate, current represented weather kind, temperature, and ticks remaining before a transition. Monthly base temperature follows the climate's March-to-October table.
- Seeds weather transitions from the world's shared pseudo-random generator so replays and saves preserve the same sequence.
- Guest ride scoring reads weather state to model a provisional rain preference effect.

### How it fits into the larger codebase

- [World](../core/world.ts) owns the serializable weather state; [Simulation](../core/simulation.ts) runs the weather system first in the fixed system order.
- [Guest behavior](../guests/guest-system.ts) reads the state when scoring rides and when a wandering guest in rain or storm is adjacent to an open information kiosk and may buy an umbrella.
- Weather scalars are included in [world hashing](../core/hash.ts) and serialized by [save/load](../../save/save.ts), so continuing a save keeps the remaining transition countdown.
- The broader researched behavior and source confidence are tracked in [world mechanics](../../../docs/mechanics/world.md); implementation values are game tuning rather than claims about an original game's schedule.

### Core Implementation

- [weather.ts](weather.ts) defines four represented weather kinds, four climates, monthly base temperatures, weather deltas, and the named warm default.
- [weather-system.ts](weather-system.ts) decrements the transition countdown once per tick and updates temperature from the current calendar month, climate, and weather kind. Transitions draw a non-repeating kind and schedule a new duration.
- The system uses `World.rng`; weather therefore participates in the same deterministic random stream as other simulation systems.
- Rain and storm currently share the guest-facing rain threshold. Uncovered thrill and coaster categories receive a scoring penalty for guests without an umbrella; weather does not yet implement rain shelter or other ride-demand effects.

### Things to Know

- The current four kinds map to sunny, cloudy, rain and thunderstorm temperature deltas. The remaining five original weather kinds, climate weather weights, 128-tick update cadence, and forecast transitions are not modeled.
- Scenario climate is saved and hashed. Missing climate in a pre-v15 save or scenario defaults to warm; the starter scenario names warm explicitly.
- Transition durations, transition probabilities, and ride-score penalty remain provisional OpenCoaster values. The current model does not implement weather visuals or shelter behavior.
- An umbrella flag belongs to the guest's stable id in [World](../core/world.ts), not its dense store slot. This keeps ownership attached to a guest when entity slots are swap-removed. The guest system deducts cash for a successful kiosk purchase and posts the price to `ShopSales`; nearby kiosks the guest cannot afford are skipped.
- This module only advances weather state. Kiosk purchases and ride preference effects are implemented by the guest system; rendering weather visuals and shelter behavior are not part of this module.

Created and maintained by Nori.

# Noridoc: Weather Simulation

Path: @/src/sim/weather

### Overview

- Holds the park's current weather kind, temperature, and ticks remaining before a transition.
- Seeds weather transitions from the world's shared pseudo-random generator so replays and saves preserve the same sequence.
- Guest ride scoring reads weather state to model a provisional rain preference effect.

### How it fits into the larger codebase

- [World](../core/world.ts) owns the serializable weather state; [Simulation](../core/simulation.ts) runs the weather system first in the fixed system order.
- [Guest behavior](../guests/guest-system.ts) reads the state when scoring rides and when a wandering guest in rain is adjacent to an open information kiosk and may buy an umbrella.
- Weather scalars are included in [world hashing](../core/hash.ts) and serialized by [save/load](../../save/save.ts), so continuing a save keeps the remaining transition countdown.
- The broader researched behavior and source confidence are tracked in [world mechanics](../../../docs/mechanics/world.md); implementation values are game tuning rather than claims about an original game's schedule.

### Core Implementation

- [weather.ts](weather.ts) defines the four weather kinds and initializes a sunny state with a temperature and transition countdown.
- [weather-system.ts](weather-system.ts) decrements the countdown once per tick. At transition it draws a new kind without immediately repeating the previous kind, selects a temperature, and schedules the next transition from named duration constants.
- The system uses `World.rng`; weather therefore participates in the same deterministic random stream as other simulation systems.
- Rain and storm currently share the guest-facing rain threshold. Uncovered thrill and coaster categories receive a scoring penalty for guests without an umbrella; weather does not yet implement rain shelter or other ride-demand effects.

### Things to Know

- Transition durations, temperature ranges, and ride-score penalty are provisional OpenCoaster values. The reachable sources do not establish exact state durations, transition probabilities, or numeric demand effects.
- An umbrella flag belongs to the guest's stable id in [World](../core/world.ts), not its dense store slot. This keeps ownership attached to a guest when entity slots are swap-removed. Kiosk purchases deduct guest cash but are not currently recorded as kiosk revenue in the economy ledger.
- This module only advances weather state. Kiosk purchases and ride preference effects are implemented by the guest system; rendering weather visuals and shelter behavior are not part of this module.

Created and maintained by Nori.

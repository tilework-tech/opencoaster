# Noridoc: Save and Load

Path: @/src/save

### Overview

- Serializes deterministic `World` state into a versioned binary format.
- Stores scalar and variable-size metadata in a JSON header followed by typed-array bytes.
- Migrates supported legacy guest, ride, and staff state before returning a playable world.

### How it fits into the larger codebase

- [World](../sim/core/world.ts) defines authoritative state; [hashWorld](../sim/core/hash.ts) covers persistent state so save/load continuation can be checked.
- Entity stores, the map, and track state provide arrays in a fixed order. Ledger, research, scenario, park gate, weather, patrol masks, and umbrella ownership are restored from header data or module helpers.
- Version 10 added five guest navigation columns; version 11 appends ride reliability, mode and mechanic-work columns; version 12 appends guest visit age, ride count and last-ride columns. The v12 migration converts pre-v12 hunger/thirst bytes into satiation values and maps the previous nausea-tolerance range into four buckets while preserving v10 navigation and v11 ride data. `guestColumnsAbsent` and `rideColumnsAbsent` omit trailing columns absent from each supported format; `migratePreReliabilityRides` initializes rides without version-11 data. Version 8 adds per-ride lifetime income; version 7 adds grounds and player staff names; version 6 adds patrol masks and stable-id umbrella flags. Older supported versions default absent fields and reconstruct weekly staff wages.
- Raw array layout changes require an explicit save version path and migration.

### Core Implementation

- [save.ts](save.ts) writes a magic value, header length, UTF-8 JSON header, then each typed-array view in deterministic order.
- [game-saves.ts](game-saves.ts) saves a running game into a slot record and defines the default slot name and export filename. [slot-store.ts](slot-store.ts) provides `SlotStore`, IndexedDB storage, and an in-memory fallback; slot metadata such as scenario id and display name stays outside the simulation bytes.
- Deserialization restores raw views, entity counts/free lists, legacy guest headings and ride data where needed, then restores economy, weather, research, scenario, and park state.
- Versions 3 through 12 are accepted. Versions 9 and older store research costs and progress in cents; versions 10 through 12 store work units. Older research converts at the old minimum rate on load. Economy and research additive fields default when absent. Version 3 uses a legacy ride layout; versions 3 and 4 omit guest headings and migrate guests to the current representation; version 5 has no patrol or umbrella fields; version 6 has no grounds or staff names; version 7 has no ride income column.
- Derived track paths are not serialized independently.

### Things to Know

- The header contains patrol masks, umbrella flags, grounds, and staff names for current saves. Version 8's ride income is a typed-array column; version 7 and earlier saves load with zero income.
- Array ordering returned by map, entity-store, and track helpers is part of the binary format.
- Deterministic continuation depends on restoring PRNG state, tick, weather countdown, persistent masks, entities, and economy/research/scenario state together.
- The serializer expects a structurally valid header and does not provide a general corruption-recovery layer.
- Player settings such as speed and pause are kept in browser `localStorage`; they are not part of save files. Import and load validate the save header before replacing the active simulation.

Created and maintained by Nori.

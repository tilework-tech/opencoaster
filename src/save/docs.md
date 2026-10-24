# Noridoc: Save and Load

Path: @/src/save

### Overview

- Serializes deterministic `World` state into a versioned binary format.
- Stores scalar and variable-size metadata in a JSON header followed by typed-array bytes.
- Migrates supported legacy guest, ride, and staff state before returning a playable world.

### How it fits into the larger codebase

- [World](../sim/core/world.ts) defines authoritative state; [hashWorld](../sim/core/hash.ts) covers persistent state so save/load continuation can be checked.
- Entity stores, the map, and track state provide arrays in a fixed order. Ledger, research, scenario, park gate, weather, patrol masks, and umbrella ownership are restored from header data or module helpers.
- Save version 8 adds the per-ride lifetime income column. Version 7 added per-tile `grounds` bytes and player staff names keyed by stable staff id; version 6 added patrol masks and stable-id umbrella flags. Older supported versions default fields absent from their layout and reconstruct weekly staff wages from restored staff roles.
- Raw array layout changes require an explicit save version path and migration.

### Core Implementation

- [save.ts](save.ts) writes a magic value, header length, UTF-8 JSON header, then each typed-array view in deterministic order.
- [game-saves.ts](game-saves.ts) saves a running game into a slot record and defines the default slot name and export filename. [slot-store.ts](slot-store.ts) provides `SlotStore`, IndexedDB storage, and an in-memory fallback; slot metadata such as scenario id and display name stays outside the simulation bytes.
- Deserialization restores raw views, entity counts/free lists, legacy guest headings and ride data where needed, then restores economy, weather, research, scenario, and park state.
- Versions 3 through 10 are accepted. Versions 9 and older store research invention costs and progress in cents; version 10 stores work units. Older research is converted at the old minimum rate on load (see [research.ts](../sim/research/research.ts)). Economy `difficultRating` and `campaignTarget`, and research `priority`, are additive fields that default when absent. Version 3 uses a legacy ride layout; versions 3 and 4 omit guest headings and migrate guests to the current representation; version 5 has the current array layout but no patrol or umbrella fields; version 6 has no grounds or staff names; version 7 has no ride income column, so it loads with zeroed income counters.
- Derived track paths are not serialized independently.

### Things to Know

- The header contains patrol masks, umbrella flags, grounds, and staff names for current saves. Version 8's ride income is a typed-array column; version 7 and earlier saves load with zero income.
- Array ordering returned by map, entity-store, and track helpers is part of the binary format.
- Deterministic continuation depends on restoring PRNG state, tick, weather countdown, persistent masks, entities, and economy/research/scenario state together.
- The serializer expects a structurally valid header and does not provide a general corruption-recovery layer.
- Player settings such as speed and pause are kept in browser `localStorage`; they are not part of save files. Import and load validate the save header before replacing the active simulation.

Created and maintained by Nori.

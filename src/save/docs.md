# Noridoc: Save and Load

Path: @/src/save

### Overview

- Serializes deterministic `World` state into a versioned binary format.
- Stores scalar and variable-size metadata in a JSON header followed by typed-array bytes.
- Migrates supported legacy guest, ride, and staff state before returning a playable world.

### How it fits into the larger codebase

- [World](../sim/core/world.ts) defines authoritative state; [hashWorld](../sim/core/hash.ts) covers persistent state so save/load continuation can be checked.
- Entity stores, the map, and track state provide arrays in a fixed order. Ledger, research, scenario, park gate, weather, patrol masks, and umbrella ownership are restored from header data or module helpers.
- Version 10 added five guest navigation columns; version 11 added ride reliability, mode and mechanic-work columns; version 12 added guest visit age, lifetime ride count and last-ride columns. Version 13 appends the four-entry guest ride-history ring and per-worker task-order flags. Version 14 appends the 60-bucket ride rider-history ring. Version 15 adds guest litter-memory and anger columns, staff sweep counts, litter birth order, and the weather climate in the header. Version 16 appends each staff member's stopped-vandal counter. Version 17 appends the per-element path surface style (tarmac, crazy paving, dirt); older saves load every path as tarmac. The v12 migration converts pre-v12 hunger/thirst bytes into satiation values and maps the previous nausea-tolerance range into four buckets while preserving earlier navigation and ride data. Version-specific staff views omit columns absent from older layouts; v15 staff migration preserves existing columns and initializes the new counter. `guestColumnsAbsent` and `rideColumnsAbsent` omit trailing columns absent from each supported format; `migratePreReliabilityRides` initializes rides without version-11 data. Older saves default absent columns and reconstruct weekly staff wages from restored staff roles. Version 8 adds per-ride lifetime income; version 7 adds grounds and player staff names; version 6 adds patrol masks and stable-id umbrella flags.
- Raw array layout changes require an explicit save version path and migration.

### Core Implementation

- [save.ts](save.ts) writes a magic value, header length, UTF-8 JSON header, then each typed-array view in deterministic order.
- [game-saves.ts](game-saves.ts) saves a running game into a slot record and defines the default slot name and export filename. [slot-store.ts](slot-store.ts) provides `SlotStore`, IndexedDB storage, and an in-memory fallback; slot metadata such as scenario id and display name stays outside the simulation bytes.
- Deserialization restores raw views, entity counts/free lists, legacy guest headings and ride data where needed, reconstructs litter ordering for pre-v15 saves, then restores economy, weather, research, scenario, and park state. A v15 save retains its staff columns while the v16 migration initializes the absent stopped-vandal counter. Saves without a climate retain the warm default.
- Versions 3 through 17 are accepted. Versions 9 and older store research invention costs and progress in cents; versions 10 through 17 store work units. Older research is converted at the old minimum rate on load (see [research.ts](../sim/research/research.ts)). Economy `difficultRating` and `campaignTarget`, and research `priority`, are additive fields that default when absent. Version 3 uses a legacy ride layout; versions 3 and 4 omit guest headings and migrate guests to the current representation; version 5 has the current array layout but no patrol or umbrella fields; version 6 has no grounds or staff names; version 7 has no ride income column, so it loads with zeroed income counters.

- Derived track paths are not serialized independently.

### Things to Know

- Save version 13 appends four recent ride-history columns to guests and a per-worker task-order bit field to staff. Version 14 appends ride rider-history columns. Version 15 adds world behavior state and climate; version 16 appends the per-guard stopped-vandal count; version 17 appends path surface styles. Versions 3 through 17 remain supported; earlier saves initialize columns absent from their layout, including zeroed v16 counters and tarmac paths.
- The header contains patrol masks, umbrella flags, grounds, and staff names for current saves. Version 8's ride income, version 14's rider history, version 16's staff counter and version 17's path styles are typed-array columns; older saves load absent columns with zero values.
- Array ordering returned by map, entity-store, and track helpers is part of the binary format.
- Deterministic continuation depends on restoring PRNG state, tick, weather countdown, persistent masks, entities, and economy/research/scenario state together.
- The serializer expects a structurally valid header and does not provide a general corruption-recovery layer.
- Player settings such as speed and pause are kept in browser `localStorage`; they are not part of save files. Import and load validate the save header before replacing the active simulation.

Created and maintained by Nori.

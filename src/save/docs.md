# save

Responsibility: binary serialisation of `World` (versioned header + raw typed-array columns), loading it back, header-only summaries for save listings, and the browser-side slot storage.

Contents: header JSON (scalars, ledger, research, scenario, track result) plus raw columns for the map, entity stores, track pieces and per-ride track tables. Derived track paths are rebuilt on demand.

Interface: `serialize(world): Uint8Array`, `deserialize(bytes): World`, `SAVE_VERSION`. Bump the version and add a migration when the schema changes; a loaded world must continue bit-identically.

Version 5 added the guest `heading` column and the `park` gate to the header. Saves from versions 3 and 4 still load: guests are read with the legacy column layout and given no heading, and the park starts without a gate.

Additional save and storage interfaces:

- `save.ts`: `serialize(world): Uint8Array`, `deserialize(bytes): World`, `SAVE_VERSION`, and `summarizeSave(bytes)` which reads only the header (version, tick, cash, loan). Bump the version and add a migration when the schema changes; a loaded world must continue bit-identically.
- `game-saves.ts`: `saveGameToSlot(source, store, request)` serialises a running game into a slot with listing details, `exportFileName` (the `.ocsave` download name) and `defaultSlotName`.
- `slot-store.ts`: the `SlotStore` interface (`list` newest first without bytes, `get`, `put`, `remove`). `openIndexedDbSlotStore()` is the browser implementation, one IndexedDB record per slot. `createMemorySlotStore()` has the same semantics for tests and for browsers without IndexedDB.

Decisions:

- Saves contain only sim state. Scenario definitions, player settings (game speed, pause) and slot names are not part of the binary; slot names and scenario ids live in the slot record. Player settings live in `localStorage`.
- Export and import use the same bytes as a slot. Import validates the header with `summarizeSave` before the worker loads it.

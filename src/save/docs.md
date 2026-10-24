# save

Responsibility: binary serialisation of `World` (versioned header + raw typed-array columns) and loading it back.

Contents: header JSON (scalars, ledger, research, scenario, track result) plus raw columns for the map, entity stores, track pieces and per-ride track tables. Derived track paths are rebuilt on demand.

Interface: `serialize(world): Uint8Array`, `deserialize(bytes): World`, `SAVE_VERSION`. Bump the version and add a migration when the schema changes; a loaded world must continue bit-identically.

Version 5 added the guest `heading` column and the `park` gate to the header. Saves from versions 3 and 4 still load: guests are read with the legacy column layout and given no heading, and the park starts without a gate.

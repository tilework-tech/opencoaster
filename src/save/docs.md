# save

Responsibility: binary serialisation of `World` (versioned header + raw typed-array columns) and loading it back.

Contents: header JSON (scalars, ledger, research, scenario, track result) plus raw columns for the map, entity stores, track pieces and per-ride track tables. Derived track paths are rebuilt on demand.

Interface: `serialize(world): Uint8Array`, `deserialize(bytes): World`, `SAVE_VERSION`. Bump the version and add a migration when the schema changes; a loaded world must continue bit-identically.

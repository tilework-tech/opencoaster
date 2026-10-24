# save

Responsibility: binary serialisation of `World` (versioned header + raw typed-array columns) and loading it back.

Interface: `serialize(world): Uint8Array`, `deserialize(bytes): World`, `SAVE_VERSION`. Bump the version and add a migration when the schema changes; a loaded world must continue bit-identically.

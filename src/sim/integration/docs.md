# Noridoc: Integration tests

Path: @/src/sim/integration

### Overview

- Cross-module tests that run the whole `Simulation` rather than a single system.
- [park.test.ts](park.test.ts) builds a small park (gate, footpath loop, merry-go-round with a queue, food stall) and runs it for in-game days: guests must ride and buy, the ledger must move, the rating must stay in range, two runs must hash identically, and a save/load round trip must continue identically. Without a gate nobody arrives.
- [fixtures.ts](fixtures.ts) holds the helpers other tests reuse: a flat owned map, path laying, `openRide` (create, entrance/exit, queue, open) and `legacyGuestArrays` for building pre-version-5 saves.

Created and maintained by Nori.

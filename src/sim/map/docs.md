# Noridoc: Simulation Map

Path: @/src/sim/map

### Overview

- Owns the deterministic tile map: terrain, water, ownership, walkable paths, and stacked map elements.
- Validates map edits and applies their economy charges through the map command boundary.
- Provides path additions for bins and benches, which are stored as flags and data on path elements; bins receive trash, while benches currently have no simulation or rendering behavior.

### How it fits into the larger codebase

- [World](../core/world.ts) owns `TileMap`; [Simulation](../core/simulation.ts) applies [map commands](map-commands.ts) before the ordered simulation systems run.
- [Pathfinding](../pathfinding/docs.md) and guest/staff systems query walkability and connected path edges. Guests add trash/vomit using the map's path and bin queries; handymen locate and empty filled bins.
- Map arrays feed [world hashing](../core/hash.ts) and [save serialization](../../save/save.ts). `revision` is runtime metadata used by worker map snapshots and staff's cached bin index, so it is not persisted.
- The [UI](../../ui/docs.md) sends path, bin, and bench placement as commands; the UI status reports a request, while invalid or unaffordable map commands are silently ignored.

### Core Implementation

- [tile-map.ts](tile-map.ts) stores shared terrain corner heights and derived tile heights/slopes, ownership and surface arrays, plus a fixed-capacity pool of stacked elements linked per tile. `arrays()` supplies persistent arrays to hashing and save code.
- [land.ts](land.ts) implements terrain, water, and ownership operations. Terrain edits preserve the one-level neighbor slope invariant and roll back when an element would be buried or invalidly tilted.
- [paths.ts](paths.ts) places/removes flat or one-level ramp path elements, recomputes edge connectivity, and attaches `Bin` or `Bench` flags to the lowest path selected by the path query. Bin fill is stored in that element's data byte; trash deposited in a bin accumulates up to the implementation's fixed capacity, and a handyman empties it.
- [map-commands.ts](map-commands.ts) validates affordability for paid land, terrain, water, and path edits, records charges in the ledger, and routes path-addition commands. Path additions currently have no separate charge.
- `surface` is a derived draw class; path elements remain the source of path connectivity and height. Elevated pieces can coexist with lower elements where clearances permit.

### Things to Know

- Stored simulation values are integers and map state is deterministic. Do not write derived tile heights/slopes directly; update terrain through its operations so neighboring tiles stay consistent.
- Tile elements are pool slots, not stable IDs. A path addition modifies flags/data on a particular path element; `setPathAddition` requires an in-bounds buildable tile with a path.
- Bins currently collect guest trash only. Vomit remains a separate litter entity; benches are placeable path additions but have no simulation or rendering effect yet.
- The map does not yet implement tunnels, path railings, path litter/vomit counters, item repair or vandalism, or rendering of elevated path pieces. See [world mechanics](../../../docs/mechanics/world.md) for researched behavior and the boundary between sources and current game tuning.

Created and maintained by Nori.

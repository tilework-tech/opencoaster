# Noridoc: Simulation Map

Path: @/src/sim/map

### Overview

- Owns the deterministic tile map: terrain, water, ownership, walkable paths, and stacked map elements.
- Validates map edits and applies their economy charges through the map command boundary.
- Stores mutually exclusive bin, bench, rain shelter, and lamp additions as flags on path elements; guest and staff systems supply the additions' gameplay effects.

### How it fits into the larger codebase

- [World](../core/world.ts) owns `TileMap`; [Simulation](../core/simulation.ts) applies [map commands](map-commands.ts) before the ordered simulation systems run.
- [Pathfinding](../pathfinding/docs.md) and guest/staff systems query walkability and connected path edges. Guests add trash/vomit using the map's path and bin queries; handymen locate and empty filled bins.
- Map arrays feed [world hashing](../core/hash.ts) and [save serialization](../../save/save.ts). `revision` is runtime metadata used by [worker map snapshots](../../worker/map-data.ts) and staff's cached bin index, so it is not persisted.
- The [UI](../../ui/docs.md) sends path, bin, bench, shelter, and lamp placement as commands; flower beds are stored separately in `World.grounds` by the staff grounds system.

### Core Implementation

- [tile-map.ts](tile-map.ts) stores shared terrain corner heights and derived tile heights/slopes, ownership and surface arrays, plus a fixed-capacity pool of stacked elements linked per tile. Ownership starts clear; `canBuild` accepts tiles marked as owned or with construction rights. `arrays()` supplies persistent arrays to hashing and save code.
- [land.ts](land.ts) implements terrain, water, and ownership operations. Rectangle raises select the lowest tiles and lowers select the highest; only unique corners of those tiles are charged and moved, while an explicit corner edit changes one corner. Terrain edits preserve the one-level neighbor slope invariant and roll back when an element would be buried or invalidly tilted. Successful terrain edits remove litter from affected tiles.
- [paths.ts](paths.ts) places/removes flat or one-level ramp path elements, recomputes edge connectivity, and attaches one of `Bin`, `Bench`, `Shelter`, or `Lamp` flags to the lowest path selected by the path query. Bin fill is stored as one count on that path element; the four-corner bin occupancy model is deferred. Trash deposited in a bin accumulates up to its capacity, and a handyman empties it.
- [map-commands.ts](map-commands.ts) validates affordability for land, terrain, water, and path edits, records charges in the ledger, and routes path-addition commands. Ownership distinguishes owned land, construction rights, and land or rights offered for sale; buying a rectangle acquires only matching sale tiles. Prices are named fixed constants at present: terrain height changes cost 500 cents per selected unique corner, water changes cost 250 cents per changed tile, land costs 10,000 cents per tile and construction rights 4,000 cents per tile. Scenario-configured land prices and purchase UI remain unimplemented. Path additions currently have no separate charge.
- `surface` is a derived draw class; path elements remain the source of path connectivity and height. Elevated pieces can coexist with lower elements where clearances permit.

### Things to Know

- Stored simulation values are integers and map state is deterministic. Do not write derived tile heights/slopes directly; update terrain through its operations so neighboring tiles stay consistent.
- Tile elements are pool slots, not stable IDs. A path addition modifies flags/data on a particular path element; `setPathAddition` requires an in-bounds buildable tile with a path. Vandalism marks a bench, bin, or lamp broken in a reserved payload bit while retaining its addition and contents; placing the path piece again clears the broken state. Broken bins do not accept litter and are not handyman emptying targets.
- Bins collect trash; benches and bins can be vandalized by guests, and nearby shelters prevent rain-related happiness loss. Lamp additions are stored on paths for rendering. These effects are implemented by [guests](../guests/docs.md) and [staff](../staff/docs.md), not by the map storage itself.
- Flower beds and grass care live in `World.grounds` and are handled by the staff grounds system; they are not path additions or part of the map arrays. [scenery-effects.ts](scenery-effects.ts) provides a clipped 10×10 scan of small/large scenery and broken paths for guest surroundings; litter is supplied by the guest system. Scenery object identity, placement, fountain/music effects, scenario land prices and controls remain outside this module. See [world mechanics](../../../docs/mechanics/world.md) for researched behavior and project tuning.

Created and maintained by Nori.

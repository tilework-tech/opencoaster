# Noridoc: Simulation Map

Path: @/src/sim/map

### Overview

- Owns the deterministic tile map: terrain, water, ownership, walkable paths, and stacked map elements.
- Validates map edits and applies their economy charges through the map command boundary.
- Stores path surface style and scenery as map-element state, alongside bin, bench, rain shelter, and lamp additions on path elements.

### How it fits into the larger codebase

- [World](../core/world.ts) owns `TileMap`; [Simulation](../core/simulation.ts) applies [map commands](map-commands.ts) before the ordered simulation systems run.
- [Pathfinding](../pathfinding/docs.md) and guest/staff systems query walkability and connected path edges. Guests add trash/vomit using the map's path and bin queries; handymen locate and empty filled bins.
- Map arrays feed [world hashing](../core/hash.ts) and [save serialization](../../save/save.ts). `revision` is runtime metadata used by [worker map snapshots](../../worker/map-data.ts) and staff's cached bin index, so it is not persisted.
- The [UI](../../ui/docs.md) sends path style, queue-path, scenery, and path-addition placement as commands. Flower beds can also be represented in `World.grounds` for grass care; placeable flower-bed scenery is a separate map element.

### Core Implementation

- [tile-map.ts](tile-map.ts) stores shared terrain corner heights and derived tile heights/slopes, ownership and surface arrays, plus a fixed-capacity pool of stacked elements linked per tile. Ownership starts clear; `canBuild` accepts tiles marked as owned or with construction rights. `arrays()` supplies persistent arrays to hashing and save code.
- [land.ts](land.ts) implements terrain, water, and ownership operations. Rectangle raises select the lowest tiles and lowers select the highest; an edit plan simulates the operation, measures all actual vertex-height changes after neighbor propagation, and derives the affected tiles. Terrain edits preserve the one-level neighbor slope invariant and roll back when an element would be buried or invalidly tilted. The map-command boundary prices the changed height units and removes litter from every affected tile.
- [paths.ts](paths.ts) places/removes flat or one-level ramp path elements. A placement without an explicit slope follows the terrain: flat ground gets a flat piece, a one-level slope gets a ramp facing its rise, and any other shape is refused as `UnevenGround`. `placePathOutcome` returns a `PathResult` naming the refusal; `placePath` is its boolean form. It recomputes edge connectivity, and attaches one of `Bin`, `Bench`, `Shelter`, or `Lamp` flags to the lowest path selected by the path query. Bin fill is stored as one count on that path element; the four-corner bin occupancy model is deferred. Trash deposited in a bin accumulates up to its capacity, and a handyman empties it.
- Path elements persist a surface style (tarmac, crazy paving, dirt) in `TileMap.pathStyle`; queue paths use a path flag and stay distinct from style.
- [scenery.ts](scenery.ts) defines placeable trees, shrubs, gardens, and fences; checks rotation, bounds, ownership/build rights, dry land, and element clearances; and stores the item and rotation as a small-scenery element. `placeScenery`/`removeScenery` commands charge the landscaping ledger with project-tuned (not original) prices.
- [map-commands.ts](map-commands.ts) validates affordability and ownership for terrain commands, validates affordability for land, water, and path edits, records charges in the ledger, and routes path-addition commands. Terrain planning counts propagated changes before applying an edit; `setTileHeight` also requires the tile to be owned. Ownership distinguishes owned land, construction rights, and land or rights offered for sale; buying a rectangle acquires only matching sale tiles. Prices are named fixed constants at present: terrain changes cost 500 cents per changed height unit, water changes cost 250 cents per changed tile, land costs 10,000 cents per tile and construction rights 4,000 cents per tile. Scenario-configured land prices and purchase UI remain unimplemented. Path additions currently have no separate charge.
- `surface` is a derived draw class; path elements remain the source of path connectivity and height. Elevated pieces can coexist with lower elements where clearances permit.

### Things to Know

- Stored simulation values are integers and map state is deterministic. Do not write derived tile heights/slopes directly; update terrain through its operations so neighboring tiles stay consistent.
- Tile elements are pool slots, not stable IDs. A path addition modifies flags/data on a particular path element; `setPathAddition` requires an in-bounds buildable tile with a path. Vandalism marks a bench, bin, or lamp broken in a reserved payload bit while retaining its addition and contents; placing the path piece again clears the broken state. Broken bins do not accept litter and are not handyman emptying targets.
- Bins collect trash; benches, bins, and lamps can be marked broken by guest vandalism. Shelter additions are stored on paths, but no current guest system applies a shelter effect. These behaviors are implemented by [guests](../guests/docs.md) and [staff](../staff/docs.md), not by map storage itself.
- Flower beds and grass care live in `World.grounds` and are handled by the staff grounds system; they are not path additions or part of the map arrays. [scenery-effects.ts](scenery-effects.ts) provides a clipped 10×10 scan of small/large scenery and broken paths for guest surroundings; litter is supplied by the guest system. Scenery object identity, placement, fountain/music effects, scenario land prices and controls remain outside this module. See [world mechanics](../../../docs/mechanics/world.md) for researched behavior and project tuning.

Created and maintained by Nori.

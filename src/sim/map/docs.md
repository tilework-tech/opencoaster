# sim/map

Responsibility: the tile-element-stack map (engine spec "World grid and tile-element stacks", world spec 2.6/2.7): terrain with corner slopes, water, land ownership, footpaths, and the commands that edit them. Deterministic, integer-only, allocation-free queries.

## Data model (`TileMap`)

- **Terrain** is a `(width+1) x (height+1)` grid of corner heights (`vertexHeights`, levels 0..31, `Z_STEP` units each), so neighbouring tiles share corners by construction. Invariant: every tile spans at most one level, i.e. any two vertices that share a tile differ by at most 1. `heights[i]` is the lowest corner; `slope[i]` has bit `c` set when corner `c` is one level above it. Corners: 0 = (x,y), 1 = (x+1,y), 2 = (x+1,y+1), 3 = (x,y+1). Derived by `refreshTile`; never write them directly.
- `terrain` is the land type (grass, sand, dirt, rock); `surface` is the derived draw class (`Surface`: path/queue beats water beats terrain). `waterLevel[i]` is the water surface level (0 = none); water shows when it exceeds `heights[i]`.
- `ownership[i]`: `OWNED`, `RIGHTS_OWNED` (build above ground only), `SALE_LAND`, `SALE_RIGHTS`. Terrain/water/paint edits need `OWNED`; elements need `OWNED` or `RIGHTS_OWNED`. The outermost `MAP_BORDER` ring is never owned.
- **Elements** (paths now; track, scenery, entrances later) live in a fixed-capacity pool of parallel typed arrays (`elType/elBase/elClear/elFlags/elData/elNext`) with a per-tile linked list (`tileHead`) sorted by base level. Freed slots are reused. `addElement` returns -1 when the pool is full. `[elBase, elClear)` is the occupied level range; the ground is not an element.
- Path `elFlags` (`PathFlag`): joined-edge mask (bits 0-3, derived), forced-edge mask (bits 4-7, set by ride entrances via `setForcedEdges`), queue, ramp, ramp direction. Edge bit `1 << dir`, dir 0 = +x, 1 = +y, 2 = -x, 3 = -y.
- `flags[i]` stays a free per-tile byte for other modules. `revision` increments on any visible change (the worker re-sends the map when it moves); it is not saved.
- All typed arrays are listed by `arrays()`, which feeds `hashWorld` and the save format.

## Queries (no allocation)

`isWalkable(i)`, `pathEdges(i)` / `pathEdgesOf(el)`, `pathElement(i, z)`, `isQueue(i)`, `neighbor(i, dir)`, `canBuild(i)`, `terrainHeightAt(xu, yu)` (bilinear over the four corners), `heightAt(xu, yu)` (walking surface: the tile's lowest path if present, else ground), `pathHeightAt(el, xu, yu)`. Positions are fixed-point (`TILE_UNITS` per tile); results are `Z_STEP` units.

## Rules

- **Land edits** (`raiseLand`/`lowerLand`): move every vertex of an owned rectangle one level, or one corner of a single tile. Neighbouring vertices are dragged to restore the smoothness invariant (order-independent closure), which may alter unowned tiles. The edit is rolled back if any affected tile would bury or tilt an element: a path must rest on a matching surface (flat on flat, ramp on its matching slope) or sit at/above the tile's highest corner; other elements must not straddle the surface.
- **Paths** (`placePath`/`removePath`): a piece is flat or a ramp rising one level toward a direction. Must be at or above ground per the rule above, not under water, within `MAX_ELEMENT_BASE`, and not overlap another element's range (`PATH_CLEARANCE` = 2 levels, +1 for ramps). Placing on an existing piece at the same base replaces its queue/ramp state. Pieces auto-connect to a neighbour when the shared edge heights match; ramps connect only at their two ends. Elevated pieces stack above ground pieces.
- **Buying**: `buyLand` buys `SALE_LAND` (or `SALE_RIGHTS` with `rights`) tiles in a rectangle atomically against available cash.
- Money goes through `record(..., LedgerCategory.Construction, -cents)`; prices are the tunable constants in `tile-map.ts`. Removing a path refunds nothing.

## Commands (`MapCommand`, part of the core `Command` union)

`setTileHeight` (debug; ignores ownership), `raiseLand`, `lowerLand`, `setWater`, `paintLand`, `placePath`, `removePath`, `buyLand`. Invalid or unaffordable commands are silently ignored.

## Generation

`generateTerrain` samples a coarse random grid at tile corners, relaxes it to the smoothness invariant, floods tiles below `SEA_LEVEL`, and owns the central half of the map; the rest inside the border is for sale.

## Not done

Steep (two-level) diagonal slopes, tunnels/underground paths, path railings and additions (benches, bins), path litter/vomit counters, partial-tile water, refunds, and rendering of elevated path pieces (the renderer only sees `surface`, `heights`, `slope`).

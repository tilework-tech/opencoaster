# Noridoc: Staff Simulation

Path: @/src/sim/staff

### Overview

- Owns staff entity data, hiring, firing, names, patrol assignment, staff job updates, and the per-tile ground care state (grass overgrowth and flower beds).
- Staff state is part of the worker-owned deterministic `World`; hiring, firing, renaming, flower-bed and patrol changes arrive as simulation commands.
- Jobs: handymen clean litter, empty bins, water flower beds and mow grass; mechanics repair broken rides and run inspections on each ride's interval; entertainers raise nearby guests' happiness; security guards wander their patrol and deter vandalism (see [guests](../guests/docs.md)).

### How it fits into the larger codebase

- [World](../core/world.ts) owns the staff store, four persistent patrol masks (one per role), the `grounds` byte per tile, and the player-given `staffNames` map. Staff entities retain their role's area id; unassigned staff are unrestricted.
- [Simulation](../core/simulation.ts) applies hire, fire, rename, patrol-tile and flower-bed commands at tick boundaries. The [UI](../../ui/game-ui.ts) selects a role for patrol painting and [main thread input](../../main.ts) turns map clicks into those commands. The [staff roster](../../ui/staff-roster.ts) lists each person with rename and fire controls.
- The system uses [pathfinding](../pathfinding/navigate.ts) for staff movement and calls [ride operations](../rides/ride-operations.ts) when a mechanic reaches a ride service tile.
- Hiring and firing adjust the monthly wage input in [economy inputs](../economy/ledger.ts). Planting a flower bed charges `Landscaping` through [economy api](../economy/api.ts).
- Patrol masks, staff columns, names and grounds are deterministic world state: masks, columns and grounds are included in [world hashing](../core/hash.ts) and [save files](../../save/save.ts). Names are saved but do not affect the simulation.
- The [snapshot](../../worker/snapshot.ts) publishes staff ids, names and the grounds byte per tile so renderers and the staff roster can read them without touching sim state.

### Core Implementation

- [staff-store.ts](staff-store.ts) defines `StaffKind`, the struct-of-arrays schema, spawn/hire/fire operations, monthly wage rates, `renameStaff` (trims, collapses spaces, caps at 24 characters; blank clears), and the patrol-tile commands. Firing drops the staff member's name.
- [grounds.ts](grounds.ts) defines the `grounds` byte: low nibble is grass overgrowth (0 mown to 15), `FLOWER_BED` marks a planted bed and `FLOWER_BED_THIRSTY` a bed that needs water. Only grass that no path covers counts as a site. `growGrounds` runs every 1,024 ticks: grass grows one step, and each unwatered bed has a one-in-four chance to become thirsty. Planting costs `FLOWER_BED_COST_CENTS`.
- [staff-system.ts](staff-system.ts) calls `growGrounds` every tick, then updates each staff member when `(tick + stable staff id) % 16 === 0`. A movement update advances 48 world units toward the target; if pathfinding cannot return a direction, movement may relocate directly to the nearest walkable tile within the patrol. The system caches walkable tiles and path-bin locations by both `World.map` identity and map revision, and reuses navigation options and typed-array indexes for litter and guests.
- Handymen only perform task selection while standing on a walkable path. Each tick with litter and at least one handyman, the system rebuilds a tile-to-litter linked index using stable litter ids and per-tile generation stamps. Litter search is limited to three tiles horizontally (Chebyshev distance), with each height level counting as four tiles; targets must be reachable and inside the patrol. A seeded roll may defer litter work (more often on queues), then task priority continues to garden work (a thirsty flower bed, or grass with overgrowth at or above `MOW_THRESHOLD`) within a 10-tile square, then a reachable non-empty, unbroken bin. Garden work targets a walkable, reachable tile beside the site; the handyman works the site on arrival. An idle handyman wanders only when assigned a patrol.
- Mechanics consider rides that are `Broken` and rides whose inspection is due. Broken rides take priority over inspection-only rides; within a group the nearest reachable one is chosen. A mechanic seeks a walkable service tile adjacent to the ride (for a track ride, to its exit) and inside its patrol, and calls `serviceRide` on every update while there. After the repair or inspection time has passed (see the [rides module](../rides/docs.md)) a broken ride reopens when its queue is connected, and an inspection restores part of the missing reliability. A repaired coaster keeps its test, so no close-and-retest is needed.
- Entertainers and security guards both choose walkable destinations inside their patrol (or anywhere walkable when unrestricted) on the `(tick + stable staff id) % 80 === 0` phase. Only entertainers add happiness, to guests on tiles within two tiles in either axis. The first entertainer working in a tick builds a reusable guest-by-tile index; later entertainers reuse it that tick.

### Things to Know

- Task orders are stored per worker and persisted from save version 13. Older saves initialize the available orders for each worker's role. Disabled orders prevent the corresponding litter, garden, bin, ride-inspection, repair, vandalism-watch, or entertainment work.

- `patrolArea` is an area id, not an entity id. Each role has one mask; `setStaffPatrolTile` edits the mask of the person's role, so per-person commands and role painting share the same area. Removing the last marked tile returns that role's staff to unrestricted movement. Per-person masks would need storage beyond the four areas.
- Movement falls back to a direct relocation onto the nearest walkable marked tile when pathfinding cannot return a direction. Patrol masks constrain staff destinations and pathfinding, but are not a generic job-assignment system.
- Staff wages are monthly integer-cent rates. The handyman rate follows the cited $50 monthly reference; mechanic, entertainer and security salaries are named OpenCoaster assumptions.
- Staff names are player-given strings held in `World.staffNames`, not in the typed-array store. Renaming to blank removes the name; firing removes it too.
- Ground and flower-bed state is included in snapshots, while this module owns its growth and watering simulation. Lamps are visual path additions and have no staff maintenance job.

Created and maintained by Nori.

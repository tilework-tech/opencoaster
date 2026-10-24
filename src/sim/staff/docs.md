# Noridoc: Staff Simulation

Path: @/src/sim/staff

### Overview

- Owns staff entity data, hiring and firing operations, patrol assignment, and staff job updates.
- Staff state is part of the worker-owned deterministic `World`; hiring and patrol changes arrive as simulation commands.
- The current job loop implements handyman litter cleanup and bin emptying, mechanic ride inspections and recovery, and a small entertainer happiness effect.

### How it fits into the larger codebase

- [World](../core/world.ts) owns the staff store and four persistent patrol masks. The UI assigns masks by staff kind; staff entities retain an area id, and unassigned staff are unrestricted.
- [Simulation](../core/simulation.ts) applies hire, fire, and patrol-tile commands at tick boundaries. The [UI](../../ui/game-ui.ts) selects a staff kind and [main thread input](../../main.ts) turns map clicks into those commands.
- The system uses [pathfinding](../pathfinding/navigate.ts) for staff movement and calls [ride operations](../rides/ride-operations.ts) when a mechanic reaches a ride inspection target.
- Hiring and firing adjust the weekly wage input in [economy inputs](../economy/ledger.ts); the economy system charges that amount weekly and records it in its monthly ledger. Loading older saves recalculates the input from saved staff kinds.
- Patrol masks and staff columns are deterministic world state, included in [world hashing](../core/hash.ts) and [save files](../../save/save.ts).

### Core Implementation

- [staff-store.ts](staff-store.ts) defines `StaffKind`, the struct-of-arrays schema, spawn/hire/fire operations, weekly wage rates, and commands that set individual or staff-kind patrol tiles. Hiring adds the matching wage; firing subtracts it.
- [staff-system.ts](staff-system.ts) updates each staff member when `(tick + stable staff id) % 16 === 0`, spreading work across ticks. A movement update advances 48 world units in the chosen path direction; if pathfinding cannot return a direction, movement may relocate directly to the nearest walkable tile within the patrol. Entertainers apply their happiness effect on the separate `(tick + stable staff id) % 80 === 0` phase. The system caches walkable tiles and path-bin locations by both `World.map` identity and map revision.
- Handymen only perform task selection while standing on a walkable path. Their litter lookup indexes litter by tile, then searches outward over walkable tiles in the current path network, constrained by patrol when assigned; `isReachable` filters out disconnected paths. They move to the selected litter and remove it on arrival. When no reachable litter is in scope, they seek a non-empty bin and clear its stored count. An idle handyman wanders only when assigned a patrol; an unrestricted idle handyman stays in place.
- Mechanics scan broken or inspection-due rides and seek a walkable service tile adjacent to the ride and inside their patrol. A mechanic outside its active patrol first moves back onto a patrol tile before servicing a ride. When the mechanic is already on a path, candidate service tiles must be reachable from its current tile; when off-path, the system cannot check that route first and selects an adjacent patrol path before movement tries to reach it. The mechanic calls `inspectRide` on arrival. That ride operation restores reliability and reopens a repaired ride when its queue is connected.
- Entertainers choose walkable destinations inside their assigned patrol mask (or anywhere walkable when unrestricted) and raise happiness for nearby guests on their ID-phased periodic work tick. Security staff currently have no job effect in this system.

### Things to Know

- `patrolArea` is an area id, not an entity id. The staff-kind patrol command maps the four roles to the four masks; removing the last marked tile returns that role's staff to unrestricted movement.
- Movement falls back to a direct relocation onto the nearest walkable marked tile when pathfinding cannot return a direction. Patrol masks constrain staff destinations and pathfinding, but are not a generic job-assignment system.
- Staff wages are named per-week integer-cent rates. They are OpenCoaster tuning values; the handyman rate is a weekly conversion of the cited $50 monthly reference, while unsupported role salaries remain provisional.
- Handyman watering and mowing, security deterrence, separate mechanic modes, and staff firing controls in the UI are not implemented. The game has no vandalism simulation for security to affect; the staff panel exposes hiring and patrol selection only.

Created and maintained by Nori.

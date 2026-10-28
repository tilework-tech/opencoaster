# Staff behaviour and guest feedback

Behaviour reference for the four staff roles and the guest reactions that tell a player when staff are missing. The behaviour was read from OpenRCT2's public source as a reference and restated here in our own words; none of its code or data is copied. OpenRCT2 is a reimplementation of the original game and is not proof of exact vanilla parity (it notes a few deliberate changes, flagged below). Numbers use OpenRCT2 world units where a tile is 32 units; OpenCoaster tiles are 256 units, so lengths are quoted in tiles.

Sources (OpenRCT2, `develop`, read 2026-10-28):

- Staff behaviour: <https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/entity/Staff.cpp> and `Staff.h`.
- Guest thoughts, vandalism and vomit: <https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/entity/Guest.cpp>, `Peep.cpp` (path-sight checks in `PeepFootpathMoveForward`).
- Hiring, energy: <https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/actions/peep/StaffHireNewAction.cpp>.
- Staff window text and statistics: <https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2-ui/windows/Staff.cpp> and `data/language/en-GB.txt`.
- Mechanic calls: <https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/ride/Ride.cpp>.
- Player-facing description: <https://docs.openrct2.io/en/latest/playing/staff/> (no numbers).
- Not read: the RCT2 manual and fan wikis (the wiki returned HTTP 402).

## Energy and walking speed

- Every worker is hired with energy 96 and it never changes. A worker takes a movement step on a tick when an 8-bit counter, which gains `energy` per tick, overflows: 96/256 = 0.375 steps per tick. All roles walk at the same speed.
- Slopes and slow-walking halve the step rate.
- Security guards check every 128 ticks for 20 or more walking guests within 3 tiles at the same height and then walk at half speed until the crowd thins.
- OpenCoaster: one step is a 32nd of a tile, so the speed is 3 world units per tick (48 per 16-tick update). Sloped paths are not halved.

## Wandering

- Staff with no patrol area still stay on land the player owns. A worker stranded outside its patrol area roams freely until it re-enters.
- An idle worker picks a random path edge at each tile and avoids turning back unless at a dead end (mechanics continue straight about half the time).
- OpenCoaster: an idle worker without work walks to a random walkable tile inside its patrol (anywhere when it has none) and repeats; it does not model the per-tile edge rule or the owned-land restriction.

## Handyman

Order switches: sweep footpaths, water gardens, empty litter bins, mow grass (OpenCoaster adds mow grass as its own order; it was previously folded into garden care). Priority at each decision: sweep, then mow, then empty a bin, then water.

- **Sweep.** Litter within 3 tiles (distance counts height as four tiles per level) in the patrol is steered towards on about 90% of choices, but only about 10% on ride queues. A sweep removes every litter and vomit piece at the worker's tile. The litter-swept counter ticks per sweep.
- **Mow.** Grass at length 2 or more (of 0 to 6) on a tile that can grow grass. Mowing waits until the worker has taken 12 tile steps since it last swept, emptied a bin or watered. The counter ticks per tile mown.
- **Bins.** A bin keeps two bits per side (3 empty, 0 full). A worker only goes for a bin once a side is completely full; it empties all sides.
- **Water.** Scenery flagged as waterable is watered when its age reaches 40 steps (orthogonal neighbours) or 55 (diagonals).
- Statistics: lawns mown, gardens watered, litter swept, bins emptied.
- OpenCoaster differences: workers stay on paths and work a site from the path tile beside it, searching up to 10 tiles for a mowable lawn or thirsty flower bed; grass growth (one step per 1,024 ticks, mowable at 8 of 15) and flower beds are the project's own ground model rather than scenery age; the first 12 mowing steps count from hire.

## Mechanic

- Switches: inspect rides, fix rides. A break-down call is answered by the nearest (Manhattan distance) patrolling mechanic with fixing enabled whose ride exit is in its patrol; a call can pull a mechanic off an inspection trip not yet at the ride. A mechanic gives up after 2,500 updates.
- Inspection intervals are 10, 20, 30, 45, 60 or 120 minutes, or never. An inspection raises reliability by a random share of a quarter of the shortfall; a fix by `energy` times half of the shortfall percent.
- Statistics: rides inspected, rides fixed (counted when the work completes).
- OpenCoaster: see [rides.md](rides.md) for the repair model. The 2,500-update give-up is not modelled.

## Security guard

- No orders. A guard stops a vandalism attempt when it is strictly less than 7 tiles away (square distance) from the guest, whatever its patrol, and the nearest guard in the list is credited with one stopped vandal.
- Attempts need happiness under 48, energy 85 or more, a recent litter or vomit sighting and a 5% roll (an angry guest skips the first three).
- Staff do not repair vandalised items in the code read.

## Entertainer

- Each time an entertainer chooses a new destination there is a 25% chance of a wave. A wave affects guests within 3 tiles in each axis on the same floor: walking guests gain 4 happiness target, queuing guests gain 3 and 200 ticks come off their queue wait. The guests-entertained counter ticks per guest affected.

## Guest thoughts about litter, vomit and vandalism

Checked when a guest steps onto a new path tile.

- **Litter.** Litter on a tile counts up to 3. The counts of the last 3 tiles are summed; at 3 or more a roll of about 1 in 6 gives the thought "The litter here is really bad" and lowers the happiness target by 17. A raised complaint leaves a short memory that also feeds vandalism, and fades with about a 1 in 15 chance per step.
- **Vomit.** The same, counting vomit separately: "This path is disgusting".
- **Vandalism.** A broken path addition marks the tile. Two or more such tiles among the last six, with the complaint not on cooldown, give the same 1 in 6 roll for "The vandalism here is really bad" and -17; the cooldown is set to 3 whether or not the thought fires and fades like the others.
- Vomit comes from guests whose nausea is above 128: a walking guest throws up on a roll of 0 to 255 at or below `(nausea - 128) / 2`.
- Park-wide complaint news (monthly) is based on the share of guests whose latest thought is one of these; OpenCoaster does not post it yet.

## Staff window

Every role lists wages and the month hired. Handymen: lawns mown, gardens watered, litter swept, bins emptied. Mechanics: rides inspected, rides fixed. Security: vandals stopped. Entertainers: guests entertained. There is no hedge-trimming task or counter.

## Not verified

- Animation lengths and per-task durations, the repair durations of mechanics, the default order set of a new hire, grass regrowth timing and scenery ageing intervals, and original-game (as opposed to OpenRCT2) behaviour.
- OpenCoaster values for those are project tuning.

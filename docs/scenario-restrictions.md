# Scenario restrictions

A scenario file may carry an optional root object `restrictions`. Each field is optional; a
missing field, or a missing `restrictions` object, means that rule does not apply. The parser
rejects unknown keys and out-of-range values with an error that names the scenario and field.
Sandbox and imported parks are always unrestricted.

```json
"restrictions": {
  "forbidTreeRemoval": true,
  "forbidLandscaping": true,
  "maxConstructionHeight": 6,
  "forbiddenRideTypeIds": [16, 17],
  "forbidMarketing": true
}
```

The TypeScript type is `ScenarioRestrictions` in `src/sim/scenario/restrictions.ts`.

## Rules

| Field                   | Type             | What it blocks                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forbidTreeRemoval`     | boolean          | Removing a tree in any way. A single-item removal of a tree is refused. The Clear scenery tool still clears everything else in the square and leaves the trees standing; a square that holds only trees is refused. A land edit that would remove a tree is refused. Rides, track and paths never clear scenery automatically: a tree blocks them. Non-tree scenery can still be removed. |
| `forbidLandscaping`     | boolean          | Every change to the land and water: raise, lower, smooth and flatten land, set tile height, raise and lower water, set water level and land surface painting. Buying land and construction rights is still allowed.                                                                                                                                                                       |
| `maxConstructionHeight` | integer, 4 to 96 | New construction whose highest part is more than this many height levels above the local ground. See below.                                                                                                                                                                                                                                                                               |
| `forbiddenRideTypeIds`  | integer[]        | Building a ride or stall of these `RideType` ids. Ids must exist and must not be duplicated. The file is rejected if a forbidden id also appears in `research.availableItemIds`, `research.inventions` or `prebuilt`, so research cannot unlock a forbidden type.                                                                                                                         |
| `forbidMarketing`       | boolean          | Starting any marketing campaign.                                                                                                                                                                                                                                                                                                                                                          |

"Trees" are scenery items in the Trees category (oak, conifer, blossom, birch, autumn, topiary,
palm, cactus). Shrubs, rocks, stumps, logs, flowers and other decorations are not trees.

## Height cap

Units are the game's land height levels: one level is `Z_STEP` (64 world units), the step the
land tool raises a corner by. The cap is measured **above local ground, not from the map's base**,
so a park built on a mountain is not unbuildable because the mountain is high.

For each tile an object covers, the local ground is the lowest corner of that tile's land, or the
water surface if the tile is flooded above it. The object is refused when its top on that tile is
more than `maxConstructionHeight` levels above that tile's ground. On a sloped tile the lowest
corner is the reference, so a slope costs up to one level of headroom.

The top of an object is:

| Object                  | Top                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------ |
| Track piece             | The top of the piece's structure on that tile (the train's headroom is not counted). |
| Flat ride, stall, kiosk | Its floor (the highest ground corner under the footprint) plus its 3-level height.   |
| Observation Tower       | Its floor plus the tower height, when built and when its height is raised.           |
| Footpath and queue      | The path surface; the high end of a ramp.                                            |
| Non-tree scenery        | Its base plus the item height.                                                       |

Not counted: trees, ride entrances and exits (they sit at station level, which track already
limits), supports, and tunnels below ground. The smallest valid cap is 4 so a 3-level stall
still fits on a sloped tile. An Observation Tower is at least 8 levels tall, so a cap under 8
rules it out.

The same check runs in the simulation and in every build preview (track, ride ghost, path,
scenery), so a ghost the preview shows as valid is accepted.

## Saves

The restrictions are copied into the park state when the scenario starts and saved with the
park. Loading a save always uses its saved rules, so later edits to the scenario file do not
change an existing park. Loading revalidates the saved object with the same parser. Saves
without it load unrestricted, so the save version did not change, and an unrestricted park
hashes exactly as it did before restrictions existed. Structures that already stand are never removed or changed by a restriction;
prebuilt rides in a scenario file are placed before the rules take effect.

## Player-facing text

The scenario preview on the title screen and the Park window's Objectives tab list the active
rules; the HUD strip does not. The preview reads, for example, "Park rules: Trees may not be
removed. Land and water may not be reshaped. Nothing may be built more than 6 height levels
above the ground. ..." (or "Park rules: no restrictions."). A refused action names the rule:

| Rule                    | Refusal                                                                           |
| ----------------------- | --------------------------------------------------------------------------------- |
| `forbidTreeRemoval`     | "Trees are protected in this park and cannot be removed."                         |
| `forbidLandscaping`     | "Landscaping is not allowed in this park."                                        |
| `maxConstructionHeight` | "Too high: this park allows construction up to 6 height levels above the ground." |
| `forbiddenRideTypeIds`  | "This attraction is banned in this park."                                         |
| `forbidMarketing`       | "Marketing campaigns are not allowed in this park."                               |

With `forbidMarketing`, the Finances window's Marketing tab disables every campaign and shows the
same message. The strings live in `RESTRICTION_REFUSALS`, `heightLimitRefusal` and
`restrictionLines` in `src/sim/scenario/restrictions.ts`.

## Sources

RCT2's scenario editor offered park prohibitions of the same kind (tree removal, landscape
changes, high construction, marketing). OpenCoaster's height cap is its own tunable,
per-scenario cap measured above local ground, not a fixed tree-height limit.

- RollerCoaster Tycoon 2 manual, scenario editor options (pp. 61-62):
  https://cdn.akamai.steamstatic.com/steam/apps/285330/manuals/manual.pdf
- RollerCoaster Tycoon wiki, "Scenario prohibitions": https://rct.fandom.com/wiki/Scenario_prohibitions

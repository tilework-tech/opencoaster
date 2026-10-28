# Guests (Peeps) — Mechanics Spec

Status: draft from research, not validated against the original game.
Scope: RCT1/RCT2-era guest behaviour, for OpenRCT-style clean-room reimplementation.
Clean-room note: this document is written from public descriptions (wiki pages, forum posts, blogs). It does not reference or reproduce any OpenRCT2 source code, and no original RCT assets are used.

Confidence legend:
- [V] verified: stated consistently by two or more independent sources
- [S] single source: one source, or a secondary source citing another
- [I] inferred: our design inference, not stated in any source

---

## 1. Overview and feel

Guests are the core simulated agents of the game. Each guest arrives at the park gate, wanders paths, chooses rides, queues, rides, eats, drinks, uses toilets, and eventually leaves. Each guest carries a small set of needs (happiness, energy, hunger, thirst, toilet, nausea) that rise or fall over time and are affected by what the guest does and where they are. The player never controls guests directly. The player reads guest moods and thoughts and changes the park (paths, rides, stalls, bathrooms, prices) to shape outcomes.

What it should feel like:
- Guests look like they have intentions. A hungry guest heads for food. A nauseous guest avoids spinning rides.
- Problems show up as legible thoughts ("I'm hungry", "This ride is too intense") so the player can diagnose and fix them.
- Crowds and bad layouts cause visible frustration. Guests who get lost wander and complain.
- Park-level aggregates (the park rating and guest count) feed back into arrivals, so the economy and the guests are linked.

---

## 2. Precise rules

### 2.1 Guest generation and arrivals

- G-1 Guest arrival is driven by a per-park "guest spawn probability" that accumulates from several sources. [S] (OpenRCT2 forum guide, archived: https://forums.openrct2.org/topic/2861-guide-when-and-how-do-guests-spawn/ , and the search snippet for that thread)
- G-2 Ride-based contribution: the game iterates the park's rides and adds a per-ride-type bonus to a "suggested guest maximum". Example values quoted: giga coaster 120, corkscrew coaster 100. Full table not captured. [S] same source.
- G-3 Marketing contributions to spawn probability, as quoted by the same guide: free park entry 400; free ride entry 300; half-price park entry 200; free food/drink 200; park advertising campaign 250; ride advertising campaign 200. Campaigns that lower a price have their value divided by 8 when the price is very low. Running every campaign at once spawns a guest almost every second. [S] same source. These numbers come from an old version, so treat as the starting point to verify.
- G-4 A soft guest cap exists. It rises with the number of rides and stalls, with a separate number per type. Advertising temporarily raises the cap to a slightly higher value. [S] (community forum post; no URL captured beyond search results)
- G-5 Entrance fee effect: an anecdotal speedrun report says guests arrive fastest at a $2 or $3 entrance fee. [S] Treat as an observation, not a rule. Source: https://www.speedrun.com/users/petrokov/threads (search result)
- G-6 Park rating drives arrivals. The rating is calculated from several factors; the calculation in the one guide found is a sum with guest count as one input. The guide quotes a starting value of 1150 and a guest term of (guests / 13) capped at 2000, and then subtracting that from 150, which gives a range of −150 to +3. These numbers are internally inconsistent in the snippet (1150 vs 150), so the exact formula is UNRESOLVED. [S] (https://forums.openrct2.org/topic/2798-guide-how-to-calculate-park-rating/ , snippet only)
- G-7 Known behavioural change: an OpenRCT2 issue reports that the guest generation algorithm changed, and that scenarios could no longer be completed without advertising. Another forum poster reports guest counts stagnating after the first year in 0.4.3. [S] (https://forums.openrct2.org/topic/6179-guest-generation-algorithm-changed-cant-finish-scenario-without-advertising-anymore/ , search snippet only)

Conflict to preserve: the old guide's numbers and the later reports of a changed algorithm disagree. Any spec must pick one version to target and say which.

### 2.2 Guest stats

Stat list: happiness, energy, hunger, thirst, toilet (bathroom need), nausea, nausea tolerance, preferred intensity, money, and cash spending.

- S-1 Each guest's happiness, hunger and thirst are initialised individually on spawn. Users report problems when park-wide starting values are set outside about 11–89%, where values overflow or underflow. [S] (forum thread on cheat-menu park parameters, snippet only)
- S-2 Hunger and thirst rise over time and with walking. Riding intense rides raises thirst and hunger. [S] (https://forums.openrct2.org/topic/4757-when-do-guests-get-hungrythirsty-rct1/ , snippet)
- S-3 Eating makes guests thirsty. Drink stalls handle thirst. Food stalls handle hunger. Fries and popcorn increase thirst. Ice cream reduces hunger and doesn't affect thirst. Drinks raise the toilet need significantly. [S] (strategywiki stall data, snippet)
- S-4 Toilet need rises after eating and drinking. Bathrooms must be reachable. A shortage of bathrooms gives very unhappy guests. [S] (Giant Bomb wiki, snippet)
- S-5 Energy falls when guests walk for a long time without riding. Riding enough rides restores it. Low energy makes guests walk slowly and prone to leaving. [S] (Fandom Guests and Staff, snippet; the page itself returned HTTP 402 and was not read)
- S-6 Nausea rises from rides. It rises more when the guest is not hungry and less when hungry. A guest whose nausea is too high stops and vomits, then feels better. Vomit left on paths lowers the park rating if it stays a long time. [S] (Fandom snippet)
- S-7 Nausea tolerance is an individual per-guest capacity. The exact formula is UNRESOLVED. [S] (community description only)
- S-8 Preferred intensity is per-guest. Guests refuse rides with ultra-extreme intensity and very rarely ride extreme ones. A "looks too intense" thought can also appear when all guests have preferred intensity below 4.00. [S] (Fandom snippet)
- S-9 Money: guests carry pocket money and spend it at shops and rides. Ride fee acceptance depends on a maximum price the guest will pay. [S] (forum "pocket money" thread and a "fleecer" tool thread, both snippets; no numbers captured)

Hunger-driven pathing conflict: one blog says guests do not seek food on purpose and just walk until they bump into a stall. A stall wiki says hungry guests pick the physically nearest food stall and buy from it if conditions allow. [S] Both are unverified, and the spec must choose one or test it against the original.

### 2.3 Ride choice and decision making

- R-1 Ride choice weighs excitement, intensity, nausea, and the guest's tolerances and preferences. Players describe nausea and ride tolerance as the main levers for steering guests. [S] (community description)
- R-2 Ride ratings feed guest preferences. Ride rating formula components relevant to guest choice (from a fan wiki of the ride-rating formula):
  - Positive G adds excitement 0.08/G, intensity 0.8/G, nausea 0.26/G.
  - Negative G adds excitement 0.24/G up to 2.5 G; intensity 0.8/G; nausea 0.22/G.
  - Lateral G adds excitement 0.4/G (cap 1.5 G), intensity 1.0/G, nausea 0.33/G. Above 2.8 lateral G: intensity +3.75, nausea +2. Above 3.1: excitement halved, intensity +8.5, nausea +4.
  - Drops: excitement 0.11 per drop (up to 9) plus 0.0049 per height unit; intensity 0.14 per drop plus 0.0098 per unit; nausea 0.10 per drop plus 0.0016 per unit. Height unit not stated.
  - Inversions: excitement 0.27 (max 6), intensity 0.5, nausea 0.22.
  - Scenery affects only excitement: an underground station gives 0.4; otherwise each scenery item within 5 tiles adds 0.05, up to 47 items.
  - Penalties: if intensity exceeds 10, excitement drops 25%, then further 25% reductions at 11, 12, 13.2, 14.5. Above 14.5, excitement is multiplied by 0.75^5 ≈ 0.24.
  [V-ish: one fan wiki, cited by OpenRCT2 GitHub wiki "Ride-rating-calculation"; it is a description of ride ratings, not guest behaviour directly. Confidence in the constants: S.] Source: https://github.com/OpenRCT2/OpenRCT2/wiki/Ride-rating-calculation
  These are ride ratings. How guests weigh them against their own preferences is still UNRESOLVED.

### 2.4 Queue joining and patience

- Q-1 OpenRCT2's current ride chooser does not apply a queue-length score penalty: it ranks eligible rides by excitement and skips rides marked `queueFull`. That flag is set after an actual failed attempt to enter a full queue, rather than from an estimated wait-time tolerance. Queue capacity and guest pathfinding are separate gates in the implementation. [S] [Guest ride selection](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/entity/Guest.cpp#L1761-L1880), [full-queue handling](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/entity/Guest.cpp#L2334-L2379).
- OpenCoaster's current design uses the same broad separation without copying that state model: it scores eligible rides without a line-length term, filters a ride when queued plus approaching guests reaches its queue capacity, and turns away later arrivals at a blocked queue join. `queued` means guests already in the queue or waiting at its entrance; `approaching` means guests still walking on public paths. The 1,000-guest regression scenario records a 24-guest physical queue peak in a 56-person line, reaches full committed demand (queued plus approaching), and observed no guest stationary on adjacent public paths for the test's three-sample threshold; see the [guest simulation Noridoc](../../src/sim/guests/docs.md).

### 2.5 Getting lost and pathfinding

The OpenRCT2 GitHub wiki "Peep AI" page is a public description of guest path search. [S] https://github.com/OpenRCT2/OpenRCT2/wiki/Peep-AI

Current OpenRCT2 source, read only as a description of observable behaviour, supersedes the wiki where they disagree on numbers (the wiki describes the original 2002 code; the source marks its routines with their original addresses). Sources: [GuestPathfinding.cpp](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/peep/GuestPathfinding.cpp), [Guest.cpp](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/entity/Guest.cpp), [Park.cpp](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/world/Park.cpp), read 2026-10-28. No code or data tables are copied; the rules below are restated in our own words and our own constants.

**Implemented (guest wayfinding, gap #6):**

- P-1 A guest chooses a direction only at tile centres, looking ahead through a limited number of junctions. A junction is a path tile with more than two open neighbours; corridors, bends and dead ends cost nothing. Lookahead per guest: 5 junctions walking, 7 with a park map, 7 while leaving the park, 8 while leaving and lost (countdown below 90, see P-8). Staff use 8. The wiki's 16 for staff and "16 minus 10" for guests is stale. [S] GuestPathfinding.cpp (junction constants and the budget selection routine). OpenCoaster: `GUEST_JUNCTIONS`, `GUEST_MAP_JUNCTIONS`, `GUEST_LEAVING_JUNCTIONS`, `GUEST_LEAVING_LOST_JUNCTIONS`, `STAFF_JUNCTIONS` in [navigate.ts](../../src/sim/pathfinding/navigate.ts).
- P-2 Tile budget per decision is 15,000 for guests and 50,000 for staff. The wiki also gives a search radius of 200 tiles; the radius is kept. [S] Peep AI wiki; GuestPathfinding.cpp.
- P-3 Routes are ranked by how close the best node a branch reaches comes to the goal (the smaller axis gap first, the larger as tie-break, lower is better, zero means the goal was found), and by fewer steps on ties. [S] Peep AI wiki ("Scoring"). Unchanged from the earlier implementation.
- P-4 Queue paths are not walked unless they lead to the target, and a step never reverses unless the tile is a dead end. [S] Peep AI wiki.
- P-5 A guest remembers the last four junctions it chose at on the way to one goal, and for each the exits it has not tried. Back at a remembered junction it chooses only among the untried exits; if none remain, every exit is open again. The memory is scoped to the active goal: OpenRCT2 uses pathfinding history only when its recorded goal matches the current goal, and clears history when it detects a different or invalid goal. Its ride-selection and map-purchase paths reset the goal. OpenCoaster clears the full saved memory when a goal is assigned or cleared, when the guest reaches its destination, and when it starts leaving. Arrival cleanup keeps stale history from crossing into the next guest activity; the source does not show a separate reset solely for reaching the destination. This is what lets a limited-lookahead guest work through a maze instead of repeating its first wrong turn. [S] [GuestPathfinding.cpp](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/peep/GuestPathfinding.cpp#L1208-L1270), [Peep.cpp](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/entity/Peep.cpp#L2461-L2467), [Guest.cpp ride selection](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/entity/Guest.cpp#L1649-L1668), [Guest.cpp map purchase](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/entity/Guest.cpp#L1496-L1498). OpenCoaster: `JunctionMemory` in navigate.ts, stored in the guest columns `navGoal`, `pathCursor`, `pathHistory0..3`.
- P-6 With no goal (aimless walking) a guest goes straight on half the time if that exit is open, and otherwise picks any open exit at random. At a T-junction the straight exit therefore gets 3/4 of the choices; at a four-way junction 2/3. [S] GuestPathfinding.cpp (aimless routine). Also used when a goal search finds no route.
- P-7 When a ride is chosen as the goal a countdown starts at 200. It falls by one each time the guest reaches a tile centre while heading for the ride. At 60 and at 30 left the guest thinks "I can't find ..." and its happiness target falls by 30 (never below zero); at zero it forgets the ride. A new goal restarts the countdown. [S] Guest.cpp (the can't-find-ride check and where the countdown is set). OpenCoaster: `RIDE_GOAL_COUNTDOWN`, `checkCantFindRide` in [navigation.ts](../../src/sim/guests/navigation.ts). The earlier 2,400-tick approach timeout (N14) is gone.
- P-8 When a guest starts leaving the park the same counter is set to 254. It falls by one per tile centre; at one the guest thinks "I can't find the exit!" and loses 30 happiness target, and the counter restarts at 90, so the thought repeats every 90 tile centres until the guest reaches the gate. A leaving guest with the counter below 90 is "lost": it gets the larger lookahead and counts toward the park rating's lost-guest penalty (7 rating points per lost guest beyond 25; the rating code is not part of this change). Nothing despawns a guest that cannot find the gate. [S] Guest.cpp (can't-find-exit check, the start-leaving routine); Park.cpp (lost-guest count in the rating). OpenCoaster: `LEAVING_COUNTDOWN`, `EXIT_RETRY_COUNTDOWN`, `checkCantFindExit`.
- P-9 Separate from both, every second tile centre adds one to a "time lost" clock that is cleared when the guest picks a ride or enters one; when the clock reaches 254 the guest thinks "I'm lost!" and loses 30 happiness target, the clock goes back to 230, and the thought repeats every 24 clock steps (48 tile centres). The check is skipped while the park has fewer than two rides. [S] Guest.cpp (lost check). OpenCoaster: `wanderSteps` counts tile centres: `LOST_WALK_LIMIT` 508, `WANDER_RESET` 460, `checkWanderedLost`. The source reads as if the original's lost flag also exists for normal guests; this is the one rule where the observed rule is less certain.
- P-10 A park map raises lookahead from 5 to 7 junctions for a guest who is not leaving, and buying one clears the junction memory. It does not change the countdowns. (The source also makes map owners pick rides more often and consider every ride; not modelled.) [S] Guest.cpp.

**Project mechanics that are not RCT2 behaviour:**

- P-11 A guest that has lost its way (first can't-find-ride thought, the "I'm lost!" thought, or no route to the gate) wanders for 2,400 ticks without picking a ride or stall, and heads for the nearest reachable information kiosk if it has no map and 60 cents. The sale is a map, not an umbrella. I could not find a counterpart in the source: its guests meet kiosks through ordinary stall choice. Kept because the player-facing loop (lost guests, kiosk, map) is part of the design. Map price 60 cents follows the kiosk entry in the item table, which the source lists without a labelled default price. [I]
- P-12 A guest on a footpath cut off from the gate with nothing it can reach leaves the park after 40 visits to tile centres (`STRANDED_LEAVE_VISITS`). [I]
- P-13 Not implemented: the 96.7% chance that a guest with no food or drink avoids dead ends, ride exits and wide path blobs when it has other choices; the walking animation that reads a map at junctions; preferring the nearest of several park entrances (we have one gate); banner "no entry" signs that close a path edge to guests (no sign object exists in the sim yet; see [gap-audit.md](gap-audit.md) row 6).

### 2.6 Umbrellas, balloons, items

- U-1 No verified rules captured. Umbrellas, balloons and other carried items are a recorded gap. [I] Design default: a carried item is a cosmetic plus a visible flag, with no gameplay effect until a rule is confirmed.

### 2.7 Leaving the park

- L-1 Guests leave when they are unhappy, low on energy, or their patience runs out. Low energy makes them walk slowly and prone to leaving. [S] (S-5)
- L-2 Park-exit rule detail (threshold values, probability) was not captured. UNRESOLVED. How a leaving guest finds the gate is P-8.

### 2.8 Vandalism triggers

- V-1 Vandalism is linked to litter and vomit on a path. A fan wiki says vandalism concentration tracks litter/vomit levels on a stretch of path. [S] (Fandom, snippet)
- V-2 Vandals damage nearby benches, lamps, and bins. Fan wiki says regardless of happiness. [S]
- V-3 Handymen clean litter and vomit. Security guards count "vandals stopped" (OpenRCT2 0.3.4 release notes). [S] https://www.openrct2.org/about (search result; not the release notes page, which was not read)
- V-4 Conflict: Planet Coaster patch notes say vandalism occurs when happiness falls below a threshold. That is a different game and is NOT used for this spec. [S]

### 2.9 Guest-to-guest interactions

- G2G-1 Crowding: too many guests nearby lowers happiness and triggers a complaint to the player. [S] (Larst blog, search snippet)
- G2G-2 Guests do not interact directly beyond crowding in any source found. [I]

### 2.10 Thoughts and messages

Verified thought list NOT captured. The Fandom "Guest Thoughts" page returned HTTP 402 and the rct.wiki copy was refused in this session, so no complete list is recorded here.

Known thought categories from search snippets [S]:
- hunger, thirst, toilet, energy, nausea, and "too intense" complaints
- lost, queuing, and crowding complaints (phrases not verified)
- positive thoughts about rides and food

Action: pull the full thoughts list from the Fandom wiki Guest Thoughts page or from the game's own strings in a clean-room way (observation only, not file extraction) before finalising. Mark as UNRESOLVED until then.

---

## 3. Data model proposal

Guests are the most numerous agents. Use struct-of-arrays with typed arrays.

```ts
// Guest state, struct-of-arrays. Index = guest id.
// Capacity fixed at park load; free-list reuse for despawned guests.
interface GuestStore {
  capacity: number;                 // e.g. 8192 (target: thousands at 40 Hz)
  alive: Uint8Array;                // 0/1
  x: Int16Array;                    // tile-space position (1/32 tile units)
  y: Int16Array;
  z: Int16Array;
  dir: Uint8Array;                  // 0..3
  state: Uint8Array;                // enum GuestState (see below)
  targetRide: Int16Array;           // -1 none
  pathIdx: Uint16Array;             // index into path cache for this guest
  happiness: Uint8Array;            // 0..255 (scaled from 0..100 to fit)
  energy: Uint8Array;
  hunger: Uint8Array;
  thirst: Uint8Array;
  toilet: Uint8Array;
  nausea: Uint8Array;
  nauseaTolerance: Uint8Array;      // per guest, fixed on spawn
  preferredIntensity: Uint8Array;   // per guest, fixed on spawn
  money: Int32Array;                // in cents
  thoughtId: Uint8Array;            // last thought, 0 = none
  thoughtTimer: Uint16Array;
  patience: Uint16Array;            // queue patience counter
  lostCounter: Uint16Array;         // path-search budget / lost detection
}

const enum GuestState {
  Idle = 0, Walking, Queueing, Riding, Eating, Drinking, UsingToilet,
  Lost, Vomiting, Leaving, Gone,
}
```

Notes:
- Use `Uint8Array` for 0–255 stats and scale the 0–100% values. [I]
- Use a path cache keyed by tile to avoid repeated search. [I] Based on P-6 (last-4 shortcut).
- Money in cents to avoid float drift. [I]

Per-tick cost estimate [I]:
- Target: 40 ticks/s, so 25 ms of CPU per tick in the browser. At 5,000 guests that is about 5 µs per guest, including rendering-independent logic.
- Stagger expensive work (pathfinding, thought updates) across ticks: at most N guests re-path per tick, where N is a budget (e.g. 64).
- Stat updates are cheap integer adds. Keep them in tight loops over typed arrays.
- Pathfinding budget from P-1 (15,000 tiles, 16 junctions) is a worst case, not a per-tick cost. Cache results.

---

## 4. Dependencies on other subsystems

- Rides: ride ratings (excitement, intensity, nausea), queue geometry, ride open state, ride capacity. Source: R-2.
- Track: track layout influences ride ratings and intensity; no direct guest dependency beyond ride stats.
- Paths: path graph, path width (3×3 rule, P-4), queue path flags, sloped connections.
- Economy: entrance fee, ride prices, shop prices, park rating (G-6), marketing (G-3), money (S-9).
- Staff and world: handymen (V-3), security guards, janitors; litter and vomit tiles (V-1); scenery counts (R-2).
- Rendering: guest sprite selection from state (S-enum), thought bubbles, mood display. Read-only from simulation state.
- Save format: guest arrays must be serialisable; see G-6 community note that pathfinding was limited by the save format in the old game. [S]

---

## 5. Prioritised implementation checklist

MVP (playable loop):
1. Guest spawn with a simple rate (constant or park-rating-driven placeholder).
2. Guest SoA store, alive/free list, capacity fixed.
3. Path walking: shortest path on a path graph with the P-4 validity rules. Skip the exact scoring for now.
4. Ride choice: pick a ride by excitement and nausea tolerance (placeholder weighting).
5. Queue join and ride ride-cycle.
6. Hunger, thirst, energy, toilet, nausea with simple rates. Food, drink, and toilet stalls.
7. Leaving the park when energy/happiness hits a threshold.
8. Thoughts: a small placeholder set (hungry, thirsty, too intense, lost).
9. Money and simple spending.
10. Park rating hook into arrivals (placeholder formula, labelled as such).

Fidelity pass:
11. Replace the placeholder spawn formula with the G-2 / G-3 terms, validated against a test park.
12. Implement the P-1 to P-6 search with the budget rules, including the single-exit exception.
13. Implement R-2 ride ratings and the preferred-intensity penalty (S-8).
14. Litter, vomit, and vandalism (V-1 to V-3).
15. Crowding (G2G-1).
16. Umbrellas, balloons, and other items (U-1), once a rule is confirmed.
17. Full thoughts list (2.10).

Testing: each item above needs black-box tests that check inputs and outputs (per the project coding rules). Do not test internals.

---

## 6. Open questions

1. Exact guest-arrival formula and current-version behaviour (G-1 to G-7). Conflicting old and new reports.
2. Park rating formula constants (G-6): the snippet is internally inconsistent (1150 vs 150).
3. Per-tick rates for all stats (S-2 to S-6). None captured.
4. Nausea tolerance and preferred intensity formulas (S-7, S-8).
5. Hunger-driven pathing: does a hungry guest seek the nearest stall or wander? (S-3 conflict)
6. Queue joining and patience thresholds (Q-1).
7. Umbrellas, balloons, and items (U-1).
8. Park exit thresholds (L-2).
9. Full thoughts list and trigger conditions (2.10).
10. Lost-guest trigger (P-8) and search radius (P-9 conflicts).
11. Whether RCT1 and RCT2 differ for each item above. Prefer RCT2 per brief, but no differences were captured.

---

## 7. Sources

Read or partially read:
- OpenRCT2 GitHub wiki, Peep AI (pathfinding): https://github.com/OpenRCT2/OpenRCT2/wiki/Peep-AI
- OpenRCT2 GitHub wiki, Ride rating calculation: https://github.com/OpenRCT2/OpenRCT2/wiki/Ride-rating-calculation
- OpenRCT2 forums (archived), guide: when and how do guests spawn: https://forums.openrct2.org/topic/2861-guide-when-and-how-do-guests-spawn/ (search snippet)
- OpenRCT2 forums (archived), guide: calculate park rating: https://forums.openrct2.org/topic/2798-guide-how-to-calculate-park-rating/ (search snippet)
- OpenRCT2 forums, guest generation algorithm changed: https://forums.openrct2.org/topic/6179-guest-generation-algorithm-changed-cant-finish-scenario-without-advertising-anymore/ (search snippet)
- OpenRCT2 forums, when do guests get hungry/thirsty: https://forums.openrct2.org/topic/4757-when-do-guests-get-hungrythirsty-rct1/ (search snippet)
- OpenRCT2 forums, lost guests in OpenRCT2 (Reddit): https://www.reddit.com/r/rct/comments/1humpo2/lost_guests_in_openrct2/ (search snippet)
- Speedrun community thread (entrance fee observation): https://www.speedrun.com/users/petrokov/threads (search snippet)

Search snippets only (page not read):
- RCT Fandom, Guests and Staff: https://rct.fandom.com/wiki/Guests_and_Staff (HTTP 402 on fetch)
- RCT Fandom, Guest Thoughts: https://rct.fandom.com/wiki/Guest_Thoughts (HTTP 402 on fetch)
- RCT wiki, Guests and Staff: https://rct.wiki/wiki/Guests_and_Staff
- Strategywiki, Shops & Stalls: https://strategywiki.org/wiki/RollerCoaster_Tycoon/Shops_&_Stalls
- Giant Bomb, RollerCoaster Tycoon: https://giantbomb.com/wiki/Games/RollerCoaster_Tycoon
- Larst blog, "The gold standard of optimization": https://larstofus.com/2026/03/22/the-gold-standard-of-optimization-a-look-under-the-hood-of-rollercoaster-tycoon/
- OpenRCT2 0.3.4 release notes (vandals stopped): not fetched; cited from search summary.

Not used:
- philadelphiaclever.weebly.com (low-quality source)
- Planet Coaster patch notes (different game; see V-4)

---

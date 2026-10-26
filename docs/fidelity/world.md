# Fidelity spec: world systems (staff, litter, vandalism, weather, terrain, land, scenery)

Status: clean-room behavioural spec, written 2026-10-24. Scope: the AREA list in the fidelity brief (staff AI and wages, litter and vomit, vandalism, weather, terrain tools and costs, land ownership, scenery effects). This is the reference that implementers work from. It supersedes the "current implementation" framing in [mechanics/world.md](../mechanics/world.md) §7, which is partly stale (see §8.3).

## 0. Method and conventions

- Reference behaviour: OpenRCT2 source at commit `47163dab` (pinned where marked), its `objects` repository climate data, and its player documentation. OpenRCT2 is a reimplementation; its comments cite original RollerCoaster Tycoon 2 addresses. Equivalence with the original binary is not independently verified here. Where it matters it is marked `[U]`.
- Clean-room: the numbers below are facts about the game's behaviour, stated in our own words. No code, identifiers or structure is reproduced. Implementers should work from this file, not from OpenRCT2 source.
- Units. Original world coordinates use 32 units per tile (a 3-tile radius is written as 96 units; a 7-tile radius as 224). A terrain height step is 2 height units = 16 world-Z. Our sim uses 256 units per tile (`src/sim/core/constants.ts`); convert by tile, not by unit, when comparing. Original RCT2 guest happiness runs 0 to 255.
- Time. Original-side durations are given in game ticks as OpenRCT2 counts them. Our tick rate is 40 Hz (`docs/ARCHITECTURE.md`). The original's real-time tick rate is `[U]`, so every original duration below is in ticks, not seconds.
- Confidence tags:
  - `[C]` checked by the spec writer against the pinned source or data file.
  - `[V]` read from the source by a research pass. Not re-checked by hand.
  - `[S]` single secondary source (player manual or docs).
  - `[U]` unknown or unverified. Do not implement from these without a playtest or measurement.
- Probabilities written as "roll ≤ N out of 65536" are exact. Per-cent figures are the rounded values.

Sources are listed in §9.

---

## 1. Staff AI and wages

### 1.1 Staff types and wage constants

| Type           | Role (player view)                              | Manual salary | Our monthly cents | Confidence               |
| -------------- | ----------------------------------------------- | ------------- | ----------------- | ------------------------ |
| Handyman       | Sweep litter, empty bins, water and mow gardens | $50/month     | 5000              | salary `[S]`, role `[S]` |
| Mechanic       | Inspect and repair rides                        | $80/month     | 8000              | salary `[S]`             |
| Security guard | Deter vandals                                   | $60/month     | 6000              | salary `[S]`             |
| Entertainer    | Entertain guests, raise nearby happiness        | $55/month     | 5500              | salary `[S]`             |

- The player manual lists monthly salary by staff role. Those amounts are retained as named monthly constants and converted to rounded weekly cents (`round(monthly * 12 / 52)`) because the economy charges payroll weekly; unknown roles fall back to zero. The source-side quarter-per-call payment detail has no independently verified call frequency.
- Player-visible salary is shown per staff type in the staff window `[S]`.

### 1.2 Hiring, firing, limits

- Hire fee: no hire cost constant found in source `[U]`. The staff window has a hire button per type and a fire option per staff member `[S]`.
- Staff cap: no cap on staff count or per-type count found `[U]`.
- Auto-hire: not found `[U]`.
- Stats reset on the staff statistics reset action sets the hire date to the current month count `[V]`.

### 1.3 Staff AI

Handyman (staff AI, priority order as implemented in source `[V]`):

1. Litter. Look for litter within a 3-tile radius (96 units), with vertical distance weighted ×4 (so a 1-level difference counts as 4 tiles). Litter must be inside the handyman's patrol area `[V]`.
2. Ignore chance. A handyman that has seen litter ignores it on a roll. On a normal path the ignore roll is ≤ 0x1999 of 65536 (about 10%). On a path that is connected to a queue the ignore roll is ≤ 0xE666 of 65536 (about 90%) `[C]`.
3. Sweeping removes the litter on the tile and increments the handyman's sweep counter `[V]`.
4. Mowing. A handyman starts mowing only when idle for 12 ticks since its last action `[C]` (the idle counter must reach 12).
5. Bins. Empty bins by refilling all four corners to empty. Only bins with the bin flag, not broken, and not ghosts (`[V]`, see §2.4).
6. Patrol. A handyman with a patrol area stays inside it. A handyman without one wanders and does any job it meets `[S]`.

Mechanic (`[V]` unless marked):

- Mechanics are assigned to rides. They give up after waiting more than 2500 ticks on an inspection or call `[C]`.
- A completed inspection resets the ride's last-inspection counter to 0 and raises reliability by an amount proportional to the shortfall from 100%, multiplied by a random byte `[V]`.
- Inspection cadence (how often a ride is due), repair timing, and the inspect-only, repair-only and mixed modes are `[U]` in source. The player documentation describes the modes `[S]`.

Entertainer (`[V]` unless marked):

- Acts when a path-finding update rolls ≤ 0x4000 of 65536 (about 25%) `[C]`. Action is a wave or joy animation.
- Affects guests within a 3-tile radius (96 units), with height difference at most one step.
- Each affected walking guest gains +4 to its happiness target (capped at 255). Each affected queuing guest gains +3 to its happiness target and has 200 ticks removed from its time in queue (floored at 0) `[C for the −200 reduction; V for the +4 and +3]`.
- Each affected guest is counted in an "entertained" statistic `[V]`.
- Entertainer uniform colour is fixed. Other staff colours are settable `[S]`.

Security guard:

- Deters vandalism within 224 units, which is 7 tiles, in Chebyshev distance `[V]`. A blocked vandal attempt increments that guard's "vandals stopped" counter `[V]`.
- Security guards have no other gameplay effect in source `[V]`.

Patrol areas:

- Stored as one bit per 4×4 tile block, with a separate area per staff member. A worker's mask is allocated when their first block is assigned and released when its last block is removed or the worker is fired; packed masks and area IDs are deterministic world state `[V]`.
- Save version 20 migrates the previous four role masks by copying the old role's marked blocks to every employed worker of that role `[V]`.
- No cap on area size or staff count found `[U]`.

### 1.4 Wage charging in our implementation

- Our wages are charged once per game week at the rounded weekly equivalent of each manual monthly role salary (`round(monthly * 12 / 52)`). Weekly accrual matches the current economy model; the manual's quarter-per-call alternative is not modeled because its call cadence is unverified.

---

## 2. Litter, vomit and bins

### 2.1 Litter creation

Litter comes from two sources `[V]` (guest code paths):

1. Litter-droppers. Only a guest flagged as a litter dropper, and only when not standing on a surface tile, drops litter: 6.25% per update (roll ≤ 4096 of 65536) `[C]`. The flag is set only by one easter-egg name, so ordinary guests do not drop litter this way `[V]`.
2. Container-holders. A guest holding an empty container (cup, bottle, can, box, bowl or carton) drops it as litter at roll ≤ 4096, at most once per 512-tick window per guest. A guest holding no container drops vomit instead `[V]`. The simplified implementation uses a separate one-in-96 trash roll every 160 ticks because source-side holder state is not represented.

Dropped litter lands within about ±3 world units of the guest `[V]`. Litter may only be placed on owned, above-ground path tiles `[V]`.

### 2.2 Vomit and nausea

- A guest vomits when its nausea is at least 140 (sick) and is sent to first aid at 200 (very sick) `[C]`.
- The vomit action resolves at animation frame 15 `[V]`.
- Each vomit reduces nausea by 30 (floored at 0), halves hunger, and halves the nausea target `[V]`.
- Vomit item variant is chosen by guest-id parity `[V]`.
- Guests above nausea 140 are flagged in several decision checks (ride choice and first-aid decisions) `[C]`.

### 2.3 Litter types, lifetime and cap

- Twelve litter types: two vomit variants and ten rubbish types (empty can, rubbish, burger box, empty cup, empty box, empty bottle, red bowl, drink carton, juice cup, blue bowl) `[V]`.
- Removal radius for a litter item: ±8 world units in x and y, ±16 in z `[V]`.
- Cap: 500 litter entities `[C]`. When full, creating new litter removes the newest litter entity, not the oldest `[C]`.
- No timed decay. Litter is removed only by handyman sweeping, by cap eviction, or by removing the map tile under it `[C]`. The "7680 ticks" value below is a rating term, not a lifetime.

### 2.4 Bins

- A bin has four corner slots. Each slot is a 2-bit counter from 0 (full) to 3 (empty). A new bin starts empty `[C]`.
- A deposited item is removed. Each corner's counter steps down with probability 1/8 per item while not full. Expected items to fill one corner: 24 (three steps at 1/8 each) `[V, derived]`.
- When a corner is full, a guest drops its item as litter nearby instead `[V]`.
- Bins are the path additions with the bin flag. Stock RCT2 bins: four "litter" path items, all with bin and breakable flags `[V, objects repo]`.
- Handymen empty a bin by resetting all four corners to empty `[V]`.

### 2.5 Litter effects on guests

Happiness and thoughts `[V]`:

- Bad litter thought: a guest that has seen 3 or more litter entries across its recent memory windows gets the thought with roll ≤ 10922 of 65536 (about 16.7%), costing −17 to happiness target.
- Disgusting path thought: the same structure, for vomit, costing −17.
- Crowded thought: at least 10 walking guests on one tile, roll ≤ 21845 (about 33%), costing −14.
- Vandalism thought: −17 (§3).
- Stepping on litter: no direct per-step penalty found `[V, absence]`.
- Positive: a guest assesses its surroundings every 18 ticks (§6.3). Rubbish within that window gates the "very clean", "music" and "fountain" thoughts (§6.3).

### 2.6 Litter effects on park rating

- Park rating drops 4 points per litter entity older than 7680 ticks, counting at most 150 entities, so the maximum penalty is 600 points on the 0–999 scale `[C]`.
- Park rating constants (for context): base 1150, guest-count term −150 + min(2000, guests) / 13 `[C]`.
- News warnings: bad litter when the litter-thought counter is at least 23 and at least guests / 32; vandalism when at least 15 and at least guests / 32 `[V]`.

---

## 3. Vandalism

### 3.1 Trigger

Checked during a guest's walking update `[V]`:

- Non-angry guest preconditions, all required: happiness below 48 `[C]`, energy at least 85 `[C]`, state is walking, and the guest has seen litter or vomit recently (memory non-zero) `[V]`.
- The source spec does not give a memory expiry or sighting radius. OpenCoaster treats a litter or vomit item on the guest's tile as a sighting for 2,048 ticks (`GUEST_LITTER_MEMORY_TICKS`); this is a named tuning assumption, not a source-equivalent duration.
- Roll: a vandal attempt succeeds when the random 16-bit value is ≤ 3276 (5%) `[C]`.
- Angry guests (angriness set by a previous vandalism) skip the happiness, energy and memory gates `[V]`.
- Blocked if the guest is sitting on the same tile (a seated guest protects that tile's bench) `[V]`.
- Blocked if a security guard is within 7 tiles, Chebyshev `[V]`.

### 3.2 Effect

- The targeted item's broken flag is set. The item stays in place, and its contents are not deleted `[V]`.
- The vandal's angriness is set to 16 `[V]`.
- OpenCoaster represents this as 512 simulation ticks (`VANDAL_ANGER_TICKS`) and lets an angry guest bypass the happiness, energy and memory gates; 512 ticks converts the source's value of 16 at the current 32-tick vandalism cadence.
- Items that can be vandalised: every breakable path or scenery item, including all stock benches, all stock lamps and bins `[V, objects repo]`.

### 3.3 Repair

- A broken item is repaired only by placing a new item or footpath piece on the tile. There is no staff repair routine in source `[V]`.
- Repair cost: not found `[U]`.

### 3.4 Witnesses and thoughts

- Walking a broken item's tile marks a "vandalised tile" bit in the guest's memory. Two such tiles in its recent window trigger a vandalism thought with roll ≤ 10922 (about 16.7%), costing 17 happiness target, then a 3-step cooldown `[C for the 10922 roll; V for the rest]`.
- Vandalism has no park-rating term `[V, absence]`.

---

## 4. Weather

### 4.1 States

Nine weather types, in this order: sunny, partly cloudy, cloudy, rain, heavy rain, thunderstorm, snow, heavy snow, blizzard `[C]`.

Temperature delta from the month's base temperature, in °C `[C]`:

| Weather       | Delta | Effect category | Gloom level |
| ------------- | ----- | --------------- | ----------- |
| Sunny         | +10   | none            | 0           |
| Partly cloudy | +5    | none            | 0           |
| Cloudy        | 0     | none            | 0           |
| Rain          | −2    | rain            | 1           |
| Heavy rain    | −4    | rain            | 2           |
| Thunderstorm  | +2    | storm           | 2           |
| Snow          | −10   | snow            | 1           |
| Heavy snow    | −15   | snow            | 2           |
| Blizzard      | −20   | blizzard        | 2           |

Gloom changes only the palette `[V]`. Thunderstorm delta is listed as +2 in the fetched table but its category is storm `[V]`.

"Precipitating" for guest decisions means rain-category (rain, heavy rain, storm) or heavy snow / blizzard `[V]`. Whether the thunderstorm row counts as precipitating is `[U]`.

### 4.2 Update cadence and transitions `[C]`

- The weather update runs only in the playing scene. State changes on ticks that are multiples of 128.
- A new forecast draws a target and sets the timer to 1920 ticks. When 960 ticks remain, a climate-update event is broadcast `[C]`.
- Each 128-tick step moves temperature one degree toward the target, then gloom, then intensity, then weather type. The weather type switches only once the others match, then a new forecast is drawn `[V]`.
- Real-time duration: `[U]` (tick rate).

### 4.3 Climate data (monthly probabilities)

Each climate object gives, for each of eight months (March to October), a base temperature, a random bias and a weighted list of weather types. Data is from the OpenRCT2 objects repository, climate folder `[C]`:

- Item temperature thresholds in all four climates: cold below 11 °C, warm from 21 °C `[C]`.
- Months November to February: no data `[C]`. Behaviour in those months is `[U]`.
- Base temperature (°C) by month, March to October `[C]`:

| Month | Cold | Cool and wet | Hot and dry | Warm |
| ----- | ---- | ------------ | ----------- | ---- |
| Mar   | 4    | 8            | 12          | 12   |
| Apr   | 5    | 10           | 14          | 13   |
| May   | 7    | 14           | 16          | 16   |
| Jun   | 9    | 17           | 19          | 19   |
| Jul   | 10   | 19           | 21          | 21   |
| Aug   | 11   | 20           | 22          | 22   |
| Sep   | 9    | 16           | 21          | 19   |
| Oct   | 6    | 13           | 16          | 16   |

- Random bias by month, March to October `[C]`:
  - cold: 18, 21, 17, 17, 23, 23, 19, 16
  - cool and wet: 18, 21, 17, 17, 23, 23, 19, 16
  - hot and dry: 15, 12, 11, 9, 13, 11, 12, 13
  - warm: 21, 22, 17, 18, 22, 17, 17, 17
- Per-type weights (counts), July, cold climate `[C]`: sunny 10, partly cloudy 6, cloudy 5, rain 1, heavy rain 1 (sum 23, equal to that month's bias).
- The weights are counts in the order of §4.1. The sampling rule is `[U]`: the weight list is scaled, rotated, and sampled from a window whose length is the bias. Do not compute exact probabilities from the counts until the sampling rule is confirmed. The counts above are fact; the percentages derived from them are not.
- Snow and thunder come from the same weight lists `[C]`. The cold climate's listed months include thunder and no snow `[C]`.
- Climate selection: attached to scenarios `[S]`. Whether sandbox play lets the player choose a climate is `[U]`.

### 4.4 Weather effects on guests and rides

Purchases `[V]` (guest buying rules):

- While precipitating, guests refuse to buy balloons, ice cream, candyfloss and sunglasses.
- At temperatures below 12 °C, guests refuse sunglasses and ice cream. This threshold is one above the 11 °C item threshold; the conflict is `[U]`.
- While precipitating, umbrellas skip the souvenir gate and the price-versus-value check.

Rides in rain `[C for the threshold and the 3/8 rule; V for the rest]`:

- A guest about to choose a ride while precipitating refuses a ride that is not rain-suitable.
- A ride is rain-suitable if at least 3 of its 8 eighths are sheltered (3/8, 37.5%). The source comment says "about 10–15%"; the code threshold is what counts `[C]`.
- A guest holding an umbrella accepts an umbrella-usable ride about 50% of the time per evaluation `[V]`.
- Refusal thought: "not while raining" is shown only to a guest standing at the ride. Happiness target drops by 8 if it is at least 64. The guest's popularity for that ride is set to 0 `[V]`.
- Guests already heading to a ride skip the rain check `[V]`.
- Guests already queuing stay in the queue `[S]`.

Other weather effects `[V]`:

- Heat: at 21 °C or above, a thirsty guest (thirst at least 5) loses 1 thirst at each leave-park check. Happiness is not affected.
- Maze jumps are blocked during precipitation. A jump needs energy above 80 and a roll ≤ 2427 of 65536 (about 3.7%).
- Brake-failure breakdown weight is 20 in precipitation and 3 otherwise (relative weights, not percentages).
- No weather term in ride popularity, ride rating, or queue-wait logic `[V, absence]`.
- Queue give-up: a queuing guest with happiness 65 or less gives up at 4300 time units, about 3.3% per check `[V]`. Not weather-related.

### 4.5 Thunder and lightning `[V]`

- Storm spawn threshold: 436 of 65536 per check. Blizzard threshold: 109 of 65536. Both shift right by (game speed − 1), so they get rarer at higher speeds.
- Thunder lasts 43 to 106 ticks. Lightning delay is 0 to 31 ticks. Flash chance about 12.5%.

---

## 5. Terrain tools, costs and land ownership

### 5.1 Limits

- Land height: 2 to 254 height units, 2 units per visible step `[V]`.
- Map-edge tiles cannot be height-edited `[V]`.
- Money: pounds internally; "2.50" is 250 base units `[V]`.

### 5.2 Raise and lower land `[V]`

- Raise: only tiles at the lowest height in the selection are raised, by one step (2 units). Lower: only tiles at the highest height are lowered, by one step.
- Cost: 2.50 per height unit of change at each of the four tile corners, using the absolute change. Lowering costs the same as raising. No refunds (2.50 × 2 × 4 = 20.00 for one flat tile raised one step; derived, not checked in-game).
- Ownership gate: each tile in the selection must be inside the park (land owned), except in sandbox and the scenario editor. If no selected tile is owned, the action is refused with a "land not owned by park" error.
- Blocked when: tree obstruction (only if the park forbids tree removal), ride supports would exceed their maximum height, water-based track or structures would be left floating, track clearance is violated.
- Scenery in the way: small scenery and walls on the affected tile are removed, and the removal price is charged.
- Path litter on the affected tile is removed on height change `[V]`.
- Sloped tiles cannot be raised to the top two height units `[V]`.

### 5.3 Smooth `[U]`

- A smoothing action exists (row passes over corners and edges). Its per-step costs were not extracted.

### 5.4 Water `[C]`

- Raise: a tile without water gets water at base +2 units (one step). A tile with water is raised by 2 units, capped at the lowest existing water level in the selection and at the absolute maximum.
- Cost: flat 250 (2.50) per tile per water-height action, regardless of depth or direction `[C]`.
- Tiles with water-dependent track cannot be changed `[V]`.
- Water also needs an in-park tile in the selection `[V]`.

### 5.5 Surface and edge style `[V]`

- Surface change: per tile, the surface object's own price (per object; not fetched `[U]`).
- Edge style change: flat 1.00 (100 units) per tile `[V]`.
- Tiles outside the park are skipped unless in sandbox or the editor `[V]`.
- Blocked when the park forbids landscape changes (except editor and sandbox) `[V]`.
- No refunds `[V]`.

### 5.6 Clear and remove scenery

- Clear is allowed only on owned tiles (land owned or construction rights owned), or in editor and sandbox. Unowned tiles give a "not owned" error `[V]`.
- Each removed item costs its entry's removal price. No refunds `[V]`.

### 5.7 Land ownership `[V]`

Per-tile flags: land owned, land for sale, construction rights owned, construction rights for sale.

- Buy land: only tiles marked for sale, not in editor mode. Each purchase charges the scenario's land price per tile. Already-owned tiles are free and skipped. Fences update on the tile and its four neighbours on purchase. The price is stored in the scenario, not a source constant. Per-scenario value: `[U]`.
- Buy construction rights: only tiles marked construction-rights-for-sale that are not already owned. Price is the scenario's construction-rights price `[U]` per tile.
- Construction rights are granted by path and park-entrance tiles, only when the clearance above the surface is small (3 height units, 24 world-Z). Otherwise ownership of that tile is removed `[V]`.
- Construction-rights volume: owned only up to 24 world-Z above the tile base `[V]`.
- "In park" checks require land owned, not construction rights. Land raise, lower, water and surface edits use this check `[V]`.
- Placing scenery or paths on unowned land requires construction rights `[U]` for the exact placement rule.

### 5.8 Our costs for comparison (see §7)

- Land raise and lower: 2000 cents per tile in the selection, charged only on success (`src/sim/map/map-commands.ts`).
- Water: flat 2000 cents per command.
- Surface paint: free.
- Path placement: 1000 cents per tile.
- Land purchase: 10000 cents per for-sale tile; rights 4000 cents per tile (`src/sim/map/tile-map.ts`).

---

## 6. Scenery effects

### 6.1 Placement and removal costs `[V]`

- Placing small scenery: charged the entry's price plus construction-clearance costs.
- Removing small scenery: charged the entry's removal price.
- Per-object prices: `[U]` (object data, not in the source tree fetched).

### 6.2 Park rating

- Scenery has no term in the park rating `[V]`. The rating is built from guest population, happiness, lost guests, ride uptime and excitement, and litter (§2.6).

### 6.3 Guest thoughts from surroundings `[C for thresholds and cadence; V otherwise]`

- A walking or sitting guest assesses its surroundings every 18 ticks `[C]`.
- The scan is a 10×10-tile square centred on the guest's tile (±5 tiles) `[V]`. Thoughts are suppressed when the guest's tile is above the scanning height `[V]`.
- Counted: every small or large scenery element. Walls, ghosts and paths are not counted `[V]`.
- Scenery thought: at least 40 scenery elements and fewer than 8 rubbish items (broken paths plus litter in the window) `[C]`.
- Priority: fountains (at least 5 fountain additions and fewer than 20 rubbish) take precedence over scenery `[V]`. Then music (nice music, fewer than 20 rubbish). Then "very clean" (fewer than 2 rubbish) `[V]`.
- Any returned thought (not only scenery) grants +45 to the guest's happiness target, capped at 255 `[C]`.
- Scenery viewing: a guest looking at scenery with no ride in view gets a scenery thought `[V]`.
- No per-item beauty or scenery-value score `[V, absence]`.

---

## 7. Gap table: our current behaviour vs the original

Severity: **GV** gameplay-visible (a player notices it in a normal session), **SB** subtle (noticeable in numbers, not in play). File paths are ours. The inventory below was refreshed for the world-fidelity implementation in PR #42; `Implemented` means the listed gap was addressed, while `Partial` means meaningful behavior landed but the original behavior remains incomplete.

| #   | Area                         | Original                                                                                                                      | Ours (file)                                                                                                                                                                                                                                                                                                                | Sev | Suggested fix                                                            |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------ |
| 1   | Scenery                      | Full scenery system: placement with clearance cost, removal price, scenery-count thoughts, fountain/music/clean thoughts (§6) | Partial: 10×10 scans count small/large scenery, broken paths and litter; generic scenery/very-clean thoughts add +45 to current happiness at the 18-tick assessment as a target-state approximation; no catalog, placement, fountain or music effects (`src/sim/map/scenery-effects.ts`, `src/sim/guests/surroundings.ts`) | GV  | P12 (partial; target smoothing, catalog and special thoughts deferred)   |
| 2   | Litter happiness             | −17 bad-litter and disgusting-path thoughts, −14 crowd thought, all roll-gated (§2.5)                                         | Partial: litter memory/anger now feed guest state and vandalism; exact litter happiness thoughts and roll gates remain absent (`src/sim/guests/guest-system.ts`)                                                                                                                                                           | GV  | P1 (partial; thoughts deferred)                                          |
| 3   | Litter lifetime and cap      | Permanent until swept; cap 500, newest evicted (§2.3)                                                                         | Implemented: persistent litter, cap 500, deterministic newest-first eviction, no age-out (`src/sim/guests/litter-system.ts`, `src/sim/guests/litter-store.ts`)                                                                                                                                                             | GV  | Done                                                                     |
| 4   | Weather model                | Nine types; climate object with 8 monthly tables; 128-tick cadence; forecasts 1920 ticks (§4.1–4.3)                           | Partial: four represented kinds use scenario climate monthly base temperatures; 128-tick transitions, forecasts, the other five types, and climate probability tables remain absent (`src/sim/weather/weather-system.ts`)                                                                                                  | GV  | P8 (partial; state machine and probabilities deferred)                   |
| 5   | Rain effect on rides         | Guest refuses an uncovered ride while precipitating; sheltered rule 3/8; umbrella 50% (§4.4)                                  | Score penalty of 1200 for non-umbrella guests on non-shop rides (`src/sim/guests/guest-system.ts`) `[code]`                                                                                                                                                                                                                | GV  | P9                                                                       |
| 6   | Rain effect on happiness     | −8 happiness target and a "not while raining" thought at the ride (§4.4)                                                      | −2 happiness once per 128 ticks for exposed guests (`src/sim/guests/guest-system.ts`) `[code]`                                                                                                                                                                                                                             | SB  | P9                                                                       |
| 7   | Rain purchases               | Refuses balloons, ice cream, candyfloss, sunglasses while precipitating; cold block below 12 °C (§4.4)                        | Umbrella purchases from kiosks only; no purchase-block rules `[code]`                                                                                                                                                                                                                                                      | GV  | P9                                                                       |
| 8   | Vandalism trigger            | Happiness below 48, energy at least 85, litter memory, 5% per walking check (§3.1)                                            | Partial: litter memory and anger gates are implemented; energy and exact source cadence/probability remain approximate (`src/sim/guests/vandalism.ts`)                                                                                                                                                                     | GV  | P7 (partial)                                                             |
| 9   | Vandalism targets            | Any breakable item, including lamps (§3.2)                                                                                    | Benches and bins are breakable; lamp support remains absent (`src/sim/guests/vandalism.ts`)                                                                                                                                                                                                                                | GV  | P7 (partial)                                                             |
| 10  | Vandalism effect             | Sets broken flag; contents kept; repaired by re-placing the item (§3.2–3.3)                                                   | Broken bench/bin state is represented and repairable; full original target coverage remains absent (`src/sim/guests/vandalism.ts`)                                                                                                                                                                                         | GV  | P7 (partial)                                                             |
| 11  | Security radius              | 7 tiles Chebyshev, counts the vandals it stops (§1.3)                                                                         | Implemented: 7-tile Chebyshev radius and stopped-vandal counter (`src/sim/guests/vandalism.ts`)                                                                                                                                                                                                                            | SB  | Done                                                                     |
| 12  | Bin capacity                 | Four corners, each about 24 items on average, overflow dropped as litter nearby (§2.4)                                        | Four 2-bit corner counters with probabilistic decrement; when all corners are full, the item becomes a litter entity (`src/sim/guests/litter-store.ts`)                                                                                                                                                                    | GV  | Partial; verify corner fill cadence and overflow placement               |
| 13  | Litter sources               | Only litter-droppers (6.25%) and guests holding a container (6.25% per 512 ticks); vomit at nausea 140 and 200 (§2.1–2.2)     | Partial: container-triggered litter/vomit and nausea recovery are modeled; exact guest source eligibility and timing remain approximate (`src/sim/guests/litter-system.ts`)                                                                                                                                                | GV  | P4 (partial)                                                             |
| 14  | Vomit effects                | Each vomit cuts nausea by 30, halves hunger and nausea target (§2.2)                                                          | Vomit reduces nausea and hunger and updates the nausea target; source thresholds remain approximate (`src/sim/guests/litter-system.ts`)                                                                                                                                                                                    | SB  | P4 (partial)                                                             |
| 15  | Handyman sweep               | Within 3 tiles of the handyman, inside its patrol area, with 10% / 90% ignore rolls (§1.3)                                    | Implemented: nearby litter is swept within patrol/radius constraints, with queue-path ignore rolls and sweep statistics (`src/sim/staff/staff-system.ts`)                                                                                                                                                                  | GV  | Done                                                                     |
| 16  | Entertainer effect           | 3-tile radius; +4 walking, +3 queuing, −200 queue time; 25% action roll (§1.3)                                                | Every 80 ticks, +1 happiness to guests in a 5×5 square (`src/sim/staff/staff-system.ts`) `[code]`                                                                                                                                                                                                                          | GV  | P6                                                                       |
| 17  | Mechanic loop                | Reliability raised in proportion to the shortfall, with a random factor; gives up after 2500 ticks waiting (§1.3)             | Fixed +25 reliability (cap 100), 144,000-tick inspection interval (`src/sim/staff/staff-system.ts`, `src/sim/rides/ride-operations.ts`) `[code]`                                                                                                                                                                           | SB  | P6                                                                       |
| 18  | Staff hire and wages         | Hire fee and staff cap not found; role salaries are listed monthly in the player manual (§1.1)                                | Implemented: manual monthly role salaries are converted to rounded weekly cents and paid on the weekly economy boundary; hire fee/cap remain chosen defaults (`src/sim/staff/staff-store.ts`)                                                                                                                              | SB  | Partial (wage cadence resolved; UI display and hire fee/cap remain open) |
| 19  | Garden work                  | Mowing after 12 idle ticks; watering and mowing triggered by staff idleness (§1.3)                                            | Mow at overgrowth 8 or more, watering on a 1-in-4 roll per growth step, 1024-tick growth step (`src/sim/staff/grounds.ts`) `[code]`                                                                                                                                                                                        | SB  | Not prioritised; resolve after P5                                        |
| 20  | Terrain raise and lower cost | 2.50 per height unit per corner, charged for raise and lower; no refund (§5.2)                                                | Named 500-cent charge per unique corner actually changed; saturated corners are free. The selected-corner rule remains approximate (`src/sim/map/map-commands.ts`)                                                                                                                                                         | GV  | Partial; exact tool selection remains open                               |
| 21  | Water cost                   | 250 per tile per action, any depth (§5.4)                                                                                     | Implemented with a named per-tile cost (`src/sim/map/map-commands.ts`)                                                                                                                                                                                                                                                     | GV  | Done                                                                     |
| 22  | Surface paint cost           | Surface price per object; edge style 100 per tile (§5.5)                                                                      | Implemented with named surface and edge costs; object-price fidelity remains unsourced (`src/sim/map/map-commands.ts`)                                                                                                                                                                                                     | GV  | Partial; object prices open                                              |
| 23  | Raise and lower rules        | Raise only the lowest tiles, lower only the highest; height change removes path litter and charges scenery removal (§5.2)     | Rectangle edits select lowest tiles for raise and highest for lower; invalid element clearance rolls back; changed terrain removes litter, while paths/scenery are not moved or charged for removal (`src/sim/map/land.ts`)                                                                                                | GV  | Partial; path/scenery effects deferred                                   |
| 24  | Land purchase                | Scenario price per tile; per-tile for-sale flags; fences update (§5.7)                                                        | Implemented: per-tile ownership and purchase commands; 10000-cent price is a named fallback pending scenario-specific pricing (`src/sim/map/map-commands.ts`)                                                                                                                                                              | GV  | Partial; scenario pricing/UI deferred                                    |
| 25  | Initial ownership            | Scenario-defined                                                                                                              | Implemented as deterministic initialized owned/for-sale regions; scenario configurability remains open (`src/sim/map/terrain.ts`)                                                                                                                                                                                          | SB  | Partial; expose in scenario file                                         |
| 26  | Doc drift                    | n/a                                                                                                                           | See §8.3                                                                                                                                                                                                                                                                                                                   | n/a | P14                                                                      |

---

## 8. Prioritised fix list (PR-sized tasks)

Sizes: S under half a day, M one to two days, L several days. Each task is one PR with tests written first (TDD), and each keeps the sim deterministic (`docs/ARCHITECTURE.md`). A change that alters saved state bumps the save version (`src/save`).

| ID  | Task                                                                                                                                                                                                                      | Gaps           | Size | Depends on                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---- | -------------------------------------------------------------------------------- |
| P1  | Litter and vomit happiness: bad-litter and disgusting-path thoughts with the 3-sighting and roll rules, crowd thought, tidy-park thoughts                                                                                 | 2              | M    | none                                                                             |
| P2  | Litter lifecycle: remove timed decay; cap 500 with newest-eviction; litter removal only by sweep or tile removal; save version bump                                                                                       | 3              | S    | none                                                                             |
| P3  | Bin model: four corner counters with 1/8 decrement; overflow becomes nearby litter instead of being discarded                                                                                                             | 12             | S    | P2                                                                               |
| P4  | Litter and vomit sources: litter-droppers, container-holders, nausea thresholds 140 and 200, vomit cuts nausea by 30                                                                                                      | 13, 14         | M    | P2                                                                               |
| P5  | Handyman sweep: 3-tile radius inside patrol area, ignore rolls 10% and 90%                                                                                                                                                | 15             | S    | none                                                                             |
| P6  | Entertainer and mechanic: 3-tile radius, +4 and +3 happiness, −200 queue time, 25% roll; mechanic reliability in proportion to shortfall and 2500-tick give-up                                                            | 16, 17         | M    | none                                                                             |
| P7  | Vandalism rewrite: happiness below 48, energy at least 85, litter memory, 5% per check; any breakable item including lamps; broken flag kept, repaired by re-placing; 7-tile security radius with counter; vandal thought | 8, 9, 10, 11   | M    | P1 (thoughts)                                                                    |
| P8  | Weather model: nine types with temperature deltas; 128-tick cadence; 1920 forecast timer and 960 event; climate objects with the eight monthly tables; thunder and lightning                                              | 4              | L    | none (split into P8a state machine and cadence, P8b climate tables, P8c thunder) |
| P9  | Rain effects: refuse uncovered rides while precipitating; 3/8 shelter rule; umbrella 50%; −8 target and "not while raining" thought; purchase blocks; cold threshold; remove score penalty                                | 5, 6, 7        | M    | P8, and ride shelter counts (not in the current model)                           |
| P10 | Terrain and land costs: per-corner height cost on raise and lower; water 250 per tile per action; surface price per object and edge style 100; land purchase per scenario with a UI control                               | 20, 21, 22, 24 | M    | none (price constants need Q4)                                                   |
| P11 | Terrain tool rules: raise lowest and lower highest tiles only; height change removes path litter and charges scenery removal instead of rolling back                                                                      | 23             | M    | P12 (scenery removal)                                                            |
| P12 | Scenery system: object catalog, placement with clearance costs, removal price, the 40-element and rubbish-gated thoughts with 18-tick cadence, +45 happiness, fountain and music thoughts                                 | 1              | L    | none (split: catalog and placement; thoughts)                                    |
| P13 | Staff wages: decide cadence (Q1), show the wage in the UI, hire-cost decision                                                                                                                                             | 18             | S    | Q1                                                                               |
| P14 | Doc drift: align the mechanics summary and module Noridocs with the current implementation                                                                                                                                | 26             | S    | none                                                                             |

Suggested order: P2 and P5 (small, no dependency), P1, P7, P3, P4, P6, then P8 (largest, unblocks P9), P10, P11, P12, P13 and P14 in parallel with the rest.

### 8.3 Documentation status

PR #42 refreshes the guest, map, worker, weather, save, and mechanics summaries. It adds monthly base temperatures selected by scenario climate and a partial scenery/cleanliness thought scan. Terrain command prices now count actual propagated height changes and absolute-height commands enforce ownership and affordability; security records deterred vandal attempts. Remaining gaps include the seven unrepresented weather types and weather weights/forecast schedule, scenery catalog/placement/fountain/music effects, exact litter happiness thoughts, full vandalism targets/cadence, and scenario-specific land prices and controls; see §7 and `docs/DECISIONS.md`.

---

## 9. Open questions

- Q1. Wage cadence: resolved as weekly payroll at rounded weekly equivalents of the manual's monthly role salaries, matching the economy clock; the per-call source note remains unverified.
- Q2. Weather sampling: the rotation and scaling rule that turns the monthly counts into a random pick. Until this is known, do not state percentages.
- Q3. Original tick rate, and whether 40 Hz is faithful. All original durations here are in ticks.
- Q4. Land purchase price per scenario and the construction-rights price; surface object prices; path placement price; smooth action per-step costs.
- Q5. Ride shelter counts: how the 8 sheltered eighths of a ride are derived from our track and roofs. The rain rule depends on it.
- Q6. Thunderstorm row: is it precipitating for guest decisions?
- Q7. Cold purchase threshold: 12 °C in the purchase rule against 11 °C in the climate thresholds. Which one applies?
- Q8. Staff hire cost and cap; mechanic inspection interval and repair timing.
- Q9. Repair cost for broken benches, bins and lamps.
- Q10. Months November to February in the climate data.

---

## 10. Sources

Pinned commit `47163dabbb7a13d1bf11e6c24e735c3d59201208` (OpenRCT2; checked by the spec writer where marked `[C]`):

- Weather: https://github.com/OpenRCT2/OpenRCT2/blob/47163dabbb7a13d1bf11e6c24e735c3d59201208/src/openrct2/world/Weather.cpp
- Staff: https://github.com/OpenRCT2/OpenRCT2/blob/47163dabbb7a13d1bf11e6c24e735c3d59201208/src/openrct2/entity/Staff.cpp
- Guest: https://github.com/OpenRCT2/OpenRCT2/blob/47163dabbb7a13d1bf11e6c24e735c3d59201208/src/openrct2/entity/Guest.cpp
- Peep: https://github.com/OpenRCT2/OpenRCT2/blob/47163dabbb7a13d1bf11e6c24e735c3d59201208/src/openrct2/entity/Peep.cpp
- Litter: https://github.com/OpenRCT2/OpenRCT2/blob/47163dabbb7a13d1bf11e6c24e735c3d59201208/src/openrct2/entity/Litter.cpp
- Park: https://github.com/OpenRCT2/OpenRCT2/blob/47163dabbb7a13d1bf11e6c24e735c3d59201208/src/openrct2/world/Park.cpp
- Land height change: https://github.com/OpenRCT2/OpenRCT2/blob/47163dabbb7a13d1bf11e6c24e735c3d59201208/src/openrct2/actions/terraform/LandSetHeightAction.cpp
- Water height change: https://github.com/OpenRCT2/OpenRCT2/blob/47163dabbb7a13d1bf11e6c24e735c3d59201208/src/openrct2/actions/terraform/WaterSetHeightAction.cpp

Develop branch (not pinned; read by research passes, `[V]`):

- Finance: https://raw.githubusercontent.com/OpenRCT2/OpenRCT2/develop/src/openrct2/management/Finance.cpp
- Land raise and lower: https://raw.githubusercontent.com/OpenRCT2/OpenRCT2/develop/src/openrct2/actions/terraform/LandRaiseAction.cpp and LandLowerAction.cpp
- Water raise: https://raw.githubusercontent.com/OpenRCT2/OpenRCT2/develop/src/openrct2/actions/terraform/WaterRaiseAction.cpp
- Surface style: https://raw.githubusercontent.com/OpenRCT2/OpenRCT2/develop/src/openrct2/actions/terraform/SurfaceSetStyleAction.cpp
- Clear: https://raw.githubusercontent.com/OpenRCT2/OpenRCT2/develop/src/openrct2/actions/terraform/ClearAction.cpp
- Land purchase: https://raw.githubusercontent.com/OpenRCT2/OpenRCT2/develop/src/openrct2/actions/park/LandBuyRightsAction.cpp
- Map ownership: https://raw.githubusercontent.com/OpenRCT2/OpenRCT2/develop/src/openrct2/world/MapOwnership.cpp, and https://raw.githubusercontent.com/OpenRCT2/OpenRCT2/develop/src/openrct2/world/MapLimits.h
- Climate object loader: https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/object/ClimateObject.cpp
- Patrol area storage: https://raw.githubusercontent.com/OpenRCT2/OpenRCT2/develop/src/openrct2/entity/PatrolArea.h
- Litter types: https://raw.githubusercontent.com/OpenRCT2/OpenRCT2/develop/src/openrct2/entity/Litter.h
- Path addition flags: https://raw.githubusercontent.com/OpenRCT2/OpenRCT2/develop/src/openrct2/object/PathAdditionFlags.h

Data (objects repository, climate folder, master):

- https://github.com/OpenRCT2/objects/tree/master/objects/rct2/climate (cold, cool_and_wet, hot_and_dry, warm; the JSON files `rct2.climate.*.json`)
- https://github.com/OpenRCT2/objects/tree/master/objects/rct2/footpath_item (stock benches and lamps, breakable flag)

Player documentation (secondary, `[S]`):

- https://docs.openrct2.io/en/latest/playing/staff/
- https://docs.openrct2.io/en/latest/playing/finances/index.html
- https://rct.fandom.com/wiki/Guests_and_Staff (seen in search, not fetched)
- https://outof.games/realms/rollercoastertycoon/guides/541-guide-to-food-and-drink-stalls-in-rollercoaster-tycoon-1-and-2/ (rain and food sales; matches §4.4)

Our code (paths relative to the repo root): `src/sim/staff/`, `src/sim/guests/` (`litter-system.ts`, `litter-store.ts`, `vandalism.ts`, `guest-system.ts`), `src/sim/weather/`, `src/sim/map/` (`land.ts`, `map-commands.ts`, `tile-map.ts`, `terrain.ts`), `src/sim/economy/`, `src/sim/rides/ride-operations.ts`, `src/sim/core/constants.ts`.

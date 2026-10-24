# Fidelity: track, vehicles, G-forces, crashes and coaster ratings

Clean-room spec comparing OpenCoaster's coaster subsystem with the original game's behaviour. Behaviour is described in our own words. Sources were studied for facts only; no code, function names or data tables were copied. Numbers are cited to the page they came from.

Confidence tags:

- **[V]** verified: two or more sources agree.
- **[S]** single source (a source summary, a forum post, or a search snippet).
- **[U]** unresolved: sources conflict or units are unknown.
- **[O]** open: no source found yet.

Source notes. The fandom wiki (rct.fandom.com) returned HTTP 402 on direct fetch, so its content is cited only from search snippets. The OpenRCT2 wiki host did not resolve. Two code summaries (`RideRatings.cpp`, `Vehicle.cpp`) were read through an LLM summariser, so exact figures there are [S] at best. Where the summary and the wiki disagree, the disagreement is recorded.

Sources (all URLs are plain text):

- S1 https://github.com/OpenRCT2/OpenRCT2/wiki/Ride-rating-calculation (incomplete page; ride-independent terms)
- S2 https://raw.githubusercontent.com/OpenRCT2/OpenRCT2/develop/src/openrct2/ride/RideRatings.cpp (read via summariser)
- S3 https://raw.githubusercontent.com/OpenRCT2/OpenRCT2/develop/src/openrct2/ride/Vehicle.cpp (read via summariser)
- S4 https://forums.openrct2.org/topic/842-how-are-excitement-intensity-and-nausia-ratings-calculated-exactly/ (points to S1 and S2; no formulas itself)
- S5 https://rct.fandom.com/wiki/Crash (402; snippet only)
- S6 https://forums.openrct2.org/topic/2916-dinghy-crashing-potential-problem/ (crash mechanics, qualitative)
- S7 https://forums.rctgo.com/printthread.php?tid=21333 (lateral-G community guidance, 2016, not authoritative)
- S8 https://rct.fandom.com/wiki/G-forces (page listed in search; not fetched)
- S9 `docs/mechanics/track.md` in this repo (existing spec; its citations are inherited, not re-verified here)

---

## 1. Original behaviour

### 1.1 Ride-independent rating terms

Ratings are kept in hundredths of a point (100 = 1.00). Each ride-type then adds its base values, applies its multipliers, and clamps each result to 0–32767 [S2].

**G-forces** [V: S1, S2 agree]. Let `P` be the maximum positive vertical G, `N` the maximum negative vertical G (clamped to −2.50…0), and `L` the maximum lateral G (used up to 1.50 for excitement).

| Rating | Term | Coefficient |
|---|---|---|
| Excitement | from `P` | +0.08 per G |
| Excitement | from `N` | −0.24 per G of `N` (so positive) |
| Excitement | from `L` | +0.40 per G, capped at `L = 1.50` |
| Intensity | from `P` | +0.80 per G |
| Intensity | from `N` | +0.80 × (1 − N) |
| Intensity | from `L` | +1.00 per G |
| Nausea | from `P` | +0.26 per G |
| Nausea | from `N` | +0.22 × (1 − N) |
| Nausea | from `L` | +0.33 per G |

**Lateral-G penalties** [V for intensity and nausea; U for excitement].

- Above 2.80 lateral G: intensity +3.75, nausea +2.00 [V: S1, S2, S7].
- Above 3.10 lateral G, in addition: intensity +8.50, nausea +4.00 [V: S1, S2].
- Above 3.10: excitement is halved [S1]. S2 instead describes excitement becoming a negative value equal to half the combined G-excitement, and calls it a "non-original mode". This conflict is open (see gap G-14). The cumulative intensity and nausea totals (12.25 and 6.00) match between S1 and S2.

**Drops** [U: units of the drop term are not stated].

- S1: excitement 0.11 × min(9, drops) + 0.0049 × H; intensity 0.14 × drops + 0.0098 × H; nausea 0.10 × drops + 0.0016 × H. H is "highest drop", unit unstated.
- S2: drop count gives excitement ≈11.11 per drop (max 9), intensity ≈14.17 per drop, nausea 10 per drop. The highest-drop term uses twice the drop height and adds 0.244 excitement, 0.488 intensity and 0.156 nausea per unit of that doubled height.
- S2's coefficients are about 25× S1's for the same H if the unit is the same. The unit of H (world units, or steps of 32 units) is the deciding question and is open.

**Inversions** [V in shape; S for exact values]. Excitement 0.27 each, capped at 6 inversions (S2 gives ≈26.67); intensity 0.50 each, uncapped; nausea 0.22 each, uncapped (S2 gives ≈21.67).

**Intensity penalty** [V: S1, S2]. For each intensity threshold passed (10.00, 11.00, 12.00, 13.20, 14.50), excitement drops to 75% of its current value. Passing all five leaves about 23.7% [S2 gives 0.237].

**Air time** [S2]. Standard types: excitement gains air time up to 200 units, divided by 8; nausea gains air time ÷ 16 with the same cap. Limited-air-time types: air time above 96 units reduces excitement by (air time − 96) ÷ 8, capped at 200 units, and adds nausea at air time ÷ 16 with the same cap. Air time is measured in source units, not ticks, and the unit conversion is open.

**Turns** [S2]. Counted per element type.

| Turn type | 1 element | 2 elements | 3+ elements |
|---|---|---|---|
| Flat, excitement | ≈0.968 | 3.00 | 2.50 |
| Flat, intensity | ≈0.323 | 0.75 | 1.25 |
| Flat, nausea | ≈0.645 | 3.125 | 5.00 |
| Banked, excitement | ≈1.129 | 3.75 | 3.75 |
| Banked, intensity | ≈0.323 | 0.75 | 1.25 |
| Banked, nausea | ≈0.742 | 3.125 | 5.00 |

Sloped turns (intensity always 0): 4+ elements give excitement 7.5 each (capped at 4 elements) and nausea 7.5 each (capped at 8). Three elements give excitement ≈4.167 each (cap 6); two give ≈3.667 each (cap 6); one gives ≈2.857 each (cap 7).

**Helices** [S2]. Excitement ≈3.89 each (up to 9); intensity ≈2.27 each (up to 11); nausea 20 each beyond the fifth helix (up to 10 counted).

**Sheltered track** [S2]. Per sheltered unit of length: excitement ≈0.14 (cap 1000), intensity ≈0.15 (cap 2000), nausea 0.25 (cap 1000). Each banked or rotating sheltered section adds excitement +20 and nausea +15. Sheltered sections count ≈11.82 excitement each (cap 11). A requirement on sheltered length divides all ratings when unmet.

**Scenery** [S2]. Count scenery items within five tiles of the station (clipped to the map), cap at 47, multiply by 5 (maximum 235 excitement). An underground station scores a fixed 40.

**Proximity** [S2]. Each nearby feature is counted, capped and multiplied. Notable values: water touching up to 22 × ≈2.27; surface touching up to 70 × ≈1.71; own track close above up to 5 × 6.0; foreign track close above up to 5 × 9.0; foreign track touching above up to 15 × ≈4.67; vertical loop through-track up to 6 × 20.0; intersecting loop flat 100; own station touching above flat 55, close above flat 25; side-close surface, path and foreign track up to 20 each at 2.5, 1.75 and 2.25. The total is multiplied by the ride's excitement factor.

**Length and speed** [S2]. Track length, maximum speed and average speed each add a per-unit amount, scaled by the ride-type modifier, with per-type caps. Train length adds excitement per car beyond the first. Exact per-type constants are not given in the sources read here [O].

**Requirements (divide-by penalties)** [S2]. Unmet requirements divide ratings by the modifier's factors. Thresholds exist for length, drop height, speed, drop count, negative G, lateral G, inversions, sheltered length, reversers, holes and splashdowns. If the station count is at or below its threshold, excitement is set to 0 and the others are divided. The factors and thresholds per type are not in the sources read here [O].

**Other bonuses** [S2]. Synchronised stations (flat points), train count at or above a threshold (flat points), reversers and holes (points per item up to a cap), reversed trains (ratings × factor ÷ 128), and per-ride operation options.

**Combination order** [S2]. Base values, then bonuses and requirement divisions, then the intensity penalty on excitement, then ride-type multipliers as percentages (value × multiplier ÷ 128), then air-time effects, then clamp to 0–32767.

### 1.2 Vehicle physics and G-forces

- **Gravity** [S3]: a fixed constant is multiplied by the vehicle's pitch and roll factors to get the vertical gravity component. The constant is in internal units, and no conversion to km/h or tiles is given.
- **Drag** [S3]: a deceleration proportional to the square of speed, opposing motion, divided by total train mass. Mass is clamped to at least 1 per car. No separate friction coefficient was found.
- **Speed and distance** [S3]: speed is kept in integer internal units. The source compares speeds with imperial thresholds (11 mph and 2 mph appear).
- **Cable lift** [S3]: when speed is at or below 439800 internal units, acceleration is set to 4398 internal units. The conversion of these to mph is open [O].
- **Breakdown** [S3]: a breakdown during a lift trip sets velocity to zero.
- **Block timing** [S3]: minimum wait 3 and maximum 127 (ticks, presumed), applied when a ride needs a minimum train length.
- **Vertical G** [S3]: gravity term plus speed term |v| × 98 divided by a per-element vertical factor, scaled and shifted to two decimals. Lateral G uses the same form with a lateral factor. Samples are averaged with the previous sample. Vertical G at or below zero counts as air time. Vertical G starts at 1.0 at rest.
- **Collisions** [S3]: a collision-disabled flag is set during relative moves. Trains enable collisions car by car from the head car. Block reservation looks ahead 4 sections plus |v| / 150000.
- **Crash state** [S3]: handled by an update routine whose body was not returned by the summariser. No speed threshold is available from S3 [O].

### 1.3 Crash rules

- Rides with unattached cars crash when they reach a crest or start a drop too fast [S5 snippet, S6]. The existing spec's figures (50 km/h at a crest, 64 km/h at a drop, 48 km/h combined for a train-to-train collision) come from a search snippet and are [U] until S5 is readable.
- Rider weight increases car speed, so a train that passes test runs can still crash once full [S6].
- Holding a brake before a steep-to-level section prevents the crash in the reported cases [S6, forum anecdote].
- Most coaster types can crash, but a ride can be made crash-proof by design [S5 snippet].

### 1.4 Track pieces, supports, height limits

- Track availability per coaster type: [O]. The snippets found list coaster categories but no RCT2 piece list.
- Maximum height and track slope: [O]. A single snippet gives a 78 ft height and 25° slope for the wooden Reverser, but it is from the original game's section and is not confirmed for RCT2.
- Support pillars and their rules: [O].
- Underground and tunnel rules: [O] (the station underground value of 40 in §1.1 is the only number found).

---

## 2. Gap table: ours vs original

Severity: **GP** = gameplay-visible (changes ratings, crashes or feel); **SU** = subtle (small numeric drift or edge case). File references are to the repo at commit eb77b16.

| ID | Area | Ours | Original | Sev | Suggested fix |
|---|---|---|---|---|---|
| G-01 | Crash defaults | `src/sim/vehicles/vehicle-track.ts:295`: `crashable` defaults to false, so crest and drop crashes never happen unless a track opts in. | Unattached-car types crash at crest and drop start [S5, S6]. | GP | Enable crash checks for the ride types that crash, and set the default per type. Needs a per-type flag in the track catalog. |
| G-02 | Crash thresholds, units | `vehicle-track.ts:296-297`: crest 50 × 256 and drop 64 × 256 Q8 units, which is 50 and 64 units per tick. The module's own scale is 1 unit per tick ≈ 5.1 km/h, so that is ≈255 and ≈326 km/h. | 50 and 64 km/h [U, S5 snippet]. | GP | Convert km/h to units per tick at the stated scale: 50 km/h ≈ 9.8 units, 64 km/h ≈ 12.5 units. Keep the constant table with the conversion written next to it. Confirm the scale first (G-15). |
| G-03 | Train-to-train collision | `vehicle-system.ts:40` and `:613`: combined speed threshold 48 × Q8 = 48 units per tick, ≈245 km/h combined. | 48 km/h combined [U]. | GP | Same conversion as G-02: 48 km/h ≈ 9.4 units combined. |
| G-04 | Turn, helix, sheltered rating terms | Not implemented. `src/sim/vehicles/vehicle-ratings.ts` has only force, drop, inversion, speed, length and air-time terms. | Per-element turn bonuses, helix bonuses, sheltered bonuses and their caps [S2]. | GP | Count turn type and element count, helices and sheltered length during the test run in `vehicle-system.ts`, then add the terms in `vehicle-ratings.ts`. Use the table in §1.1. |
| G-05 | Base ratings combination | `src/sim/rides/coaster-system.ts:58-60` adds each ride-type base value to the track rating. | Ride-type multipliers scale the rating, applied after bonuses [S1, S2]. | GP | Change to multiply by the type's factors. Needs the per-type constants (see G-12). |
| G-06 | Requirement and penalty terms | Not implemented (no divide-by requirements). | Ratings are divided when length, drop, speed, negative G, lateral G, inversions or station count fall short [S2]. | GP | Add the requirement stage after bonuses. Exact thresholds and divisors are needed first (open). |
| G-07 | Scenery and proximity | Not implemented in ratings. | Scenery within 5 tiles of the station (max 235 excitement) and the proximity table in §1.1 [S2]. | GP | Separate PR. Needs a park-level query over tiles. Start with station-scenery count and underground station. |
| G-08 | Speed and length terms | `vehicle-ratings.ts:50`: length term `min(250, length / 1024)`; `:51`: air-time term. Speed terms also present. These have no source. | Per-type per-unit amounts with caps [S2]. | GP | Mark as provisional in code until constants are sourced. Replace once a per-type table is found (G-12). |
| G-09 | Drop term scale | `vehicle-ratings.ts:23` and `:40`: drop height in steps of 32 units, coefficient 0.0049 per step. | S1 gives 0.0049 per unit of H with the unit unstated. S2 gives 0.244 per unit of doubled height [U]. | GP (suspected) | Resolve the unit of H in S1 and S2 before any change. If the unit is one world unit, the code is about 32× low. Do not change until resolved (G-15). |
| G-10 | Air-time term | `vehicle-ratings.ts:51`: `min(100, airtimeTicks × 2)` added to excitement only. Ticks, not units. | Excitement ÷ 8 and nausea ÷ 16, capped at 200 units, with a limited-air-time variant [S2]. | GP | Record air time in source-equivalent units. Add the nausea term. Use the S2 caps. |
| G-11 | Intensity penalty | `vehicle-ratings.ts:76-77`: thresholds 10, 11, 12, 13.2, 14.5 and factor 0.75. Matches. | Same thresholds, but the original scales them by the vehicle's intensity factor [S1, S2]. | SU | Add the per-vehicle intensity factor input. Default it to 1. |
| G-12 | Drop and inversion counts | `vehicle-ratings.ts:45`: 11 per drop (cap 9); `:47`: 27 per inversion (cap 6). Intensity drop 14, nausea 10 per drop. | ≈11.11 and ≈14.17 per drop; ≈26.67 and ≈21.67 per inversion [S2]. Nausea per inversion 22 vs ≈21.67. | SU | Adopt the source-equivalent integers in hundredths (11.11, 14.17, 26.67, 21.67) once G-09 is resolved. |
| G-13 | Rating clamp | `vehicle-ratings.ts:80-82` clamps to 0–0xffff. | Clamp to 0–32767 [S2]. | SU | Change clamp max to 32767. |
| G-14 | Lateral above 3.1 G, excitement | `vehicle-ratings.ts:72`: excitement halved. | Halved [S1], or negative of half the G-excitement [S2]. | SU (open) | Resolve between S1 and S2 before change. Check the OpenRCT2 ride-rating source directly. |
| G-15 | Speed scale and unit conversion | Documented in `src/sim/vehicles/docs.md` as 1 unit per tick ≈ 5.1 km/h. Not stated in code. | Source gives internal units with no conversion (S3). | GP | Confirm the scale against a known build (e.g. a 2.8 G table in the existing spec). Record it once in the constants module and reference it from G-02 and G-03. |
| G-16 | Gravity, lift, launch, brake constants | `vehicle-system.ts:21` gravity 32, `:33` lift 1280 (≈25 km/h), `:34` launch 4096 units, `:38` brake 160. | Gravity: fixed constant × pitch and roll factors [S3]. Lift: 439800 internal units [S3]. No launch or brake numbers found [O]. | GP | Map the original's internal units to ours after G-15. Until then the lift and launch values are design values. |
| G-17 | G-force sampling | Head only; per-car forces not modelled (`docs/`: vehicles docs). | Per-car forces in the original are not confirmed [O]. | SU | Keep as is. Note as an open question. |
| G-18 | Track availability per coaster type | `src/sim/track/track-commands.ts:37-41` gates pieces by three flags: steep slopes, inversions, launch. There is no per-type piece list. | Per-type piece lists exist in the original [O]. | GP | Needs a piece-by-type table from a source first. |
| G-19 | Height limits, supports, tunnels | `CLEARANCE_UNITS` in `src/sim/track/catalog.ts` is the only height rule. No support model. | Max height and slope per type, support pillars, tunnel rules [O]. | GP | Needs sources first. |

---

## 3. Prioritised fix list (PR-sized)

Each item is one PR. Items marked "needs source" are blocked on research and should not be coded until the source is in hand.

**P1: gameplay-visible, unblocked**

1. **PR-A: crash units and defaults.** Fix G-02 and G-03 by converting km/h to units at the confirmed scale (G-15). Add a per-type crashable setting (G-01) for the types that can crash. Tests: a train over a crest at 9.9 units crashes; at 9.7 it does not. Blocked on G-15 confirmation.
2. **PR-B: base ratings multiply.** Fix G-05 with the per-type multipliers. Blocked on G-12's per-type constants for the coaster types we ship.
3. **PR-C: turn, helix and sheltered terms.** Fix G-04. Track element counts in the test run, then add the §1.1 tables. No blocker.
4. **PR-D: air-time shape.** Fix G-10: units conversion, nausea term, S2 caps. No blocker.
5. **PR-E: requirement stage.** Fix G-06. Needs the per-type thresholds and divisors (needs source).
6. **PR-F: scenery and station proximity.** Fix G-07, starting with station scenery count and underground station. Separate, larger PR.

**P2: subtle or blocked**

7. **PR-G: drop coefficient.** Fix G-09 after the unit is resolved (G-15). Blocked on source.
8. **PR-H: count and clamp constants.** Fix G-12 and G-13. No blocker once G-09 is resolved.
9. **PR-I: intensity factor input.** Fix G-11. No blocker.
10. **PR-J: lateral-G above 3.1 excitement.** Resolve G-14 by reading the OpenRCT2 rating source directly, then change one line. Blocked on source.

**P3: research**

11. **Research R1: piece lists, height, slope, supports, tunnels per coaster type** (G-18, G-19). No source found yet. Next steps: a coaster-type page on a readable RCT wiki mirror, or a manual playtest of the original.
12. **Research R2: per-type rating constants** (G-08, G-12). Needed for PR-B and PR-E.
13. **Research R3: unit mapping for gravity, lift and launch** (G-16). Needs a known-speed test in the original.

---

## 4. Verification

This PR is a document; no code or tests change. The only file touched is this one. Tests and CI are unaffected. Before any PR-A to PR-J item lands, its numbers should be checked against a playtest of the original or against the source it cites.

## 5. Open questions

- Which unit do S1 and S2 use for the highest-drop term (G-09)?
- Is the >3.1 G penalty a halving or a negative-excitement mode (G-14)?
- What is the original's km/h-per-internal-unit scale (G-15)?
- Which RCT2 coaster types allow which pieces, and their height and slope limits (G-18, G-19)?

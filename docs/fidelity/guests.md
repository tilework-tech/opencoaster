# Guests: fidelity audit against the original

Status: research audit. Compares OpenCoaster's guest simulation (`src/sim/guests`, `src/sim/pathfinding`) with the original game's guest behaviour, and sizes the fixes into PR-sized tasks.

Scope: guest needs and decay, thoughts, ride choice, pathfinding, money spending, leaving, crowding.

## Method and clean-room note

- The original-behaviour sections come from public OpenRCT2 sources studied for behaviour only: the OpenRCT2 guest entity source (`src/openrct2/entity/Guest.cpp`, develop branch) and the OpenRCT2 wiki page "Peep AI". Nothing here quotes code or names functions from them. Constants are restated in our own words.
- Those two sources were read through a summarising fetch tool, not line by line. Every number in Section 2 is therefore **[S-fetch]**: it matches the summary, but it has not been checked against the source text. Before an implementer relies on a number, check it against the source. Section 2 says which items are unresolved.
- Ride-rating constants and the older guest-spawn guide come from [docs/mechanics/guests.md](../mechanics/guests.md). They are not re-derived here.
- Time units: the original's periodic updates are expressed in game ticks at 40 Hz, the same base as our `TICK_RATE`. That base is an assumption carried over from [docs/DECISIONS.md](../DECISIONS.md), not a confirmed fact.
- Our side was read from the code at commit eb77b16 (main). Line numbers refer to that commit.

Confidence legend: **[S-fetch]** stated in a source read through the summary tool; **[S]** single secondary source; **[I]** our inference; **UNRESOLVED** no usable source found.

Sources:

- OpenRCT2 guest entity source: https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/entity/Guest.cpp
- OpenRCT2 wiki, Peep AI (path finding): https://github.com/OpenRCT2/OpenRCT2/wiki/Peep-AI
- OpenRCT2 wiki, Ride rating calculation: https://github.com/OpenRCT2/OpenRCT2/wiki/Ride-rating-calculation
- Older guide cited in [docs/mechanics/guests.md](../mechanics/guests.md): https://forums.openrct2.org/topic/2861-guide-when-and-how-do-guests-spawn/

---

## 1. Summary

This audit records the guest fidelity work and its remaining gaps. This change implements the cadence, spawn energy and tolerance buckets, probabilistic leaving, need-linked happiness loss, satiation scale migration, repeat-ride gate, queue balking and vandalism gates. The following remain outside this change:

- Lost-guest navigation remains unresolved and is a follow-up; this change does not alter pathfinding or exit navigation.
- Ride choice still uses a linear score instead of the documented intensity and nausea bands.
- Energy remains a simple walking drain and ride gain, not the original target model.
- Thought timing, sit/ride motives, scenery, vomit and item-use behavior remain incomplete.

Section 3 is the gap table. Section 4 is the prioritised fix list. Section 5 lists open questions.

---

## 2. Original behaviour

Units: the original stores needs and preferences as 0–255 values. Where it describes a "pass", it means one guest update: the consumption and smoothing update runs every 128 ticks; the motive block every 512 ticks; the thought check every 1024 ticks. [S-fetch Guest.cpp]

### 2.1 Update cadence

- O-1 Guest update runs every 128 ticks. Consumption, energy, happiness and nausea smoothing run on that pass. [S-fetch Guest.cpp]
- O-2 Idle motives (happiness drift, nausea decay, happiness penalties from needs) run every 512 ticks. [S-fetch Guest.cpp]
- O-3 Thought checks run every 1024 ticks. Some thoughts fire on alternate passes. [S-fetch Guest.cpp]

### 2.2 Needs decay and gain

Consumption, every 128-tick pass:

- O-4 A food or drink being consumed has a timer that starts at 3 and drops by 3 per pass. [S-fetch]
- O-5 While drinking: thirst rises by 7 per pass, capped at 255. [S-fetch]
- O-6 While eating: hunger rises by 7 per pass, capped at 255; thirst drops by 3, floored at 0; toilet rises by 2, capped at 255. [S-fetch]

The original's hunger and thirst are satiation scales: a high value means full. "Hungry" is a low value. The implementation follows this scale; version 12 inverts values from saves through version 11. See gap N9 for the remaining threshold and item-magnitude questions.

Energy and smoothing, every 128-tick pass:

- O-7 Energy moves toward a target. It drops by 2 when at or above the target and rises by 4 when below, clamped between minimum and maximum. [S-fetch]
- O-8 Happiness and nausea each move toward their targets by 4 per pass. [S-fetch]

Idle motives, every 512-tick pass:

- O-9 Happiness target drifts toward 127 by 1 per pass. [S-fetch]
- O-10 Nausea target drops by 2 per pass, floored at 0. [S-fetch]
- O-11 Happiness target is reduced by 2 if energy is 50 or less; by 1 if hunger is below 10; by 1 if thirst is below 10; by 1 if toilet is 195 or more. [S-fetch]
- O-12 A walking guest whose nausea target is 128 or more may vomit, with a chance based on nausea. [S-fetch]

Flag-driven motives, every 512-tick pass:

- O-13 Hunger flag: hunger drops by 15 per pass, if at least 15. [S-fetch]
- O-14 Toilet flag: toilet rises by 50 per pass, while 180 or less. [S-fetch]
- O-15 Happiness flag forces the happiness target to 5. Nausea flag forces the nausea target to 200 and raises nausea to at least 130. Angriness decrements by 1 per pass. [S-fetch]

Activity effects:

- O-16 Sitting: energy target rises by 5 per pass while 135 or less. While thirst is at least 5, thirst drops by 4 and toilet rises by 3 (capped). Nausea target drops by 6 per pass while at least 50. [S-fetch]
- O-17 On a ride for more than 15 passes, the happiness target drops by 5 per pass, floored at 0. After 22 passes a "get off" thought appears. [S-fetch]
- O-18 Walking or sitting guests assess their surroundings every 18 passes. A pleasant-scenery thought adds 45 to the happiness target, capped at the maximum. [S-fetch]
- O-19 Queuing for 2000 or more ticks: a queue TV monitor raises the happiness target to at least 90 and adds 2 per pass, up to 165. Without one, the target drops by 4 per pass. [S-fetch]

Initial values:

- O-20 Energy starts between 65 and 128. [S-fetch]
- O-21 Cash starts at a random 0–300 added to the scenario's starting cash, minus 100, floored at 0. If the scenario's starting cash is 0, the guest gets 500. In a no-money park the guest gets 0. [S-fetch]
- O-22 Happiness, hunger and thirst at spawn: UNRESOLVED (not in the sections read).

### 2.3 Thoughts and their triggers

Checked every 1024 ticks [S-fetch]:

- O-23 Tired: energy 70 or less and happiness below 128.
- O-24 Hungry: hunger 10 or less with no food or drink in hand.
- O-25 Thirsty: thirst 25 or less with no food or drink in hand.
- O-26 Needs toilet: toilet 160 or more.
- O-27 Running out of money: cash 9.00 or less, happiness 105 or more, energy 70 or more.
- O-28 Sick: nausea 140 or more. Very sick: nausea 200 or more, which also starts a first-aid search.
- O-29 Queuing for ages: at least 3500 ticks in a queue, with about a 0.14% chance per check.
- O-30 Go home: when the guest decides to leave (see 2.5).
- O-31 Scenery and environment thoughts (fountains, scenery density, music, a very clean park) depend on nearby litter counts within 5 tiles. [S-fetch]
- O-32 New ride: a guest watching a ride from an unusual seat. [S-fetch]
- O-33 Thought freshness: a new thought can replace the last only after a 220-tick gap; a thought is removed after about 6900 ticks. [S-fetch]
- O-34 Buying food, drink, or using a toilet clears the matching need thought. [S-fetch]

The full set of thought strings was not captured; the list above is what the code sections read contain.

### 2.4 Queueing and patience

- O-35 A queuing guest is at the front when no guest is within 32 units ahead. [S-fetch]
- O-36 After 2000 ticks in line, a guest checks every few ticks with roughly a 0.18% chance to eat or check a watch. [S-fetch]
- O-37 Balking: if happiness is 65 or lower, the guest has queued at least 4300 ticks, and a roll below 2184 (about 3.3%) hits, the guest gives up, turns round and walks away. [S-fetch]
- O-38 Queues are dropped if the ride closes. [S-fetch]
- O-39 Displayed queue time is the guest's days in queue plus 3, halved. [S-fetch]

### 2.5 Leaving the park

- O-40 Walking guests who have been in the park for at least 5 units of 2048 ticks (10,240 ticks) and have no ride to head for get a happiness target penalty of 128, floored at 0, and then run the leave check. [S-fetch]
- O-41 Leave check (not already leaving). Without the no-money rule: the guest stays if energy is at least 55, happiness at least 45, and cash at least 5.00. With no-money: the guest stays if energy is at least 70 and happiness at least 60. Guests who fail the check still stay about 95% of the time (a roll against 3276 of 65536). So a guest below the thresholds leaves at about 5% per check. [S-fetch; the threshold direction is taken from the summary and should be re-read]
- O-42 Leaving sets a leaving flag and a 254-tick countdown, clears the entrance-chosen flag, and adds a "go home" thought. [S-fetch]
- O-43 While leaving, the energy target drops by 2 per pass while at least 33, and thirst drops by 1 per pass when the temperature is at least 21 and thirst is at least 5. Leaving guests are barred from heading to rides. [S-fetch]
- O-44 A leaving guest that cannot find the exit sees a warning and loses 30 happiness every 90 passes. [S-fetch]

### 2.6 Ride choice

Intensity and nausea preferences at spawn [S-fetch]:

- O-45 Intensity lower bound: a random 3–10, minus 3, capped at 4. If the upper bound reaches 7 or more it becomes 15. Park settings override this: prefer less intense rides gives 0–4; prefer more intense gives 9–15; both gives 0–15.
- O-46 Nausea tolerance: a roll of 0–7 maps to none (0), low (1–2), average (3–5), high (6–7). Parks preferring intense rides shift the roll by +4.

Repeat rides [S-fetch]:

- O-47 "Ride again" needs: the ride type allows repeats, the ride is rated, intensity is 10.00 or less (unless the cheat is on), happiness at least 180, energy 100, nausea 160 or less, hunger at least 30, thirst at least 20, toilet 170 or less.
- O-48 When those hold, a random roll decides: about 49.6% allow it outright; about 25.4% allow it only if the guest has taken 7 or fewer rides; the rest (25%) refuse.
- O-49 "Really liked": happiness at least 215, nausea 120 or less, rated, intensity 10.00 or less.
- O-50 Intensity preference can rise for a guest with happiness at least 200, unless the park prefers less intense rides.

Scoring [S-fetch]:

- O-51 Intensity and nausea are each scored in three bands: the guest's preferred range, widened by twice happiness, then widened again. Each band that contains the ride's value lowers that dimension's counter from 3. The worse of the two counters sets the score.
- O-52 Perfect match scores +70; no match scores between −35 and −60. A ride with no ratings scores +70.
- O-53 Nausea uses the preferred limits only for average or high tolerance guests.
- O-54 Nausea growth on a ride scales with the happiness target, hunger, and tolerance (divisor 1, 2, 4 or 8 for none, low, average, high). [S-fetch]
- O-55 Nearest suitable ride is chosen by Manhattan distance. Guests on a map consider all rides; others consider rides within 10 tiles. [S-fetch]

The excitement weighting is not in the sections read. UNRESOLVED. Ride ratings and their formula are in [docs/mechanics/guests.md](../mechanics/guests.md) §2.3 (source: the OpenRCT2 ride-rating wiki page).

### 2.7 Pathfinding

From the Peep AI page [S-fetch]:

- O-56 Tile budget per decision: 15,000 for guests.
- O-57 Junction budget per decision: 16 minus 10, which is 6 for guests. Each junction walked costs 1, or 2 after a stretch with no choice. Single-exit runs are not counted, so guests can prefer a long single-exit route over a short one with more junctions. The page says the base value "depends on other things" without saying what.
- O-58 Branches that have travelled more than 200 tiles are abandoned.
- O-59 Score: the smaller of the x and y distance to the goal, divided by 16, plus twice the height difference. Lower is better; 0 means the goal is reached. Ties go to the route with fewer steps.
- O-60 Validity: a tile must be a footpath; a sloped path must connect to the current tile; paths wider than 3×3 are not allowed; a queue path is used only when searching for a queue; reversing is never an edge.
- O-61 When the goal matches the guest's current target, the last four locations narrow the edges searched. [S-fetch]
- O-62 Lost-guest trigger: UNRESOLVED. The Peep AI page does not describe it. The guest source has a lost countdown field whose logic was not in the sections read.

### 2.8 Money and spending

- O-63 Cash machine: a guest with cash at most 20.00, energy at least 80, and a happiness roll (a base of 115 plus a random 0–127 must not exceed happiness) withdraws 50.00. [S-fetch]
- O-64 Food, drink and toilet purchases follow the price rules above; the "running out of money" thought appears at cash 9.00 or less (O-27).

### 2.9 Litter, vomit, bins

- O-65 Vomiting halves hunger and the nausea target, reduces nausea by 30 (floored at 0), and leaves a vomit litter. [S-fetch]
- O-66 Bins: a guest only looks for a bin while carrying an empty container. At the bin, the item is always removed; the bin's space drops with a 1-in-8 chance per item. If the bin is full, the item becomes litter within three tiles of the guest. [S-fetch]
- O-67 The rate at which guests create trash without vomit: UNRESOLVED.

### 2.10 Vandalism

- O-68 A guest may break a bench or other breakable path element only if happiness is under 48, energy is at least 85, the guest is walking, litter and disgust counts are both high, and a roughly 5% roll passes. [S-fetch]
- O-69 Security staff within 224 units (7 tiles at 32 units per tile) block the act and record a "vandal stopped". [S-fetch]
- O-70 Successful vandalism sets the guest's anger to 16 and marks the element broken. Anger decrements by 1 per 512-tick pass (O-15). [S-fetch]

### 2.11 Weather

- O-71 During precipitation, a guest with an umbrella who is not under cover switches to the umbrella animation. The sections read show no happiness penalty for rain. [S-fetch; the rest of the file is unread, so this is not proof there is none]
- O-72 Balloons pop with about a 0.5% chance per update; a balloon is released above the guest either way. [S-fetch]

### 2.12 Crowding

- O-73 No crowding happiness penalty appears in the sections read. The only crowd-related triggers are the litter-based scenery thoughts (O-31) and the queue thoughts. UNRESOLVED for the rest of the file. Our current source for crowding ([docs/mechanics/guests.md](../mechanics/guests.md) G2G-1) is one blog snippet.

---

## 3. Gap table

Severity: **visible** means a player notices it within a few minutes of play; **subtle** means it shows up only in balance numbers or long runs.

The “Our behaviour” column records the implementation before this guest-fidelity change. “O-n” refers to Section 2. Numerical values sourced through summaries remain [S-fetch], not independently verified in this work.

| ID  | Area                | Our behaviour (file:line)                                                                                                                                                                                                                                                                                               | Original                                                                                                                                                            | Severity | Suggested fix                                                                                                               |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| N1  | Needs cadence       | Fixed: needs update every 128 ticks and happiness motives every 512 ticks (`src/sim/guests/guest-system.ts`).                                                                                                                                                                                                           | Smoothing every 128 ticks, motives every 512 (O-1, O-2)                                                                                                             | visible  | Done in this change. The summary-derived cadence remains [S-fetch].                                                         |
| N2  | Spawn energy        | Fixed: guests spawn with energy 65–128 (`src/sim/guests/guest-store.ts`).                                                                                                                                                                                                                                               | 65–128 (O-20)                                                                                                                                                       | visible  | Done in this change; source numeric range remains [S-fetch].                                                                |
| N3  | Nausea tolerance    | Fixed: a 0–7 roll maps to none, low, average, or high buckets (`guest-store.ts`, `preferences.ts`).                                                                                                                                                                                                                     | Four buckets from a 0–7 roll: none, low, average, high (O-46)                                                                                                       | visible  | Done in this change; the local nausea limit maps those buckets to representative values.                                    |
| N4  | Preferred intensity | Byte 48–223, preferred = 1.50 + 0.03×byte, refusal above preferred + 1.50 (`guest-store.ts:106`, `preferences.ts:1–17`). Ceilings run 4.44–9.69, so anything above 9.69 is refused by all.                                                                                                                              | Lower bound 0–4; upper bound 15 for many guests; park setting shifts the range (O-45)                                                                               | visible  | Replace with band-based intensity ranges (F4). The current ceiling makes intense rides unattractive to everyone.            |
| N5  | Leave rule          | Fixed: after 10,240 ticks, a guest below the energy 55, happiness 45 or cash 5.00 stay threshold gets a 5% roll every 512 ticks (`guest-system.ts`).                                                                                                                                                                    | Stays if energy ≥55, happiness ≥45, cash ≥5.00; below those, leaves with about 5% per check (O-40, O-41). No-money parks use 70 / 60 (O-41).                        | visible  | Done in this change. No no-money mode is represented in the current world state, so its variant remains open.               |
| N6  | Leave thought       | Records only `Leaving` (`guest-store.ts:GuestThought.Leaving`).                                                                                                                                                                                                                                                         | "Go home" thought (O-30)                                                                                                                                            | subtle   | Rename or add the wording; no mechanic change.                                                                              |
| N7  | Happiness decay     | Fixed: happiness falls at the 512-tick motive check by 2 for energy ≤50, 1 for hunger <10, 1 for thirst <10, and 1 for toilet ≥195 (`guest-system.ts`).                                                                                                                                                                 | Happiness target reduced by energy ≤50 (2), hunger <10 (1), thirst <10 (1), toilet ≥195 (1) per 512 ticks (O-11)                                                    | visible  | Done in this change. Happiness is stored directly rather than through a separate target.                                    |
| N8  | Energy model        | Drops 1 per need step (every 128 ticks) while wandering or queuing; gains 32 per ride. No sitting recovery.                                                                                                                                                                                                             | Target-based: falls 2/pass at or above target, rises 4/pass below (O-7); sitting raises target by 5/pass to 135 (O-16)                                              | visible  | Target-based energy with sitting recovery (F2).                                                                             |
| N9  | Hunger/thirst scale | Fixed: high values mean satiated; low values mean hungry or thirsty. Need seeking uses the low end of the scale. Version 12 saves invert values from saves through version 11.                                                                                                                                          | Satiation scale: hungry at 10 or less (O-24), thirsty at 25 or less (O-25).                                                                                         | visible  | Scale direction and save migration are done. Thought thresholds and item magnitudes remain separate tuning questions.       |
| N10 | Meal effect         | Food raises hunger satiation by 176 and lowers thirst by 32; drink raises thirst satiation by 176 (`guest-system.ts`).                                                                                                                                                                                                  | Consumption over a few 128-tick passes: hunger +7/pass, thirst −3/pass, toilet +2/pass (O-6); item values not captured                                              | visible  | Instant effects remain placeholders because item values and duration were not captured.                                     |
| N11 | Toilet              | +1 per need update, +2 when thirst satiation is below 75 (`guest-system.ts`). Relief sets toilet to 0. Thought threshold remains 160.                                                                                                                                                                                   | Toilet +2 while eating (O-6), +3 while sitting when thirsty (O-16), +50/pass with the toilet flag (O-14). Thought at 160 (O-26).                                    | subtle   | Consumption and sitting gains remain open.                                                                                  |
| N12 | Repeat rides        | Fixed: the last ride is gated by ride rating, intensity, guest needs and the audit's two random bands; ride count is persisted (`guest-system.ts`, `guest-store.ts`).                                                                                                                                                   | Repeat gate with happiness ≥180, energy 100, nausea ≤160, hunger ≥30, thirst ≥20, toilet ≤170, a random roll, and a 7-ride limit for part of the rolls (O-47, O-48) | visible  | Done in this change; source numeric claims remain [S-fetch].                                                                |
| N13 | Queue patience      | Fixed: unhappy guests (happiness ≤65) can balk after 4,300 queue ticks, with a 3.3% roll every 128 ticks (`guest-system.ts`). The 2,400-tick approach timeout remains.                                                                                                                                                  | Queuing for ages thought at 3500 ticks (O-29). Balk at random: about 3.3% per check once waited ≥4300 ticks and happiness ≤65 (O-37).                               | visible  | Done in this change; the separate old-age queue thought remains open.                                                       |
| N14 | Approach patience   | 2400 ticks to reach a destination, then drop it (`guest-system.ts:34`).                                                                                                                                                                                                                                                 | No value found                                                                                                                                                      | subtle   | Keep as a placeholder; label it. UNRESOLVED.                                                                                |
| N15 | Ride score          | Linear score `4×excitement − 2×intensity gap − 3×nausea − price − 100×line + taste`, positive only (`guest-system.ts:146–185`). Taste is a ±2.00 per-guest, per-ride, per-epoch hash (`taste` at line 135, `TASTE_RANGE` at line 63).                                                                                   | Band counters for intensity and nausea (+70 perfect, −35 to −60 no match); nausea limit uses band only for average or high tolerance (O-51 to O-53)                 | visible  | Replace with band scoring (F4). Excitement weighting is UNRESOLVED; keep the excitement term as a placeholder until found.  |
| N16 | Nausea on ride      | Adds `rideNausea >> 4` at once, with no dependence on happiness, hunger or tolerance (`guest-system.ts:333`).                                                                                                                                                                                                           | Scaled by happiness target, hunger, and tolerance divisor (O-54)                                                                                                    | visible  | Scale nausea growth (F2).                                                                                                   |
| N17 | Ride happiness      | +8 + excitement/40 at the end of a ride (`guest-system.ts:32–33`, `finishRide`).                                                                                                                                                                                                                                        | Happiness target drops 5/pass after 15 passes on a ride; a "get off" thought at 22 passes (O-17). Final value on exit: UNRESOLVED.                                  | subtle   | Replace the flat gain with the ride-length curve (F2). Keep the gain as the placeholder until the exit value is found.      |
| N18 | Vomit               | Litter check every 160 ticks: a guest with nausea above 180 drops vomit for certain, in any state (`src/sim/guests/litter-system.ts:26`).                                                                                                                                                                               | Chance-based while walking with nausea target ≥128 (O-12). Vomit halves hunger, nausea −30 (O-65).                                                                  | visible  | Make vomit a chance tied to nausea and walking (F6).                                                                        |
| N19 | Trash               | One in 48 checks per guest per 160 ticks, anywhere (`litter-system.ts:6`, `:26`).                                                                                                                                                                                                                                       | Guests carry trash to bins; only a guest with an empty container seeks a bin (O-66). Rate UNRESOLVED.                                                               | visible  | Model containers and bins (F6). Keep the rate until a source is found.                                                      |
| N20 | Vandalism gate      | Fixed: happiness <48, energy ≥85, wandering, park litter present, and a 5% roll (`src/sim/guests/vandalism.ts`). No disgust counter exists.                                                                                                                                                                             | Happiness under 48, energy ≥85, walking, litter and disgust high, about 5% roll (O-68)                                                                              | visible  | The available gates are implemented; disgust remains unmodeled.                                                             |
| N21 | Security radius     | 6 tiles, Chebyshev (`vandalism.ts:12`, `:22`).                                                                                                                                                                                                                                                                          | 224 units, about 7 tiles (O-69)                                                                                                                                     | subtle   | Set to 7 tiles or the equivalent unit check (F7).                                                                           |
| N22 | Lost guests         | Out of scope for this change; lost-guest navigation and pathfinding remain unchanged for follow-up work.                                                                                                                                                                                                                | Lost-guest logic UNRESOLVED (O-62). Leaving guest who cannot find the exit: warning, −30 happiness every 90 passes (O-44).                                          | visible  | Follow up separately (F8); this change deliberately leaves pathfinding and lost-guest navigation untouched.                 |
| N23 | Pathfinder scoring  | Breadth-first over junction nodes; score is Manhattan distance to the target (`navigate.ts:~190–260`). Junction budget 6 (`navigate.ts:29`, same number as the original), tile budget 15,000 (line 30), distance 200 Chebyshev from start (line 31). Junctions are counted as nodes, not by the original's 1-or-2 cost. | Score: smaller of x/y distance over 16, plus twice the height difference; ties prefer fewer steps; junction cost 1 or 2 with single-exit runs free (O-57 to O-59)   | visible  | Port the scoring and cost rules, keeping the budget numbers (F9). Check the bench in `bench/pathfinding.ts` before merging. |
| N24 | Spawn cash          | $50–$100 (`guest-store.ts:107`).                                                                                                                                                                                                                                                                                        | Random 0–300 plus scenario cash minus 100, floored at 0; no-money gives 0 (O-21)                                                                                    | subtle   | Use the original formula with the scenario's cash (F2).                                                                     |
| N25 | ATM                 | None.                                                                                                                                                                                                                                                                                                                   | Withdraws 50.00 when cash ≤20.00, energy ≥80, and the happiness roll passes (O-63)                                                                                  | subtle   | Add the withdrawal (F10).                                                                                                   |
| N26 | Money thought       | None.                                                                                                                                                                                                                                                                                                                   | "Running out of money" at cash ≤9.00, happiness ≥105, energy ≥70 (O-27)                                                                                             | subtle   | Add with F10.                                                                                                               |
| N27 | Rain happiness      | Direct happiness loss is removed. Thrill and coaster rides still receive the separate 1200 score penalty in rain without an umbrella.                                                                                                                                                                                   | Rain in the read sections: umbrella animation only (O-71). Balloons pop (O-72).                                                                                     | visible  | The unsupported happiness loss is removed; the ride-choice penalty remains a labeled design choice (F11).                   |
| N28 | Thoughts            | Eight thoughts: hungry, thirsty, toilet, too nauseous, too intense, enjoyed ride, queue too long, leaving (`guest-store.ts` `GuestThought`).                                                                                                                                                                            | Adds tired, running out of money, very sick, queuing for ages, go home, scenery and music thoughts (O-23 to O-31)                                                   | visible  | Add the missing thoughts with their triggers (F10).                                                                         |
| N29 | Crowding            | No crowding effect. The only crowd-related code is in tests (`guest-balance.test.ts`, `guest-system.test.ts`).                                                                                                                                                                                                          | No crowding happiness penalty in the read sections (O-73). Litter and queue thoughts instead.                                                                       | subtle   | Drop crowding from the MVP. Research further before implementing (F12).                                                     |
| N30 | Ride line cap       | A guest arriving at a full line is turned away (`guest-system.ts:419`); line limit `(queue tiles + 1) × 4` (ride-operations).                                                                                                                                                                                           | No equivalent found; original queues are not capped by a fixed count in the read sections                                                                           | subtle   | Keep as a design choice, labelled.                                                                                          |

---

## 4. Prioritised fix list (PR-sized)

Order is by player impact, then by dependency. Each item should land with determinism tests (same seed, same `hashWorld`) and black-box tests of inputs and outputs, per [CONTRIBUTING.md](../../CONTRIBUTING.md).

F7 (litter, vomit and bins) and F8 (lost guests and exit handling) remain follow-up work. This change does not edit pathfinding or lost-guest navigation.

1. **F1 Cadence and docs** (small). Implemented: needs update every 128 ticks and happiness motives every 512 ticks. Update the balance and guest docs to match. Gap: N1.
2. **F2 Needs model** (medium). Move energy to a target model (O-7, O-16); move happiness to a target with the four idle reductions (O-11) and the activity effects (O-17); scale ride nausea growth (O-54); make meal consumption take time (O-4 to O-6) once item values are found, with the instant effect kept as a labelled placeholder. Gaps: N7, N8, N10, N16, N17.
3. **F3 Spawn distributions** (small). Energy 65–128 (O-20); nausea tolerance as four buckets from a 0–7 roll with the park-preference shift (O-46); intensity bands (O-45); cash from the scenario (O-21). Gaps: N2, N3, N4, N24. Do F3 before F4 so ride choice is tested on the right population.
4. **F4 Leave rule** (small to medium). Probabilistic check with the original thresholds (O-41), the "go home" thought (O-42, N6), and the no-route exit handling from F8. Gap: N5. Wait for F3 so leaving rates can be compared.
5. **F5 Ride choice** (medium). Repeat gate and roll (O-47 to O-48, N12); "really liked" and the intensity raise (O-49, O-50); band scoring with +70 and −35 to −60 (O-51 to O-53, N15). Excitement weighting stays a labelled placeholder (Q4). Gaps: N12, N15, and N4 once F3 lands.
6. **F6 Queue balking** (small). Random balk after 4300 ticks at happiness ≤65 (O-37); "queuing for ages" thought at 3500 ticks (O-29); queue cut when a ride closes (O-38). Replace the hard timeout (N13). Approach patience stays a placeholder (N14).
7. **F7 Litter, vomit, bins** (medium). Chance-based vomit when walking (O-12, O-65); containers and bins (O-66); trash rate placeholder (N19). Gaps: N18, N19.
8. **F8 Lost and exit** (small). Wire `stepsTaken` and the lost counter; add the exit warning and −30 happiness every 90 passes (O-44); keep the guest visible rather than despawning when a route is missing. Gap: N22. The lost trigger (O-62) stays a placeholder until a source is found. **Status: implemented** (lost state, park maps, leaving guests stay visible); see [guests docs](../../src/sim/guests/docs.md).
9. **F9 Pathfinder scoring** (medium). Original score (O-59), junction cost of 1 or 2 with single-exit runs free (O-57), keep the 15,000 and 200 budgets (O-56, O-58). Gap: N23. Run `bench/pathfinding.ts` before and after; expect guests to reach far rides differently. **Status: implemented** with a secondary tie-break and a junction budget of 16 cost units; see [pathfinding docs](../../src/sim/pathfinding/docs.md).
10. **F10 Thoughts and money** (small). Add tired, very sick, running out of money, go home, queuing for ages, scenery and music (O-23 to O-31); ATM (O-63). Gaps: N25, N26, N28.
11. **F11 Rain** (small, decision). Implemented: removed direct rain happiness loss because the audit records no supporting source; retained the separate 1200 ride-choice penalty as a design choice (N27).
12. **F12 Vandalism gate** (small). Happiness under 48, energy ≥85, walking, litter and disgust high, about 5% roll, and a 7-tile security radius (O-68, O-69). Gaps: N20, N21.
13. **F13 Crowding research** (research only). No code change. Read the rest of the guest source for crowd effects. Gap: N29. Close the ticket if nothing is found.

Two things must happen before any of F2–F9 is tuned: F1 (so the cadence is right), and a decision on the hunger scale mapping (Q2). Otherwise every tuning pass lands on the wrong base.

---

## 5. Open questions

- Q1. Confirm every [S-fetch] number in Section 2 against the source text. Where a value here conflicts with the older guide in [docs/mechanics/guests.md](../mechanics/guests.md), this audit has not yet reconciled them; the conflict list is open.
- Q2. Hunger and thirst mapping: resolved for implementation. Values count satiation down; version 12 inverts both values from saves through version 11. The original thought cut-offs and meal amounts still need source verification (Q1, Q5).
- Q3. Initial happiness, hunger and thirst at spawn (O-22).
- Q4. Excitement weighting in ride choice (O-51 is about bands only).
- Q5. Food and drink item values, and what a guest gains from each.
- Q6. Lost-guest trigger (O-62).
- Q7. Final ride happiness on exit (N17).
- Q8. Trash creation rate outside vomit (O-67, N19).
- Q9. Full thought list and trigger wording (O-23 to O-34 are partial).
- Q10. Crowding effects in the rest of the guest source (O-73).
- Q11. Whether the original's 128-tick and 512-tick passes map to our 40 Hz ticks as assumed. The implementation follows the audit summary, but the source and tick base still need verification (Q1).

## 6. Verification plan for this document

- Each [S-fetch] item is a claim to check against the source text. Check the items that drive gaps N2, N3, N5, N7, N12, N13, N18, N20 and N22 first; these are the ones the fix list depends on.
- The bench (`pnpm bench -- --guests 5000 --strict`) and the balance harness (`pnpm balance`) should be re-run after F1 and after each of F2 to F9. Record the before and after numbers in [docs/BALANCE.md](../BALANCE.md) when each lands.

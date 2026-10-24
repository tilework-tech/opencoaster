# World mechanics: staff, litter, weather, land, paths, scenery

Status: research spec draft. Written from web sources that were partly unreachable (several fan-wiki pages returned HTTP 402 to automated fetching). Most numeric values below are single-source or unverified. Each rule carries a confidence tag:

- [M] verified from multiple independent sources
- [S] single source (named in the Sources section)
- [I] inferred or design proposal, not observed in any source

Where RCT1 and RCT2 differ, RCT2 is preferred and the difference is noted. Nothing here is copied from original RCT assets or OpenRCT2 source code. Behaviour is described in our own words.

---

## 1. Overview and feel

The world layer is what makes a park look alive and degrade when neglected. Guests walk paths, drop litter and sometimes vomit. Staff clean, water, mow and repair. Weather changes what guests want to do. The player shapes the land, paths and scenery that guests judge their experience by.

Player-facing feel:
- A clean park with varied scenery produces happy guests who compliment the park [S].
- Neglect cascades: litter lowers happiness, unhappy guests vandalise bins, benches and lamps, and vandalism lowers park rating [S].
- Weather is a soft constraint, not a hard stop. Rain changes which food sells and whether guests join uncovered queues [S].
- Staff are a recurring cost that the player balances against cleanliness [S].

---

## 2. Precise rules

### 2.1 Staff types

| Type | Role | Wage (RCT2) | Confidence |
|---|---|---|---|
| Handyman (janitor) | Sweep paths, empty bins, clean litter and vomit, water and mow | $50/month. RCT1: $35/month | [S] |
| Mechanic | Inspect and repair rides. Can be set to inspect only, repair only, or mixed | not found | [S] for role, wage unknown |
| Security guard | Deters vandalism near its patrol area | not found | [S] for role |
| Entertainer | Walks the queue ("works the line") and raises nearby guest happiness | not found | [S] for role |

Staff AI and patrol:
- A staff member with no patrol area wanders the park and does any job it bumps into [S].
- Handymen with a patrol area stay within it. Advice is about 5 to 6 tiles per handyman, including gardens and lawns [S, community rule of thumb].
- Mechanics are assigned to rides, not areas. Cover at least the ride exit. A mechanic can walk back and forth without repairing if placed poorly [S].
- Handymen can climb roof paths in their patrol area and get stuck. Keep roof paths off their patrol area [S].
- Community rule of thumb: 4 to 6 handymen and 6 to 8 mechanics later in a park, at least two of each early on [S, forum opinion, not a game rule].

Cost: the cited material describes staff wages as a monthly expense [S]. OpenCoaster's economy currently charges wages weekly and includes those entries in its monthly finance history, as specified in [DECISIONS.md](../DECISIONS.md). The current handyman rate converts the cited $50/month reference to cents per week using a 52-week year; mechanics, security and entertainers use provisional OpenCoaster weekly rates because no source wage was found. These implementation rates are game tuning, not additional historical salary facts.

### 2.2 Litter and vomit

- Guests generate litter and vomit. Vomit comes from rides, and the nausea trigger is covered in the guests spec, not here [I].
- Handymen clean litter and vomit. Trash and vomit are separate tile states [S].
- Guests lose happiness when they walk past trash or vomit. Stepping on many vomit tiles produces a specific negative thought [S].
- Clean paths produce a positive guest thought [S].
- Exact per-tile penalties, decay rates and tick timings are NOT found in any source reachable here. Do not hard-code them. Pull them from a primary source before implementation [unverified].

### 2.3 Bins, benches, lamps

- Bins, benches and lamps are path items. Vandals destroy them and they must be repaired by the player [S].
- Vandalised bins, benches and lamps lower park rating when guests comment on them [S].
- Bins sit on path tiles and hold litter. Bin emptying is a handyman task [S].
- Placement and capacity rules are not found [unverified].

### 2.4 Vandalism

- Vandals are guests whose happiness is very low, mainly because of excess litter and vomit [S].
- The vandal rate is tied to litter and vomit density in a path area [S].
- Vandals also destroy nearby benches, lamps and bins regardless of their own happiness [S].
- Security guards deter vandalism near their patrol area [S].
- Thresholds and probabilities are not found [unverified].

### 2.5 Weather

Weather states are not fully described in any source reached.

Confirmed effects:
- Rain: ice cream does not sell when it is cold or raining. Cotton candy does not sell in rain but does sell when cold [S].
- Rain and queues: guests refuse to join uncovered queues in rain. Guests already in an uncovered queue stay [S].
- Rain and rides: uncovered rides are described as very unpopular in rain [S, forum anecdote].
- Umbrellas: information kiosks sell umbrellas that keep guests dry in rain [S].

Unknowns: the state list, transition rules, durations, probabilities, and how rain changes happiness and ride popularity numerically. Treat as an open question.

RCT3 is not a reference for this. A forum thread on RCT3 rides and rain says guests still ride at the minimum rate in rain [S, RCT3 only, do not apply to RCT2].

### 2.6 Land and terrain

- The player can raise and lower land, add water, and set surface types. Scenery and rides can sit above and below ground [S, Wikipedia summary of RCT2].
- Land ownership and construction rights are in the game, but the exact rules were not found in any source reached [unverified].
- Underground track counts toward cover for indoor status. A community guide says at least 40% of a tracked ride's track must be underground to count as indoor [S, fan guide, unverified].

### 2.7 Footpaths and queue rules

- Guests walk paths. Path quality is affected by litter and vomit [S].
- Queue paths: queues need cover to be joined in rain [S].
- Staff walk paths in their patrol area. Roof paths are a known trap for staff [S].
- Path width, queue lane rules and pathfinding costs are not found [unverified].

### 2.8 Scenery and guest happiness

- Scenery raises happiness. A park with a lot of scenery gets compliments from guests. The "great scenery" thought is listed as RCT2-only [S].
- Jumping fountains on paths earn compliments [S].
- One forum user says scenery has little effect in their parks, with no figures [S, anecdote, conflicts with the above].
- Scenery value and happiness weights are not found [unverified].

### 2.9 Parameters that need primary sources

These are not in any source reached. Do not guess them. Each needs a primary source or a measurement against the original game:

- Simulation tick rate. Our target is 40 ticks per second. Source for the original game's rate is not confirmed [unverified].
- Happiness scale. A community source says 0 to 255 [S].
- Litter and vomit decay, spawn rates, and per-tile happiness penalties.
- Staff speed, patrol radius per staff type, and task durations.
- Weather state durations and transition probabilities.
- Vandal spawn threshold and probability.
- Repair costs and breakdown probabilities.

---

## 3. Data model proposal

This section records an early design proposal, not the current TypeScript layout. Current state is distributed across [World](../../src/sim/core/world.ts), entity stores, and tile-element stacks; see the module Noridocs for implementation details.

Use struct-of-arrays for anything with many instances. Tiles are the big array; staff and vandals are smaller arrays.

```ts
// Tile grid: one entry per map tile. Typed arrays, indexed by y * width + x.
interface TileGrid {
  width: number;
  height: number;
  height0: Uint8Array;        // base land height, 0..255
  surface: Uint8Array;        // surface enum: grass, path, water, etc.
  pathLitter: Uint8Array;     // litter count on the path tile, 0..N (N TBD)
  pathVomit: Uint8Array;      // vomit count, 0..N (N TBD)
  owner: Uint8Array;          // land ownership flags, 0 = unowned
  scenery: Uint16Array;       // scenery object id, 0 = none
  pathItem: Uint8Array;       // bin, bench, lamp, none
  pathItemCondition: Uint8Array; // 0..255, 0 = vandalised
}

// Staff: small set, struct-of-arrays.
interface StaffPool {
  count: number;
  type: Uint8Array;           // handyman, mechanic, guard, entertainer
  x: Float32Array;
  y: Float32Array;
  patrolId: Uint16Array;      // index into patrol area table
  task: Uint8Array;           // current task enum
  taskTimer: Uint16Array;     // ticks remaining on current task
  wageCents: Uint32Array;     // proposed monthly cost; not the current wage representation
}

// Patrol areas: a set of tiles per staff group.
interface PatrolArea {
  tileIndices: Uint32Array;   // flat list of tile indices
  staffCount: number;
}

// Weather: single global state, cheap.
interface Weather {
  state: number;              // enum, TBD
  ticksRemaining: number;
  temperature: number;        // scalar, TBD
}
```

Per-tick CPU budget:
- Litter and vomit update: walk only tiles marked dirty, not the full grid [I].
- Staff update: linear in staff count, which should be hundreds at most [I].
- Weather: O(1) per tick [I].
- Rough budget at 40 ticks/second: world layer under 2 ms per tick in a browser tab for thousands of guests, leaving headroom for guests and rides [I, to measure].

---

## 4. Dependencies

- Guests: happiness, thoughts, vandalism trigger, queue behaviour in rain, food and drink sales in weather [S].
- Rides: breakdown and repair (mechanics), vomit source, uncovered queues in rain, indoor status via underground track [S].
- Track: track height and underground status for indoor rules [S].
- Economy: staff wages, bin and bench repair costs, park rating [S].
- Staff/world: patrol areas and task assignment. This spec owns those rules.
- Rendering: litter, vomit, weather visuals, and path item states [I].

---

## 5. Prioritised implementation checklist

This was an initial target list and is not a statement that the items remain unimplemented. Current behavior and tuning are summarized below; source observations above remain distinct from game-specific implementation choices.

MVP:
1. Tile grid with surface, height and path items.
2. Staff pool with handymen only. Wander, then patrol areas.
3. Litter and vomit on path tiles, cleaned by handymen.
4. Guest happiness hook: litter and vomit penalty (values TBD from a primary source).
5. Staff wage accounting (implemented weekly in OpenCoaster and summarized in monthly history; see §2.1).
6. Rain state with two effects: ice cream and cotton candy sales, and uncovered-queue refusal.

Fidelity:
7. Mechanics with inspect, repair and mixed modes, tied to rides (depends on rides spec).
8. Vandalism, bins and benches condition, and park rating impact.
9. Security guards and entertainers.
10. Full weather state machine, temperature, snow and puddles.
11. Land ownership and construction rights.
12. Scenery happiness weights and jumping fountain compliments.
13. Roof path staff trap.

---

## 6. Open questions

1. What are the exact litter and vomit spawn rates, decay rates and happiness penalties?
2. What are the weather states, durations and transition probabilities?
3. How does rain change happiness and ride popularity numerically?
4. What are the staff wages for mechanics, guards and entertainers?
5. What are the vandal spawn threshold and probability?
6. What is the original simulation tick rate, and is 40 ticks/s a faithful target?
7. How does land ownership and construction rights work?
8. How are scenery happiness weights computed?
9. Do community staff-count rules of thumb match the game's real behaviour?
10. Is the 40% underground rule for indoor status verified?

## 7. Current OpenCoaster implementation notes

These are verified code behaviors, not claims about the referenced games. Rates and thresholds are named implementation tuning unless a source-backed value is explicitly identified above.

- Hiring and firing adjust the weekly wage input by each staff member's role rate. Older save versions recalculate this input from restored staff kinds. Handymen remove litter entities and empty path bins; mechanics inspect due rides and inspect broken rides to restore reliability and reopen them when their queues remain connected. Entertainers roam walkable tiles within their assigned patrol mask and periodically raise nearby guest happiness. Security deterrence is not implemented because there is no vandalism simulation; handyman mowing and watering and staff firing controls in the UI are also absent. Staff job details are in [staff Noridoc](../../src/sim/staff/docs.md).
- Guests periodically generate trash or vomit on walkable tiles. Trash enters a path bin when available; litter ages out and handymen can remove litter entities. Exact generation cadence, thresholds, bin capacity and lifetime are OpenCoaster values. The staff system caches bin tile and element locations using both map object identity and map revision. See [guest Noridoc](../../src/sim/guests/docs.md).
- Weather has sunny, cloudy, rain and storm states with seeded transitions and implementation-selected durations and temperatures. Rain/storm penalize thrill/coaster ride scores for guests without an umbrella. In rain, only wandering guests within one tile of an open information kiosk may buy an umbrella; the price is deducted from guest cash but is not recorded as kiosk revenue in the economy ledger. Numeric effects are tuned in code; source-reported kiosk and rain observations do not specify these scoring values. See [weather Noridoc](../../src/sim/weather/docs.md).
- Bins and benches are path additions stored on path elements. Bins hold trash for handyman emptying. Benches have no simulation behavior, and neither path addition is currently rendered. Vandalism and path item repair are not implemented here. See [map Noridoc](../../src/sim/map/docs.md) and [UI Noridoc](../../src/ui/docs.md).


---

## 8. Sources

Fetched and read:
- https://github.com/OpenRCT2/OpenRCT2/wiki (wiki index; no staff or weather page visible in listing)
- https://en.wikipedia.org/wiki/RollerCoaster_Tycoon_2 (park simulation summary)
- https://forums.openrct2.org/topic/6444-understanding-simulation-in-rct2/ (transport rides, rain cover, ride ratings; anecdotal)
- https://forums.openrct2.org/topic/6612-few-ideas-weather-handymen-ride-crashes-dual-track-rides-and-more (suggestions and some observations; mostly not verified)

Seen in search results only (not fetched; HTTP 402 or search snippet only):
- https://rct.fandom.com/wiki/Guests_and_Staff (handymen, mechanics, staff wages, patrol advice)
- https://rct.fandom.com/wiki/Guest_Moods (happiness scale)
- https://rct.fandom.com/wiki/Guest_Thoughts (litter, vomit, scenery, clean-park thoughts)
- https://rct.fandom.com/wiki/Vandals (vandal mechanics)
- https://rct.fandom.com/wiki/Thunderstorm_Park/Scenario_Guide (indoor rides, 40% underground rule)
- https://rct.fandom.com/wiki/Hints_and_Tips (patrol advice)
- https://forums.rctgo.com/printthread.php?tid=20622 (patrol and mechanic rules of thumb)
- https://outof.games/realms/rollercoastertycoon/guides/541-guide-to-food-and-drink-stalls-in-rollercoaster-tycoon-1-and-2/ (rain and food sales)
- https://www.gog.com/forum/rollercoaster_tycoon_series/rct3_rides_and_rain (RCT3 only)
- https://strategywiki.org/wiki/RollerCoaster_Tycoon:_Corkscrew_Follies/Giggle_Downs (staff tips, not read)
- http://cdn.akamai.steamstatic.com/steam/apps/285310/manuals/rollercoaster_tycoon.pdf (RCT1 manual; scanned, unreadable through the fetch tool, not read)

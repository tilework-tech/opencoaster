# Noridoc: Economy Simulation

Path: @/src/sim/economy

### Overview

- Owns the integer-cent economy, game calendar, monthly finance history, loans, wages, ride upkeep, marketing, park value and park rating inputs.
- Other simulation systems post transactions through the economy API; recurring charges and periodic rating updates run in a deterministic system.
- Current mechanics and tuning are summarized in [economy.md](../../../docs/mechanics/economy.md), with binding choices in [DECISIONS.md](../../../docs/DECISIONS.md).

### How it fits into the larger codebase

- The worker-owned [World](../core/world.ts) contains the cash balance, ledger, calendar and published park inputs. World hashing and [save data](../../save/save.ts) preserve the economy state.
- Guest purchases, admissions, ride tickets and construction call [api.ts](api.ts) to post ledger entries. For example, a successful umbrella purchase at an information kiosk is recorded as `ShopSales` by the [guest system](../guests/guest-system.ts); unaffordable kiosks do not produce a transaction.
- [Park inputs](park-inputs.ts) derives wages, upkeep, ride value and guest/park metrics from current world stores. Its values are refreshed before the economy system processes shared tick boundaries.
- [Simulation](../core/simulation.ts) applies economy actions from commands, while [economy-system.ts](economy-system.ts) advances the calendar and applies recurring charges and monthly rollover.

### Core Implementation

- [api.ts](api.ts) is the entry point for earning and charging non-negative integer cents, publishing economy inputs, and querying admission price, ride pricing mode and marketing attraction. Invalid transaction amounts throw `RangeError`.
- [actions.ts](actions.ts) applies borrowing, repayment, pricing and marketing actions. Rejected actions return `false` without changing state.
- [calendar.ts](calendar.ts) defines the tick-based dates and boundary checks. [economy-system.ts](economy-system.ts) processes weekly wages, weekly interest and campaign costs, fortnightly ride upkeep, monthly ledger rollover, and periodic rating refreshes at those boundaries.
- [ledger.ts](ledger.ts) defines transaction categories and rolling monthly totals. Guest kiosk umbrella revenue, like toilet fees, uses `ShopSales`; it is separate from food and drink sales.
- [park-inputs.ts](park-inputs.ts) sums role-specific staff wage rates from [staff-store.ts](../staff/staff-store.ts), plus ride and guest measures. These roster-derived fields are republished periodically, so direct callers of `setEconomyInputs` should treat them as refreshed simulation inputs rather than durable overrides.
- `saveLedger` and `restoreLedger` in [ledger.ts](ledger.ts) form the ledger serialization boundary. New ledger fields must also be represented in [save data](../../save/save.ts) and [world hashing](../core/hash.ts).

### Things to Know

- Money uses integer cents. Cash may go below zero through recurring charges; construction actions check available cash before applying and post costs through the economy API.
- Wages are charged weekly and shown in monthly finance history; ride upkeep is charged fortnightly. Staff hire/fire actions also update the weekly wage input immediately, and park inputs recompute it from the roster on refresh.
- Interest is simple weekly interest using the configured basis-point rate. The calendar defines the number of weeks per year; this is an implementation choice recorded as an inference in the economy mechanics document.
- The park rating ([park-rating.ts](park-rating.ts)) includes ride terms fed by the park inputs `openAttractionCount`, `excitementTotal` and `intensityTotal`: average proximity to 3.68 / 5.20 and a variety penalty until each total reaches 80.00. Without them a clean park sat at the 999 clamp. Constants and results: [docs/BALANCE.md](../../../docs/BALANCE.md). `restoreLedger` merges saved inputs over defaults, so saves from before these fields load without a version bump.
- Marketing has one active campaign slot, charged weekly while active. Attraction multipliers and several park-rating terms are tunable or incomplete; see the mechanics document for unresolved source questions.

Created and maintained by Nori.

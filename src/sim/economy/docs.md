# Noridoc: Economy Simulation

Path: @/src/sim/economy

### Overview

- Owns the integer-cent economy, game calendar, monthly finance history, loans, wages, ride upkeep, marketing, park value and park rating inputs.
- Other simulation systems post transactions and casualty events through the economy API; recurring charges, monthly awards and periodic value/rating updates run in deterministic systems.
- Current mechanics and tuning are summarized in [economy.md](../../../docs/mechanics/economy.md), with binding choices in [DECISIONS.md](../../../docs/DECISIONS.md).

### How it fits into the larger codebase

- The worker-owned [World](../core/world.ts) contains the cash balance, ledger, calendar and published park inputs. World hashing and [save data](../../save/save.ts) preserve the economy state.
- Guest purchases, admissions, ride tickets and construction call [api.ts](api.ts) to post ledger entries. For example, a successful umbrella purchase at an information kiosk is recorded as `ShopSales` by the [guest system](../guests/guest-system.ts); unaffordable kiosks do not produce a transaction.
- [Park inputs](park-inputs.ts) derives wages, upkeep, ride value and guest/park metrics from current world stores. Its values are refreshed before the economy system processes shared tick boundaries; ride value reads recent ride rider windows from [ride-store.ts](../rides/ride-store.ts).
- [Simulation](../core/simulation.ts) applies economy actions from commands, while [economy-system.ts](economy-system.ts) advances the calendar and applies recurring charges and monthly rollover.
- [Worker snapshots](../../worker/snapshot.ts) expose active awards and bounded park news from the saved ledger. The park tab lists current awards and the formatted date; the [HUD](../../ui/game-ui.ts) announces recent award news.

### Core Implementation

- [api.ts](api.ts) is the entry point for earning and charging non-negative integer cents, publishing economy inputs, and querying admission price, ride pricing mode and marketing attraction. Invalid transaction amounts throw `RangeError`.
- [actions.ts](actions.ts) applies borrowing, repayment, pricing and marketing actions. Rejected actions return `false` without changing state.
- [calendar.ts](calendar.ts) defines the tick-based dates and boundary checks. [economy-system.ts](economy-system.ts) processes weekly wages, interest and campaign costs, fortnightly ride upkeep, monthly ledger rollover, and periodic rating refreshes at those boundaries.
- [ledger.ts](ledger.ts) defines transaction categories and rolling monthly totals. Guest kiosk umbrella revenue, like toilet fees, uses `ShopSales`; it is separate from food and drink sales.
- [park-inputs.ts](park-inputs.ts) sums role-specific staff wage rates from [staff-store.ts](../staff/staff-store.ts), plus ride and guest measures. These roster-derived fields are republished periodically, so direct callers of `setEconomyInputs` should treat them as refreshed simulation inputs rather than durable overrides.
- [awards.ts](awards.ts) assesses candidate predicates after monthly rollover and the boundary's rating/value refresh, adds at most one eligible award per month up to four concurrent awards, and expires each after five months. Positive and negative awards compound natural guest-generation probability by 1.25 and 0.75 per active award; marketing campaigns have a separate multiplier path and suppress award adjustment while active. Food-award hunger counts use the guest stall-seeking cutoff (satiation 128 or lower); exact original award thresholds remain unverified. The water-ride candidate currently cannot qualify because the ride catalog has no water ride type.
- Park value uses every non-shop ride, including closed rides. Each ride's contribution is `valueCents * (ridersLast5Minutes + 4 * typeBonus)`, using the age-adjusted `getRideValueCents` result (including its same-type reduction). These contributions are summed across rides, then 700 cents per current guest is added. Rider count is a five-minute rolling window. The type-bonus proxy is derived from the ride type's `valueWeights`; the formula and proxy remain compatibility assumptions documented in [park-rating.ts](park-rating.ts) and [DECISIONS.md](../../../docs/DECISIONS.md).
- Park rating includes separate persisted drowning and fatal-ride-crash penalties: 25 points per drowning and 200 per fatal ride crash, plus the generic legacy casualty input, with the combined penalty capped at 1,000. Each typed pool retains 90% each month with integer flooring; the pools do not reset or reduce one another. Multiplicative 10% monthly decay is an explicit assumption. The recording helpers currently have no simulation event caller, so neither casualty type is recorded by gameplay systems yet.
- `saveLedger` and `restoreLedger` in [ledger.ts](ledger.ts) form the ledger serialization boundary. New ledger fields must also be represented in [save data](../../save/save.ts) and [world hashing](../core/hash.ts).

### Things to Know

- Money uses integer cents. Cash may go below zero through recurring charges; construction actions check available cash before applying and post costs through the economy API.
- Staff salary constants use monthly amounts from the cited manual and convert them to rounded weekly cents; the ledger charges that weekly wage input at each week boundary, while monthly finance history aggregates the charges. Hiring and firing update the weekly input immediately, and park inputs recompute it from the roster on refresh. Ride upkeep remains a fortnightly charge.
- Interest is simple weekly interest using the configured basis-point rate. The calendar defines the number of weeks per year; this is an implementation choice recorded as an inference in the economy mechanics document.
- The park rating ([park-rating.ts](park-rating.ts)) starts from 700 (600 for difficult-rating scenarios), then applies guest, happiness, casualty, litter, lost-guest, downtime, and ride-rating terms. Each open non-shop attraction adds 75 development points, up to six attractions (450 points); with default empty-park inputs the rating is 250, or 150 for a difficult-rating scenario. Ride-rating terms use `openAttractionCount`, `excitementTotal` and `intensityTotal`: average proximity to 3.68 / 5.20 and a variety penalty until each total reaches 80.00. The happiness, ride-rating, casualty, litter, lost-guest, and downtime penalties follow the documented community guide formula; the starting bases and development bonus are OpenCoaster calibration choices. Balance results and scenario targets are recorded in [docs/BALANCE.md](../../../docs/BALANCE.md). `restoreLedger` merges saved inputs over defaults, so older ledger headers can omit newer inputs.
- Marketing has one active campaign slot, charged weekly while active. Six campaign families (ids 0-5, manual order) run for 1-6 weeks; ride and item campaigns store a target id in `campaignTarget`, and their effect is still park-wide. Guests arriving during a campaign carry its voucher ([vouchers.ts](vouchers.ts)); entry vouchers are used at the gate, and ride or food vouchers name the target they honour. Prices and multipliers are tunable; see [marketing.ts](marketing.ts) and DECISIONS.md.
- Ride rider history uses a rolling window cleared in tick-sized segments and summed over the last five minutes. It is part of ride save state; version 12 adds the ring after version 11's ride columns, while older saves load the new columns as zero, as described in [save docs](../../save/docs.md).
- The calendar uses March–October and eight equal 16,384-tick months. Month day labels are display interpolation across 30- and 31-day month labels; tick boundaries, not labels, control financial processing. This schedule is an implementation compatibility assumption.
- Park news and active awards are deterministic ledger state, included in world hashing and saves. The UI presents recent items from the bounded news history.
- Interest, loan steps and company value follow the decisions in DECISIONS.md; repayment is immediate and the weekly interest is calculated on the balance at the boundary.

Created and maintained by Nori.

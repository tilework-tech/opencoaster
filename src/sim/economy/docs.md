# sim/economy

Responsibility: money in integer cents, the calendar, the monthly ledger and rolling history, loans and weekly interest, wages and ride upkeep, marketing campaigns, admission vs. per-ride pricing mode, park value, company value and park rating. Spec: `docs/mechanics/economy.md`; decisions: `docs/DECISIONS.md`.

## Interface

- `api.ts` (what other systems call): `earn(world, category, cents)`, `charge(world, category, cents)` (both take non-negative integers and throw `RangeError` otherwise), `setEconomyInputs(world, patch)` (rides, staff and guests publish wage bill, upkeep, ride value, rating inputs), `gateAdmissionCents(world)`, `ridePricingEnabled(world)`, `marketingAttraction(world)` (basis points, 10000 = none).
- `actions.ts`: `EconomyAction` (`borrow`, `repay`, `setPriceMode`, `setAdmissionPrice`, `startCampaign`), applied from the `economy` command. Rejected actions return `false` and change nothing.
- `ledger.ts`: `Ledger` state, `LedgerCategory`, `PriceMode`, `completedMonthTotal`, save helpers.
- `calendar.ts`: `gameDate(tick)`, `isBoundary(tick, period)` and the tick cadences.
- `economy-system.ts`: the clock. Runs weekly charges, fortnightly upkeep, the monthly rollover, and the 512-tick rating refresh, in that order at shared boundaries.

- `park-inputs.ts`: `parkInputsSystem` (runs before the economy system, every 128 ticks) publishes the economy inputs from the park: `staff * 1,500` weekly wages, fortnightly upkeep of open rides (build cost / 50, stalls / 100), summed value of open rides, qualifying (open, non-shop) ride count, guests off the footpaths as lost guests, the percentage of guests with happiness below 128, the percentage of broken rides, and the litter count. Anything that calls `setEconomyInputs` for these fields is overwritten at the next refresh.

## Decisions

- Calendar: 16,384 ticks per month, 8 months per year starting in March, so a week is 4,096 ticks and a fortnight is 8,192. Display day labels use 31/30 days and are cosmetic.
- Boundaries fire on the tick that reaches them, never on tick 0.
- Wages are a weekly charge of `wageBillPerWeek`, reported in the monthly ledger. Ride upkeep is a fortnightly charge of `rideUpkeepPerFortnight`.
- Interest is simple and weekly: `floor(loan * bps / (10000 * 32))`. Weeks per year come from the calendar. This is inferred; see economy.md open question 2.
- Loans move in $1,000 steps. Borrowing is capped at `maxLoan`. Repaying is capped at the balance and cash. Financing moves cash but is not a ledger category.
- Cash may go negative. Construction (land, paths, rides, track) is checked against cash before it is applied and posts through `charge`.
- Campaigns: one active slot. Each week it charges its cost and consumes a week. The attraction multiplier applies while weeks remain. The table in `marketing.ts` is a tunable placeholder.
- Park value is `rideValue + 700 * guests` (cents), refreshed every 512 ticks. Company value is `parkValue + cash - loan`.
- Park rating follows the community formula in `park-rating.ts`. It is clamped to 0..999. The excitement and intensity terms are not implemented. The sign of the guest term is ambiguous in the source; the implementation follows the range it states. Calibrate before relying on it.

## Save

`saveLedger` and `restoreLedger` are the serialisation boundary; `src/save` uses them. Any new `Ledger` field must be added to `LedgerSave` and to `hash.ts`.

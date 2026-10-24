# Economy

## 1. Overview and player feel

The economy is a pressure system that turns park design into a sequence of bets. The player borrows against a scenario-defined ceiling, spends cash to build and acquire land, then tries to convert guest traffic into admission, ride, and shop revenue before recurring wages, operations, stock, research, marketing, and interest consume the runway. A profitable park is not automatically a successful one: the scenario may instead require a guest count, rating, park value, loan repayment, sales target, or qualifying coasters by a deadline.

The central choice is the scenario's revenue model. In RCT2, scenarios generally allow either admission at the gate or per-ride charges, not both. Shops remain a second stream in either model. New rides draw interest and justify higher prices; age and poor performance erode what guests consider fair. The monthly finance report makes the consequences legible, while the player's short-term cash balance makes them urgent.

**Confidence convention:** *multiple sources* means the RCT2 manual and an independent mechanics reference agree on the behavior; *single source* means one source describes it; *inferred* means this is a proposed OpenCoaster simplification pending validation. Formula guides below often derive from OpenRCT2 analysis; they are behavioral clues, not permission to copy code or a claim that every edge case matches the original executable.

## 2. Rules

### Money, income, and expenses

- **Currency and accounting unit — single source.** RCT2 displays scenario-selected currency and prices in hundredths (e.g. $1.50); implementations should store integer minor units, not floats. Avoid hard-coding a currency symbol. [RCT2 manual](https://rct2.rctspace.com/rct2_manual.pdf)
- **Gate admission vs. pay-per-ride — multiple sources.** In the standard RCT2 scenario rules, charge at the gate or charge for rides, not both. Some scenarios disable money entirely. Store the policy on the scenario and reject/disable incompatible price controls. The scenario editor also sets land prices and construction restrictions. [RCT2 manual](https://rct2.rctspace.com/rct2_manual.pdf), [OpenRCT2 finance guide](https://docs.openrct2.io/en/latest/playing/finances/)
- **Admission price — single source.** The manual describes a configurable gate price from free up to $100; scenario settings determine whether admission can be charged. Guest cash and the value they perceive in available rides constrain demand. Do not infer that setting a high price means guests will enter. [RCT2 manual](https://rct2.rctspace.com/rct2_manual.pdf)
- **Ride income and price tolerance — single source.** Guests pay per ride only in pay-per-ride scenarios. A detailed community formula guide says ride willingness-to-pay depends on excitement, intensity, nausea, age, and park admission; in particular, an admission charge reduces additional ride willingness-to-pay (reported as a 75% reduction). A ride priced above twice its computed value triggers a “too expensive” reaction. The exact function and aging table are embedded as images in the guide and should be independently transcribed/validated before fidelity work. [Ride price guide](https://forums.openrct2.org/topic/2737-guide-how-much-can-you-charge-for-your-rides/)
- **Shop and stall revenue — multiple sources.** Stalls sell items, charge per use for some facilities, and incur flat running costs; inventory cost is a separate expense. Item demand depends on guest needs and product; weather changes both demand and acceptable prices. Food and drink can have changing hot/base/cold values. [RCT2 manual](https://rct2.rctspace.com/downloads/RCTycoon%20Manual%2008311.pdf), [Shops & Stalls](https://docs.openrct2.io/en/latest/playing/shops_and_stalls/)
- **Merchandise pricing — single source.** An item analysis reports each shop item has a per-unit stock cost and base, hot, and cold values. Example: a standard drink has internal values 12/20/10 (base/hot/cold); a burger has stock cost 5 and values 19/19/22. Prices are in tenths of the displayed currency unit. When guest happiness is above 128/255, the overprice difference is halved; above 180, halved again. The guest then compares it to a random integer 0–7 (0–0.70 currency units); beyond the resulting tolerance they refuse and complain. Rain makes umbrellas a special case (price test reportedly bypassed); rain suppresses purchases of balloons, sunglasses, ice cream, and candyfloss. Ice cream and sunglasses are reportedly unavailable below 12°C. These are **single-source, community-analysis** rules and need original-game checks. [Shop pricing guide](https://forums.openrct2.org/topic/2747-guide-how-much-can-you-charge-for-your-shops/)
- **Construction and landscaping — multiple sources.** New rides, shops, landscaping, scenery, and land purchases debit cash when placed; demolishing items can return some cash. Price depends on ride design and scenario costs. Costs are distinct ledger categories, not one generic “build” total. [RCT2 manual](https://rct2.rctspace.com/downloads/RCTycoon%20Manual%2008311.pdf), [Finances](https://docs.openrct2.io/en/latest/playing/finances/)
- **Land ownership — single source.** Scenarios set the price of land and construction rights; these are separate purchase cases. Acquiring construction rights allows building over land without buying the underlying tile. Ownership/rights should be tile state, while purchase cost is an immediate ledger event. [RCT2 manual](https://www.andrewsteele.me.uk/technology/game_manuals/rollercoaster_tycoon_ii.pdf)
- **Running costs — multiple sources.** Tracked rides have variable operating costs related to ride size/complexity; flat rides and shops have fixed running costs. Shop stock is separately charged per sale. Ride operating costs are charged in batches twice per month (every 16 in-game days in the tick-calendar account below). [Finances](https://docs.openrct2.io/en/latest/playing/finances/), [RCT2 finance breakdown](https://grajcownik.pl/gry-strategiczne/rollercoaster-tycoon-2/finanse/)
- **Staff wages — multiple sources for cadence; single source for example values.** Wages are recurring and scale with staff count/type. The RCT2 manual gives example monthly salary labels of $50 for a handyman, $80 mechanic, $60 security guard, and $55 entertainer. The tick-calendar reference says wages are paid weekly. Implement wage as a per-staff configured amount, not a universal constant. [RCT2 manual](https://rctv2.rctspace.com/downloads/RCTycoon%20Manual%2008311.pdf), [time mechanics reference](https://github-wiki-see.page/m/Sadret/openrct2-plugin-wiki/wiki/Date-and-Time)

### Loans and interest

- **Loan controls — multiple sources.** Each scenario defines starting debt, maximum debt, and annual interest rate. Player adjustments move in $1,000 increments, and debt may be repaid subject to available cash. Cash-on-hand changes by the borrowed/repaid amount. [RCT2 manual](https://rct2.rctspace.com/downloads/RCTycoon%20Manual%2008311.pdf), [scenario editor manual](https://www.andrewsteele.me.uk/technology/game_manuals/rollercoaster_tycoon_ii.pdf)
- **Interest cadence and formula — open question.** OpenRCT2 documentation says interest is paid weekly, and a secondary finance reference reports quarterly portions of an annual rate four times per month. The original manual confirms an interest ledger line and configurable annual rate, but its example figures do not reconcile cleanly to a simple APR calculation. Treat weekly charging as a cross-version inference; do not assume a formula, compounding rule, or rounding method until tested against original RCT2. [OpenRCT2 finances](https://docs.openrct2.io/en/latest/playing/finances/), [financial summary reference](https://rct.fandom.com/wiki/Financial_Summary), [RCT2 manual](https://rct2.rctspace.com/downloads/RCTycoon%20Manual%2008311.pdf)
- **Company value — multiple sources.** `companyValue = parkValue + cashOnHand - loanBalance`. This is a derived metric, not an asset account. [RCT2 manual](https://rctv2.rctspace.com/downloads/RCTycoon%20Manual%2008311.pdf), [finance guide](https://steamcommunity.com/sharedfiles/filedetails/?id=1830311909)

### Monthly financial report

- **Purpose and window — multiple sources.** The income/expenditure report shows a rolling month-by-month ledger; the manual describes it as the detailed statement. Other finance views show cash net of debt, park value, and weekly profit. RCT2/OpenRCT2 finance UI documents six tabs: summary, financial graph, park-value graph, profit graph, marketing, and research funding. [RCT2 manual](https://rctv2.rctspace.com/downloads/RCTycoon%20Manual%2008311.pdf), [OpenRCT2 finances](https://docs.openrct2.io/en/latest/playing/finances/)
- **Ledger categories — multiple sources.** Keep at least: ride construction, ride running costs, land purchase, landscaping, park entrance tickets, ride tickets, shop sales, shop stock, food/drink sales, food/drink stock, staff wages, marketing, research, loan interest, and total. The UI may combine shop and food sales in presentation; preserve separate underlying categories to support objectives. [RCT2 finance breakdown](https://grajcownik.pl/gry-strategiczne/rollercoaster-tycoon-2/finanse/)
- **Posting cadence — single source.** Weekly: wages, research funding, loan interest, and marketing. Fortnightly: ride upkeep. Monthly: shift report columns and evaluate month-scoped objectives. Transactions should be posted at their due time and remain in cash immediately; the report is a projection of those posted entries, not a delayed monthly cash adjustment. [Time/update cycle reference](https://deepwiki.com/OpenRCT2/OpenRCT2/4.5-park-management), [RCT2 finance breakdown](https://grajcownik.pl/gry-strategiczne/rollercoaster-tycoon-2/finanse/)

### Marketing

- **Campaign model — multiple sources.** Marketing is a paid, time-limited weekly campaign intended to increase new guest visits. The player chooses a campaign and duration in weeks; campaign effects stop at expiry. Vouchers promise a specific price/freebie, so campaign fulfillment depends on the park's actual admission or offer. The manual lists free-entry vouchers, free-ride vouchers, half-price entry, free food/drink, park advertising, and ride advertising. [RCT2 manual](https://rct2.rctspace.com/rct2_manual.pdf)
- **Rates and exact response — single source / open question.** Manual transcriptions disagree: one extraction gives voucher campaigns at $50/week and park ads at $350/week; another gives $150/week vouchers and $250/week park ads. The second transcription's layout does not make the sixth campaign/rate clear. This may be OCR/manual-edition variance. Campaign guest multipliers by level/duration and the exact six campaign definitions need direct verification; treat listed prices as hypotheses rather than constants. [Manual transcription A](https://www.andrewsteele.me.uk/technology/game_manuals/rollercoaster_tycoon_ii.pdf), [manual transcription B](https://rct2.rctspace.com/downloads/RCTycoon%20Manual%2008311.pdf)

### Research and development

- **Research tree — multiple sources.** Scenario data defines already available inventions and an ordered/randomized list of unreleased inventions. Research categories/priorities include ride families and scenery; newly completed discoveries add buildable objects. A category with no remaining inventions is unavailable. The manual describes current project, expected completion, and latest completed development. [RCT2 manual](https://rctv2.rctspace.com/downloads/RCTycoon%20Manual%2008311.pdf), [scenario editor manual](https://www.andrewsteele.me.uk/technology/game_manuals/rollercoaster_tycoon_ii.pdf)
- **Funding and priority — multiple sources.** Funding choices are none, minimum, normal, maximum, with an independently selected set of categories to prioritize. More monthly funding advances research faster. If no categories are selected, research makes no progress while the player still pays. [RCT2 manual](https://rctv2.rctspace.com/downloads/RCTycoon%20Manual%2008311.pdf)
- **Funding amounts and unlock interval — single source.** A community research reference reports $100/month minimum, $200/month normal, $400/month maximum, with discoveries approximately every 60/45/30 days respectively. This cadence is approximate and conflicts with the exact 32-day simulation month; treat the amounts and intervals as provisional and validate in RCT2. [Research reference](https://rct.fandom.com/wiki/Research)
- **Selection behavior — open question.** Priority appears to constrain eligible categories, while scenario invention ordering controls which item comes next. Whether the game chooses randomly among selected categories, weights by category, or follows one global shuffled sequence must be established from original-game experiments.

### Park rating, park value, and awards

- **Park rating — multiple sources for range/effect; single source for formula.** Rating ranges 0–999 and affects scenario goals and guest attraction. A detailed formula guide reports a base 1,150 (1,050 in difficult-rating parks), then these factors: guest count (`min(guestCount, 2000) / 13`, subtracted from 150, giving −150 to +3); happiness among guests over 50% (penalty from −500 to 0); lost guests that are leaving (first 25 free, then −7 each); ride uptime (up to −200); average ride excitement/intensity proximity to 3.68/5.20 (up to −100); total excitement and intensity (up to −200 until each total reaches 80.00); litter (−4 each to −600); and casualties (up to −1,000, with decay). Final value clamps to 0–999. This is a single community reverse-engineering source; the manual alone does not publish the formula. [Park rating guide](https://forums.openrct2.org/topic/2798-guide-to-calculate-park-rating/)
- **Park value — single source.** A detailed guide reports that park value adds $7 per current guest to ride values. A ride's contribution uses its stats/value, age, five-minute throughput, and a per-ride-type bonus; duplicate ride types receive a 25% reduction. This changes over time as rides age and throughput changes. The exact displayed formula is image-based in the source; transcribe and validate before implementation. The manual independently describes park value qualitatively as land/equipment, ride quality and profitability, and park reputation/rating. [Park value guide](https://forums.openrct2.org/topic/2876-guide-how-to-calculate-park-value/), [RCT2 manual](https://rctv2.rctspace.com/downloads/RCTycoon%20Manual%2008311.pdf)
- **Awards — single source.** Awards are periodic park assessments with mutually exclusive pairs/categories. A detailed guide reports a positive active award multiplies guest-spawn probability by 1.25 and a negative one by 0.75. Conditions include cleanliness/scenery, ride counts, food/toilets per guest, staff coverage, ride popularity, safety, and price/value. Examples: best roller coasters requires six open coasters; best gentle rides requires ten open gentle rides; safest park checks recent fatal crashes and vandalism thoughts. Implement award definitions as data predicates and reevaluate on a slow cadence; exact thresholds should be verified. [Awards guide](https://forums.openrct2.org/topic/2732-guide-to-win-awards-with-your-park-in-openrct2/)

### Scenario objectives and evaluation

- **Objective families — multiple sources.** RCT2 scenarios include: reach a guest count by a date; reach park value by a date; meet guest count plus park rating; repay loan and reach park value; achieve monthly ride-ticket income; achieve monthly food/drink income; build a count of coasters meeting excitement/length criteria; finish a specified number of qualifying coasters; and open-ended goals such as “have fun” or “build the best park.” [RCT2 manual](https://rct2.rctspace.com/rct2_manual.pdf), [objective overview](https://deepwiki.com/OpenRCT2/OpenRCT2/4.5-park-management)
- **Evaluation — single source.** Time-limited goals use scenario date and compare current metrics at the deadline; monthly-income goals compare a completed monthly ledger period; construction goals count currently qualifying, completed/open rides (exact open/closed and custom-design requirements vary). `Repay loan + park value` requires both zero loan and the value threshold. Goals can be success or failure when a deadline passes; implement objective evaluation as explicit predicates driven by simulation events/date boundaries, not scattered UI logic. [RCT2 manual](https://www.andrewsteele.me.uk/technology/game_manuals/rollercoaster_tycoon_ii.pdf)
- **Do not substitute newer variants.** OpenRCT2 adds options and objective extensions; OpenCoaster targets the RCT1/RCT2-era baseline. Keep scenario objective types extensible, but do not silently import later custom-objective features. [Objective overview](https://deepwiki.com/OpenRCT2/OpenRCT2/4.5-park-management)

### Time progression and economy cadence

- **Simulation clock — multiple sources.** Run simulation logic at 40 ticks/sec (25 ms/tick), independent of rendering. One month is 16,384 ticks = 409.6 seconds = 6m49.6s at normal speed. One year is eight months, March through October, or 131,072 ticks = 54m36.8s. A week is one quarter-month (4,096 ticks); a fortnight is half-month (8,192 ticks). Date display maps month progress to 30/31 day labels; it does not change the fixed month duration. [Date and Time reference](https://github-wiki-see.page/m/Sadret/openrct2-plugin-wiki/wiki/Date-and-Time), [speedrunning mechanics discussion](https://www.speedrun.com/rct1/forums/6hmli)
- **Periodic update schedule — inferred from OpenRCT2 references.** OpenRCT2 summaries report weekly wages/research/interest/marketing (4,096 ticks), ride upkeep twice monthly (8,192 ticks), monthly report/objective updates (16,384 ticks), and park rating/value refresh every 512 ticks. Use this as an implementation schedule hypothesis, not a verified vanilla RCT2 contract. Exact ordering at shared boundaries is undocumented and must be tested against original behavior. [Simulation update cycle](https://deepwiki.com/OpenRCT2/OpenRCT2/4.5-park-management), [date reference](https://github-wiki-see.page/m/Sadret/openrct2-plugin-wiki/wiki/Date-and-Time)

### RCT1 differences

- **Admission model — single source.** RCT1 allows charging both admission and ride tickets; standard RCT2 scenarios choose one model. Prefer RCT2 behavior for OpenCoaster, but store pricing policy as scenario configuration so an optional legacy mode remains possible. [RCT1/RCT2 pricing discussion](https://forums.openrct2.org/topic/5602-charging-for-both-rides-and-park-entrance/)
- **Calendar — single source.** Both versions use the distinctive eight-month park year in the RCT1/RCT2 family. Use the RCT2 40 Hz and fixed 16,384-tick month mapping above as the target; verify on original RCT2 before claiming exact compatibility. [Date and Time reference](https://github-wiki-see.page/m/Sadret/openrct2-plugin-wiki/wiki/Date-and-Time)

## 3. Data model proposal

Use deterministic integer money and fixed-point values. Keep scenario definitions and research/award/objective rules as small immutable tables. Park economy is mostly aggregate state; the high-cardinality entities are guests, rides, shops, staff, and tiles.

```ts
type Money = number; // signed integer minor units (1/100 currency)
type Tick = number;  // integer simulation ticks
type ScenarioPriceMode = "admission" | "per-ride" | "free";
type LedgerCategory =
  | "rideConstruction" | "rideRunning" | "land" | "landscaping"
  | "admission" | "rideTickets" | "shopSales" | "shopStock"
  | "foodDrinkSales" | "foodDrinkStock" | "wages" | "marketing"
  | "research" | "interest";

interface EconomyState {
  cash: Money;
  loan: Money;
  maxLoan: Money;
  annualInterestBps: number;
  admissionPrice: Money;
  priceMode: ScenarioPriceMode;
  ledgerMonth: number;
  ledger: Float64Array; // integer minor units, category x rolling 5 months
  tickOfLastWeeklyCharge: Tick;
  tickOfLastFortnightCharge: Tick;
  tickOfLastMonthRollover: Tick;
}

interface ResearchState {
  funding: 0 | 1 | 2 | 3; // none/minimum/normal/maximum
  enabledCategoryMask: number;
  progress: number;      // integer work units
  inventionCursor: number;
  discovered: Uint8Array; // scenario invention index -> 0/1
}

interface MarketingCampaignState {
  campaignId: number;
  targetRideId: number; // -1 for park-wide
  weeksRemaining: number;
  paidThroughTick: Tick;
}

interface RideEconomyColumns {
  price: Int32Array;
  constructionCost: Int32Array;
  runningCostPerFortnight: Int32Array;
  salesThisMonth: Int32Array;
  stockCostThisMonth: Int32Array;
  ridersLast5Minutes: Uint16Array;
  ageMonths: Uint16Array;
}

interface StallEconomyColumns {
  priceByItem: Int32Array;
  salesThisMonth: Int32Array;
  stockCostThisMonth: Int32Array;
  stockCostPerItem: Uint16Array;
  runningCostPerHour: Uint16Array;
  weatherBand: Uint8Array;
}
```

Guests should use existing SoA fields (cash, happiness, hunger/thirst, purchase/ride decisions) rather than per-guest economy objects. Tile ownership and construction rights belong in world tile columns. Keep each transaction in integer minor units; use wide/safe integer arithmetic for `principal * rate` and park-value intermediate sums. Ledger entries can aggregate by category and month; retain individual transaction events only if an audit/activity log is needed.

**Per-tick cost target (inferred):** Do not scan every guest, ride, or tile for economy work each tick. Per tick update the clock and check a few counters; charge due systems only on 4,096/8,192/16,384-tick boundaries. Guest purchases add a constant-time transaction to cash and category totals. Ride/stall pricing checks happen only when a guest considers purchase. Monthly ledger shift is O(categories × retained months); research selection is O(number of eligible inventions) only on a research completion boundary. Park-value work can be O(rides) every 512 ticks initially, but cache ride inputs and consider staggered/incremental recomputation for very large ride counts. Target thousands of guests at 40 Hz: aggregate economy overhead should be O(1) per tick plus O(number of purchase events), with no O(guests) economy sweep.

## 4. Dependencies on other subsystems

- **Guests:** cash, happiness, needs, ride valuation, price rejection, item purchases, admission decisions, marketing attraction, and guest thoughts that feed park rating and awards.
- **Rides and track:** construction cost, capacity/throughput, operating costs, ride uptime, age, stats, rider counts, and ticket sales; track design determines construction and some operating cost.
- **Shops/stalls:** item catalog, weather-sensitive demand/value, inventory cost, sales events, and facility fees.
- **Staff and world:** wage counts; tile ownership/construction rights; terrain/scenery spending; service quality influences guest happiness/rating and award conditions.
- **Research:** scenario invention list, category filters, completion/unlock events, build catalog availability, and novelty/guest attraction.
- **Scenario/objective system:** starting cash/debt, loan cap/rate, land prices, price mode, research availability, marketing restrictions, objective thresholds/deadlines, and success/failure evaluation.
- **Simulation clock:** fixed tick schedule is the source of truth for weekly, fortnightly, monthly, and deadline events.
- **Rendering/UI:** finance report, price controls, loan/research/marketing panels, award notifications, graphs; UI reads snapshots and emits commands, never owns money calculations.

## 5. Prioritized implementation checklist

### MVP

1. Store cash, debt, maximum debt, interest rate, price mode, admission/ride/shop prices, and all money as integer minor units.
2. Implement scenario-configured admission vs. per-ride modes and guest purchase transactions; add item stock cost and income ledger entries.
3. Debit construction, landscaping, land, and construction-right purchases at action time; define sale/refund behavior for demolition.
4. Add scenario staff wages, ride/stall running costs, and interest as recurring weekly/fortnightly charges; show cash changes immediately.
5. Implement deterministic 40 Hz clock with 16,384 ticks/month and 8 months/year; make pause/speed affect wall time, not ticks per game month.
6. Implement rolling monthly income/expense summary and `companyValue = parkValue + cash - loan`.
7. Support basic objective predicates: guests by date, park value by date, monthly sales/income, repay loan + value, and qualifying coaster count/length/excitement.
8. Add data-driven research funding/priorities and limited invention completion; persist scenario invention state.

### Fidelity

9. Verify and implement original-game ride price valuation, ride aging, admission interaction, and guest price rejection.
10. Add per-item stock costs, weather-dependent shop pricing and purchase rules, cash machines, toilets, and voucher fulfillment.
11. Reproduce marketing campaign prices, weekly guest multipliers, ride targeting, duration, and fulfillment complaints.
12. Verify loan-interest rounding and exact charge boundary ordering; support scenario currency conversion/display.
13. Implement park rating, park value, award predicates, spawn effects, objective failure/warning rules, and detailed report graphs.
14. Optimize rating/value aggregation for large parks; validate economy event throughput at 40 ticks/sec with thousands of guests.

## 6. Open questions and sources

### Open questions

1. Which of the conflicting RCT2 manual transcriptions has correct marketing campaign costs for the target edition and currency?
2. What exact unit and rounding rule applies to the configured annual interest rate, and is interest charged on each weekly boundary before or after other ledger entries?
3. What are the exact original-game ride valuation, age multipliers, and guest willingness-to-pay formulas? The community guide's formulas are image-based and derived from OpenRCT2 analysis.
4. Are minimum/normal/maximum research funding exactly 100/200/400 currency units per month, and are 60/45/30-day discoveries fixed or dependent on remaining inventions/categories?
5. How does RCT2 select the next invention among enabled research categories, and how does priority interact with a scenario's ordered invention list?
6. What are the exact sales-conversion probabilities for each marketing campaign and which outcomes differ for existing versus prospective guests?
7. Is park value exactly `sum(ride value) + 7 * guests`, with duplicate-type penalty and no direct land/cash contribution, across all RCT2 editions?
8. What exact date boundary does a deadline objective evaluate, and what is the order of the monthly ledger rollover, recurring charges, research completion, guest generation, and success checks when they coincide?
9. Which park rating and award thresholds differ between RCT1 and RCT2, and which are only display-label changes?

### Sources

- [RCT2 manual — finances, research, marketing, land, scenario objectives](https://rct2.rctspace.com/downloads/RCTycoon%20Manual%2008311.pdf)
- [RCT2 manual mirror — scenario editor, objectives, financial parameters](https://www.andrewsteele.me.uk/technology/game_manuals/rollercoaster_tycoon_ii.pdf)
- [OpenRCT2 Finances documentation](https://docs.openrct2.io/en/latest/playing/finances/)
- [OpenRCT2 Shops & Stalls documentation](https://docs.openrct2.io/en/latest/playing/shops_and_stalls/)
- [Park rating formula guide](https://forums.openrct2.org/topic/2798-guide-how-to-calculate-park-rating/)
- [Park value formula guide](https://forums.openrct2.org/topic/2876-guide-how-to-calculate-park-value/)
- [Ride pricing guide](https://forums.openrct2.org/topic/2737-guide-how-much-can-you-charge-for-your-rides/)
- [Shop item pricing guide](https://forums.openrct2.org/topic/2747-guide-how-much-can-you-charge-for-your-shops/)
- [Awards guide](https://forums.openrct2.org/topic/2732-guide-to-win-awards-with-your-park-in-openrct2/)
- [Date and tick mapping reference](https://github-wiki-see.page/m/Sadret/openrct2-plugin-wiki/wiki/Date-and-Time)
- [Tick and update cadence summary](https://deepwiki.com/OpenRCT2/OpenRCT2/4.5-park-management)
- [Financial summary notes](https://rct.fandom.com/wiki/Financial_Summary)
- [Research reference](https://rct.fandom.com/wiki/Research)
- [RCT1/RCT2 admission difference discussion](https://forums.openrct2.org/topic/5602-charging-for-both-rides-and-park-entrance/)

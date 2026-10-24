# sim/research

Responsibility: research funding levels, category-gated progress through a scenario's ordered invention list, and the unlocked item set.

## Interface

- `research.ts`: `Funding` (none/minimum/normal/maximum), `FUNDING_WEEKLY_CENTS`, `ResearchState`, `createResearch()`, `isUnlocked(world, itemId)`, `applyResearchAction` (`setFunding`, `setCategories` from the `research` command), save helpers.
- `research-system.ts`: weekly funding charge and progress.

## Decisions

- Funding is charged monthly at the chosen level ($0 / $100 / $200 / $400, `FUNDING_MONTHLY_CENTS`), on the month boundary before the economy rolls the month, whether or not progress is possible.
- Progress accrues weekly at `FUNDING_WORK_PER_WEEK` (21 / 28 / 42 units: 3 / 4 / 6 a day). An invention of 180 work units takes 60 days at minimum funding, 45 at normal and 30 at maximum, which is the reference's interval. Each invention's `workUnits` are scenario data.
- Progress needs funding above none and at least one enabled category with an undiscovered invention. Empty category mask pauses research while funding is still charged (the manual's reading).
- Order: the player's priority list first (`setPriority`, item ids in order), then the rest in scenario order. Unknown or repeated ids are rejected; an empty list restores scenario order. The target changes reset progress; leftover progress carries into the next invention.
- Items available at scenario start are in `unlocked` from the start.
- Saves before version 9 store `costCents`; `upgradeLegacyResearchSave` converts them at the old minimum rate. A save without `priority` restores as scenario order.

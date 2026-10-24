# sim/research

Responsibility: research funding levels, category-gated progress through a scenario's ordered invention list, and the unlocked item set.

## Interface

- `research.ts`: `Funding` (none/minimum/normal/maximum), `FUNDING_WEEKLY_CENTS`, `ResearchState`, `createResearch()`, `isUnlocked(world, itemId)`, `applyResearchAction` (`setFunding`, `setCategories` from the `research` command), save helpers.
- `research-system.ts`: weekly funding charge and progress.

## Decisions

- Funding is paid every week at the chosen level, even when nothing is eligible. Progress is added only when funding is above none and at least one enabled category has an undiscovered invention.
- Selection: the first undiscovered invention in scenario order whose category bit is enabled. Progress resets when the target changes. Leftover progress carries into the next invention.
- Weekly amounts (0 / 2,500 / 5,000 / 10,000 cents) and the cost of each invention are tunable. Source figures are provisional; see economy.md open question 4.
- Items available at scenario start are in `unlocked` from the start.

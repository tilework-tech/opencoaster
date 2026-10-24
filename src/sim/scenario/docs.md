# sim/scenario

Responsibility: scenario definitions (starting finances, price mode, loan terms, research catalogue, one objective) and win/lose evaluation.

## Interface

- `scenario.ts`: `ScenarioDef`, `ScenarioObjective` (flat numeric record), `ObjectiveKind`, `ScenarioStatus`, `applyScenario(world, def)`. Call once, right after creating the world and before stepping.
- `scenario-system.ts`: `scenarioSystem` and `meetsObjective(world, objective)`.

## Decisions

- Objectives are judged once, on the first tick at or after `byTick`. Win if met, otherwise lose. Status is terminal.
- `Guests`, `ParkValue`, `GuestsAndRating`, `RepayLoanAndParkValue` and `QualifyingRides` compare live metrics at the deadline.
- `MonthlyIncome` sums the masked categories for the most recently completed month. The economy rolls the month before scenarios evaluate, so a deadline on a month boundary judges the month that just ended.
- The objective record and status are saved; the research catalogue is saved as part of research state. The scenario definition itself is not stored.

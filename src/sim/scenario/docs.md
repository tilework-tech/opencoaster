# sim/scenario

Responsibility: scenario definitions (starting finances, price mode, loan terms, research catalogue, park entrance, one objective), the JSON scenario format, the park layout a scenario lays down, and win/lose evaluation.

## Interface

- `scenario.ts`: `ScenarioDef`, `ScenarioEntrance`, `EntranceSide`, `ScenarioObjective` (flat numeric record), `ObjectiveKind`, `ScenarioStatus`, `applyScenario(world, def)`. `applyScenario` sets finances, research catalogue and objective only.
- `scenario-layout.ts`: `prepareScenario(world, def)` runs `applyScenario` and then `layOutEntrance`. The worker calls this for new games. `layOutEntrance(world, entrance)` lays the path and registers its edge tile as the park gate, returning the number of path pieces placed.
- `scenario-file.ts`: `parseScenarioFile(raw: unknown): ScenarioDef` validates one scenario JSON document. Errors name the scenario id and the field path.
- `catalog.ts`: `SCENARIOS` (every `scenarios/*.json`, parsed at import, in file-name order), `findScenario(id)`, `buildCatalog(modules)`. Adding a JSON file adds a playable scenario; duplicate ids fail the whole catalog.
- `scenario-system.ts`: `scenarioSystem`, `objectiveMetric(world, objective)` (the live figure an objective compares with its target), and `meetsObjective(world, objective)`.
- `scenarios/starter.json`: the shipped starter scenario.

## Scenario JSON

```json
{
  "id": "starter",
  "name": "Starter Park",
  "description": "…",
  "seed": 2026,
  "map": { "width": 64, "height": 64 },
  "finance": {
    "startingCash": 5000000,
    "startingLoan": 2000000,
    "maxLoan": 10000000,
    "annualInterestBps": 1000
  },
  "pricing": { "mode": "admission", "admissionPrice": 300 },
  "research": {
    "availableItemIds": [1, 5],
    "inventions": [{ "itemId": 2, "category": 0, "costCents": 40000 }]
  },
  "entrance": { "side": "south", "length": 4 },
  "objective": { "kind": "guestsAndRating", "target": 10, "rating": 600, "byYear": 1 }
}
```

- Money is integer cents, capped at 10^12 so sums stay exact. `pricing.mode` is `free`, `admission` or `perRide`. The starting loan may not exceed the loan limit, and objective targets are never negative.
- The ids `sandbox` and `imported` are reserved: they name non-scenario saves (`SANDBOX_ID`, `IMPORTED_ID` in `scenario.ts`).
- `objective.kind` is one of `guests`, `parkValue`, `guestsAndRating`, `repayLoanAndParkValue`, `monthlyIncome` (needs `categories`, ledger category names such as `admission`), `qualifyingRides`.
- The deadline is `byYear` (whole years; year N ends at the start of year N+1) or a raw `byTick`.
- `entrance` is optional. Without it the park has no path.

## Decisions

- Objectives are judged once, on the first tick at or after `byTick`. Win if met, otherwise lose. Status is terminal. The game continues afterwards as a sandbox.
- `Guests`, `GuestsAndRating`, `ParkValue`, `RepayLoanAndParkValue` and `QualifyingRides` compare live metrics at the deadline. `GuestsAndRating` also needs the stored park rating to reach `rating`. Rating is first computed at tick 512, so it reads 0 before then.
- `MonthlyIncome` sums the masked categories for the most recently completed month. The economy rolls the month before scenarios evaluate, so a deadline on a month boundary judges the month that just ended.
- The park entrance is laid on the owned-land edge on the requested side, with a straight path inward. The search runs outward from the edge midpoint and takes the first run of `length` tiles that is buildable, flat, dry and empty. It only depends on the terrain, so the same seed gives the same entrance. If no run qualifies, no path is placed.
- The objective record and status are saved; the research catalogue is saved as part of research state. The scenario definition itself is not stored, and nothing about the scenario file is in the save format. A loaded game keeps its objective and outcome.
- Starter objective: 100 live guests and park rating 750 by the end of year one. The target is calibrated with `pnpm balance`; see [docs/BALANCE.md](../../../docs/BALANCE.md#starter-objective).
- The scenario entrance registers the outermost path tile as the park gate. Guest arrivals and departures use this gate and its connected footpath network.

## Starter Objective Calibration

The target is calibrated with the headless balance harness (`pnpm balance`, [bench/docs.md](../../../bench/docs.md)) on flattened terrain. Minimal, modest and ambitious scripted parks end year one at 157 - 298, 677 - 769 and 762 - 822 rating over six seeds, so rating 750 separates a thin park from one that keeps adding attractions. Player terrain edits and layouts can change the outcome; the harness does not measure the scenario's original rolling terrain.

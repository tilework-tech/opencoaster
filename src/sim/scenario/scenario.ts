export type ScenarioObjective =
  | { kind: 'guests'; target: number; byTick: number }
  | { kind: 'parkValue'; target: number; byTick: number }
  | { kind: 'rideRating'; target: number; count: number; byTick: number };

export interface ScenarioDef {
  id: string;
  name: string;
  seed: number;
  mapWidth: number;
  mapHeight: number;
  startingCash: number;
  objective: ScenarioObjective;
}

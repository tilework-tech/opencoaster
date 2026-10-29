import { World } from '../src/sim/core/world';
import { weatherSystem } from '../src/sim/weather/weather-system';
import { Climate, WeatherKind } from '../src/sim/weather/weather';

const SEEDS = 12;
const TICKS = 1_000_000;
const rows: Record<string, number>[] = [];
for (const climate of [Climate.Cold, Climate.CoolAndWet, Climate.HotAndDry, Climate.Warm]) {
  let wetTicks = 0;
  let stormTicks = 0;
  let weatherChanges = 0;
  let wetSpellCount = 0;
  let clearSpellCount = 0;
  let wetSpellTicks = 0;
  let clearSpellTicks = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const world = new World({ seed, width: 16, height: 16 });
    world.weather.climate = climate;
    let previousKind = world.weather.kind;
    let previousWet = previousKind >= WeatherKind.Rain;
    let wetRun = 0;
    let clearRun = 0;
    for (let tick = 0; tick < TICKS; tick++) {
      weatherSystem.update(world);
      const kind = world.weather.kind;
      const wet = kind >= WeatherKind.Rain;
      if (kind !== previousKind) weatherChanges++;
      if (wet) {
        wetTicks++;
        wetRun++;
        if (!previousWet) {
          clearSpellCount++;
          clearSpellTicks += clearRun;
          clearRun = 0;
        }
      } else {
        clearRun++;
        if (previousWet) {
          wetSpellCount++;
          wetSpellTicks += wetRun;
          wetRun = 0;
        }
      }
      if (kind === WeatherKind.Storm) stormTicks++;
      previousKind = kind;
      previousWet = wet;
    }
    if (previousWet) { wetSpellCount++; wetSpellTicks += wetRun; }
    else { clearSpellCount++; clearSpellTicks += clearRun; }
  }
  const totalTicks = SEEDS * TICKS;
  const hours = totalTicks / 40 / 3600;
  rows.push({
    climate,
    wetPercent: +(wetTicks / totalTicks * 100).toFixed(2),
    stormPercent: +(stormTicks / totalTicks * 100).toFixed(2),
    weatherTransitionsPerHour: +(weatherChanges / hours).toFixed(2),
    wetSpellTransitionsPerHour: +(wetSpellCount / hours).toFixed(2),
    meanWetSpellSeconds: +(wetSpellTicks / wetSpellCount / 40).toFixed(1),
    meanClearSpellSeconds: +(clearSpellTicks / clearSpellCount / 40).toFixed(1),
  });
}
console.log(JSON.stringify({ seeds: SEEDS, ticksPerSeed: TICKS, rows }, null, 2));

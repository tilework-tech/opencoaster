// Usage: node summarize-benchmark.mjs <runsDir> <out.json>
// runsDir/<round>/<before|after>/report-<backend>.json as written by capture-lighting.mjs.
import { readFile, readdir, writeFile } from 'node:fs/promises';

const [runs, outFile] = process.argv.slice(2);
const q = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const stats = (samples) => {
  const s = [...samples].sort((a, b) => a - b);
  return { median: +q(s, 0.5).toFixed(2), p95: +q(s, 0.95).toFixed(2), n: s.length };
};
const pct = (a, b) => +(((b - a) / a) * 100).toFixed(1);
const rounds = (await readdir(runs, { withFileTypes: true })).filter((d) => d.isDirectory() && /^r\d+$/.test(d.name)).map((d) => d.name).sort();
const rows = [];
for (const backend of ['canvas2d', 'webgl2']) {
  for (const condition of ['clear-day', 'rainy-day', 'clear-night', 'rainy-night', 'storm-night']) {
    const side = { before: [], after: [] };
    const perRound = {};
    for (const round of rounds) {
      for (const variant of ['before', 'after']) {
        const report = JSON.parse(await readFile(`${runs}/${round}/${variant}/report-${backend}.json`, 'utf8'));
        if (!report.valid) throw new Error(`${round}/${variant}/${backend} is not a valid capture`);
        const timing = report.conditions[condition].timing;
        side[variant].push(...timing.samples);
        (perRound[round] ??= {})[variant] = stats(timing.samples);
      }
    }
    const before = stats(side.before), after = stats(side.after);
    rows.push({
      backend, condition, before, after,
      medianChangePercent: pct(before.median, after.median),
      p95ChangePercent: pct(before.p95, after.p95),
      perRound: Object.fromEntries(Object.entries(perRound).map(([r, v]) => [r, { ...v, medianChangePercent: pct(v.before.median, v.after.median) }])),
    });
  }
}
await writeFile(outFile, JSON.stringify({ rounds, rows }, null, 2));
console.log('backend   condition    before(med/p95)   after(med/p95)   med%   p95%   per-round med%');
for (const r of rows)
  console.log(`${r.backend.padEnd(9)} ${r.condition.padEnd(12)} ${r.before.median}/${r.before.p95}`.padEnd(48) + `${r.after.median}/${r.after.p95}`.padEnd(18) + `${r.medianChangePercent}`.padEnd(7) + `${r.p95ChangePercent}`.padEnd(7) + Object.values(r.perRound).map((v) => v.medianChangePercent).join(', '));

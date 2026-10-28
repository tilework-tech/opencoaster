import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

interface SpecDuration {
  file: string;
  durationMs: number;
}

export class SpecTimingReporter implements Reporter {
  private readonly durations = new Map<string, number>();
  private readonly outputPath: string;

  constructor(options: { outputPath?: string } = {}) {
    this.outputPath =
      options.outputPath ?? process.env.E2E_TIMINGS_FILE ?? '.local/e2e/spec-timings.json';
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const file = test.location.file;
    this.durations.set(file, (this.durations.get(file) ?? 0) + result.duration);
  }

  async onEnd(): Promise<void> {
    const specs = [...this.durations]
      .map(([file, durationMs]): SpecDuration => ({ file, durationMs }))
      .sort((a, b) => b.durationMs - a.durationMs);
    const report = { specs, slowest: specs.slice(0, 15) };

    await mkdir(dirname(this.outputPath), { recursive: true });
    await writeFile(this.outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nE2E per-spec timings (${this.outputPath})`);
    for (const { file, durationMs } of report.slowest)
      console.log(`${(durationMs / 1000).toFixed(1)}s  ${file}`);
  }
}

export default SpecTimingReporter;

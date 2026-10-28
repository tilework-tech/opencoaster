import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TestCase, TestResult } from '@playwright/test/reporter';
import { SpecTimingReporter } from './e2e-spec-timing-reporter';

describe('SpecTimingReporter', () => {
  let outputDir: string | undefined;

  afterEach(async () => {
    if (outputDir) await rm(outputDir, { recursive: true, force: true });
    outputDir = undefined;
  });

  it('writes each spec total and lists the 15 slowest specs first', async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'opencoaster-e2e-timings-'));
    const outputPath = join(outputDir, 'timings.json');
    const reporter = new SpecTimingReporter(outputPath);

    for (let i = 0; i < 16; i++) {
      const test = { location: { file: `/repo/e2e/spec-${i}.spec.ts` } } as TestCase;
      const result = { duration: (i + 1) * 1000 } as TestResult;
      reporter.onTestEnd(test, result);
    }

    await reporter.onEnd({ status: 'passed' } as never);

    const report = JSON.parse(await readFile(outputPath, 'utf8')) as {
      specs: Array<{ file: string; durationMs: number }>;
      slowest: Array<{ file: string; durationMs: number }>;
    };
    expect(report.specs).toHaveLength(16);
    expect(report.slowest).toHaveLength(15);
    expect(report.slowest[0]).toEqual({ file: '/repo/e2e/spec-15.spec.ts', durationMs: 16_000 });
    expect(report.slowest.at(-1)).toEqual({ file: '/repo/e2e/spec-1.spec.ts', durationMs: 2_000 });
  });
});
